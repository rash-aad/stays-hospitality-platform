import { refreshTokens, staffDevices, users } from '@hp/db';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest, notFound, unauthorized } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/ids.js';
import { runtimeConfig } from '../../runtime.js';
import { sessionOut, setRefreshCookie } from './http.js';
import { loadStaffAccess } from './permissions.js';
import { hashPassword, issueSession, verifyPassword } from './service.js';

export const DEVICE_COOKIE = 'hp_device';
const PIN_MAX_FAILED = 5;
const PIN_LOCK_MINUTES = 15;
/** Shared-device sessions last one shift. */
const SHIFT_HOURS = 12;

/** The enrolled shared device this browser belongs to (via its httpOnly cookie), if any. */
export async function deviceOf(req: FastifyRequest) {
  const token = req.cookies[DEVICE_COOKIE];
  if (!token) return null;
  const [d] = await asSystem((tx) => tx.update(staffDevices).set({ lastSeenAt: new Date() }).where(and(eq(staffDevices.tokenHash, sha256(token)), isNull(staffDevices.revokedAt))).returning());
  return d ?? null;
}

function setDeviceCookie(reply: FastifyReply, token: string) {
  reply.setCookie(DEVICE_COOKIE, token, { httpOnly: true, secure: runtimeConfig().NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/auth', maxAge: 365 * 86400 });
}

/** Reject PINs that are trivially guessable (repeated digits, straight runs). */
export function weakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}

export const deviceRoutes: Routes = async (app) => {
  // ---------------- Managing shared devices ----------------
  app.get('/admin/devices', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    const current = await deviceOf(req).catch(() => null);
    const rows = await withTenant(t.id, (tx) => tx.select({ id: staffDevices.id, name: staffDevices.name, lastSeenAt: staffDevices.lastSeenAt, createdAt: staffDevices.createdAt, createdBy: users.name })
      .from(staffDevices).leftJoin(users, eq(users.id, staffDevices.createdByUserId)).where(and(eq(staffDevices.tenantId, t.id), isNull(staffDevices.revokedAt))).orderBy(staffDevices.name));
    return { data: rows.map((r) => ({ ...r, current: r.id === current?.id })) };
  });

  /** Run on the device itself: marks this browser as a shared device (sets a long-lived httpOnly cookie). */
  app.post('/admin/devices', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], body: z.object({ name: z.string().trim().min(2).max(60) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const a = staffActor(req);
    const token = randomToken(32);
    const d = await withTenant(t.id, async (tx) => {
      const [d] = await tx.insert(staffDevices).values({ tenantId: t.id, name: req.body.name, tokenHash: sha256(token), createdByUserId: a.userId }).returning();
      await audit(tx, req, { action: 'device.enrol', entityType: 'staff_device', entityId: d!.id, changes: { name: req.body.name } });
      return d!;
    });
    setDeviceCookie(reply, token);
    return reply.status(201).send({ data: { id: d.id, name: d.name } });
  });

  app.delete('/admin/devices/:id', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [d] = await tx.update(staffDevices).set({ revokedAt: new Date() }).where(and(eq(staffDevices.id, req.params.id), eq(staffDevices.tenantId, t.id), isNull(staffDevices.revokedAt))).returning();
      if (!d) throw notFound('Device');
      await tx.delete(refreshTokens).where(eq(refreshTokens.deviceId, d.id)); // ends every shift session on it
      await audit(tx, req, { action: 'device.revoke', entityType: 'staff_device', entityId: d.id });
    });
    return reply.status(204).send();
  });

  // ---------------- PIN sign-in on a shared device ----------------
  /** Who can sign in here (names only). Owners always use their full sign-in. */
  app.get('/auth/device', { schema: { tags: ['auth'] } }, async (req) => {
    const d = await deviceOf(req);
    if (!d) throw notFound('This device isn’t set up for PIN sign-in');
    const people = await withTenant(d.tenantId, async (tx) => {
      const rows = await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(eq(users.tenantId, d.tenantId), eq(users.status, 'active'), isNotNull(users.pinHash))).orderBy(users.name);
      const out = [];
      for (const r of rows) if (!(await loadStaffAccess(d.tenantId, r.id)).isOwner) out.push(r);
      return out;
    });
    const [{ name } = { name: '' }] = await asSystem((tx) => tx.execute<{ name: string }>(sql`select name from tenants where id = ${d.tenantId}`));
    return { data: { device: d.name, property: name, people } };
  });

  app.post('/auth/pin-login', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['auth'], body: z.object({ userId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) }), response: { 200: sessionOut.extend({ user: z.object({ id: z.string(), name: z.string() }) }) } },
  }, async (req, reply) => {
    const d = await deviceOf(req);
    if (!d) throw unauthorized('This device isn’t set up for PIN sign-in');
    const outcome = await asSystem(async (tx) => {
      const [u] = await tx.select().from(users).where(and(eq(users.id, req.body.userId), eq(users.tenantId, d.tenantId), eq(users.status, 'active'))).for('update');
      if (!u?.pinHash) return { error: unauthorized('Incorrect PIN') } as const;
      if (u.pinLockedUntil && u.pinLockedUntil > new Date()) return { error: new AppError(429, 'locked', `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes or use your password.`) } as const;
      if ((await loadStaffAccess(d.tenantId, u.id)).isOwner) return { error: unauthorized('Owners sign in with their password') } as const;
      if (!(await verifyPassword(u.pinHash, req.body.pin))) {
        const failed = u.pinFailed + 1;
        await tx.update(users).set({ pinFailed: failed >= PIN_MAX_FAILED ? 0 : failed, pinLockedUntil: failed >= PIN_MAX_FAILED ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null }).where(eq(users.id, u.id));
        return { error: unauthorized('Incorrect PIN') } as const;
      }
      await tx.update(users).set({ pinFailed: 0, pinLockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
      // Possession of an enrolled device plus the PIN counts as the second factor.
      const session = await issueSession(tx, { typ: 'staff', sub: u.id, tid: d.tenantId, mfa: 'ok' }, { userAgent: req.headers['user-agent'], ip: req.ip, deviceId: d.id, ttlHours: SHIFT_HOURS });
      await audit(tx, req, { action: 'auth.pin_login', entityType: 'user', entityId: u.id, tenantId: d.tenantId, actor: { type: 'user', id: u.id }, changes: { device: d.name } });
      return { session, user: { id: u.id, name: u.name } };
    });
    if ('error' in outcome) throw outcome.error;
    return { ...setRefreshCookie(reply, 'staff', outcome.session), user: outcome.user };
  });

  /** Set or change your own shift PIN (password confirms it's you). */
  app.put('/auth/pin', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['auth'], body: z.object({ pin: z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits'), password: z.string().min(1).max(200) }) },
  }, async (req) => {
    if (req.actor.type !== 'staff') throw unauthorized();
    const a = req.actor;
    if (weakPin(req.body.pin)) throw badRequest('That PIN is too easy to guess — avoid repeats and runs like 1234');
    await asSystem(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, a.userId));
      if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, req.body.password))) throw unauthorized('Incorrect password');
      await tx.update(users).set({ pinHash: await hashPassword(req.body.pin), pinFailed: 0, pinLockedUntil: null }).where(eq(users.id, u.id));
    });
    return { ok: true };
  });

  app.delete('/auth/pin', { schema: { tags: ['auth'] } }, async (req) => {
    if (req.actor.type !== 'staff') throw unauthorized();
    const a = req.actor;
    await asSystem((tx) => tx.update(users).set({ pinHash: null }).where(eq(users.id, a.userId)));
    return { ok: true };
  });
};
