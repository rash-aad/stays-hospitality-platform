import { refreshTokens, tenants, users } from '@hp/db';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { encryptSecret } from '../../lib/crypto.js';
import { sha256 } from '../../lib/ids.js';
import { newRecoveryCodes, newTotpSecret, otpauthUrl } from '../../lib/totp.js';
import { runtimeConfig } from '../../runtime.js';
import { COOKIE, sessionOut, setRefreshCookie, type Audience } from './http.js';
import { checkSecondFactor, mfaRequired, type MfaPolicy } from './mfa.js';
import { invalidateStaffAccess } from './permissions.js';
import { issueSession, verifyPassword } from './service.js';

/** The signed-in staff or platform account (pending second-factor sessions included). */
function account(req: FastifyRequest) {
  const a = req.actor;
  if (a.type !== 'staff' && a.type !== 'platform') throw unauthorized();
  return { userId: a.userId, aud: (a.type === 'platform' ? 'platform' : 'staff') as Audience, tenantId: a.type === 'staff' ? a.tenantId : null };
}

async function loadUser(userId: string) {
  const [u] = await asSystem((tx) => tx.select().from(users).where(eq(users.id, userId)));
  if (!u) throw unauthorized();
  return u;
}

/** Family of the refresh cookie presented with this request (the "current" device). */
async function currentFamily(req: FastifyRequest, aud: Audience) {
  const token = req.cookies[COOKIE[aud]];
  if (!token) return null;
  const [row] = await asSystem((tx) => tx.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token))));
  return row?.familyId ?? null;
}

const recoveryHash = (code: string) => sha256(code);

export const securityRoutes: Routes = async (app) => {
  const codeBody = z.object({ code: z.string().trim().min(6).max(20) });

  app.get('/auth/mfa', { schema: { tags: ['auth'] } }, async (req) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    const required = await asSystem((tx) => mfaRequired(tx, u));
    return { data: { enabled: !!u.mfaEnabledAt, enabledAt: u.mfaEnabledAt, required, recoveryCodesLeft: u.mfaRecoveryHashes.length } };
  });

  /** Start enrolment: a fresh secret (stored encrypted, inactive until confirmed with a code). */
  app.post('/auth/mfa/setup', { schema: { tags: ['auth'] } }, async (req) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    if (u.mfaEnabledAt) throw conflict('Two-step sign-in is already on');
    const secret = newTotpSecret();
    await asSystem((tx) => tx.update(users).set({ mfaSecret: encryptSecret(secret, runtimeConfig().SECRETS_MASTER_KEY) }).where(eq(users.id, u.id)));
    const url = otpauthUrl(secret, u.email);
    return { data: { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) } };
  });

  /** Confirm enrolment with a first code: turns it on, returns recovery codes once, and signs out every other device. */
  app.post('/auth/mfa/enable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: codeBody } }, async (req, reply) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    if (u.mfaEnabledAt) throw conflict('Two-step sign-in is already on');
    if (!u.mfaSecret) throw badRequest('Start the setup first');
    const codes = newRecoveryCodes();
    const session = await asSystem(async (tx) => {
      await checkSecondFactor(tx, u, req.body.code);
      await tx.update(users).set({ mfaEnabledAt: new Date(), mfaRecoveryHashes: codes.map(recoveryHash) }).where(eq(users.id, u.id));
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, u.id));
      await audit(tx, req, { action: 'auth.mfa_enabled', entityType: 'user', entityId: u.id, tenantId: a.tenantId, actor: { type: a.aud === 'platform' ? 'platform' : 'user', id: u.id } });
      return issueSession(tx, a.tenantId ? { typ: 'staff', sub: u.id, tid: a.tenantId, mfa: 'ok' } : { typ: 'platform', sub: u.id, mfa: 'ok' }, { userAgent: req.headers['user-agent'], ip: req.ip });
    });
    return { ...setRefreshCookie(reply, a.aud, session), recoveryCodes: codes };
  });

  /** Step up an existing session (e.g. after a policy was switched on) by presenting a code. */
  app.post('/auth/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: codeBody, response: { 200: sessionOut } } }, async (req, reply) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    const family = await currentFamily(req, a.aud);
    const session = await asSystem(async (tx) => {
      await checkSecondFactor(tx, u, req.body.code);
      if (family) await tx.delete(refreshTokens).where(eq(refreshTokens.familyId, family));
      return issueSession(tx, a.tenantId ? { typ: 'staff', sub: u.id, tid: a.tenantId, mfa: 'ok' } : { typ: 'platform', sub: u.id, mfa: 'ok' }, { userAgent: req.headers['user-agent'], ip: req.ip });
    });
    return setRefreshCookie(reply, a.aud, session);
  });

  app.post('/auth/mfa/disable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: codeBody.extend({ password: z.string().min(1).max(200) }) } }, async (req) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    if (!u.mfaEnabledAt) throw conflict('Two-step sign-in is already off');
    await asSystem(async (tx) => {
      if (await mfaRequired(tx, u)) throw conflict('Your organisation requires two-step sign-in for this account');
      if (!u.passwordHash || !(await verifyPassword(u.passwordHash, req.body.password))) throw unauthorized('Incorrect password');
      await checkSecondFactor(tx, u, req.body.code);
      await tx.update(users).set({ mfaEnabledAt: null, mfaSecret: null, mfaRecoveryHashes: [] }).where(eq(users.id, u.id));
      await audit(tx, req, { action: 'auth.mfa_disabled', entityType: 'user', entityId: u.id, tenantId: a.tenantId, actor: { type: a.aud === 'platform' ? 'platform' : 'user', id: u.id } });
    });
    return { ok: true };
  });

  app.post('/auth/mfa/recovery-codes', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['auth'], body: codeBody } }, async (req) => {
    const a = account(req);
    const u = await loadUser(a.userId);
    if (!u.mfaEnabledAt) throw conflict('Turn on two-step sign-in first');
    const codes = newRecoveryCodes();
    await asSystem(async (tx) => {
      await checkSecondFactor(tx, u, req.body.code);
      await tx.update(users).set({ mfaRecoveryHashes: codes.map(recoveryHash) }).where(eq(users.id, u.id));
    });
    return { recoveryCodes: codes };
  });

  // ---------------- Signed-in devices ----------------
  app.get('/auth/sessions', { schema: { tags: ['auth'] } }, async (req) => {
    const a = account(req);
    const current = await currentFamily(req, a.aud);
    const rows = await asSystem((tx) => tx.select({
      familyId: refreshTokens.familyId,
      userAgent: sql<string | null>`(array_agg(${refreshTokens.userAgent} order by ${refreshTokens.createdAt} desc))[1]`,
      ip: sql<string | null>`(array_agg(${refreshTokens.ip} order by ${refreshTokens.createdAt} desc))[1]`,
      lastActiveAt: sql<string>`max(${refreshTokens.createdAt})`,
      device: sql<boolean>`bool_or(${refreshTokens.deviceId} is not null)`,
    }).from(refreshTokens)
      .where(and(eq(refreshTokens.userId, a.userId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .groupBy(refreshTokens.familyId).orderBy(desc(sql`max(${refreshTokens.createdAt})`)));
    return { data: rows.map((r) => ({ id: r.familyId, userAgent: r.userAgent, ip: r.ip, lastActiveAt: r.lastActiveAt, sharedDevice: r.device, current: r.familyId === current })) };
  });

  app.delete('/auth/sessions/:id', { schema: { tags: ['auth'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const a = account(req);
    const n = await asSystem((tx) => tx.delete(refreshTokens).where(and(eq(refreshTokens.familyId, req.params.id), eq(refreshTokens.userId, a.userId))).returning({ id: refreshTokens.id }));
    if (!n.length) throw notFound('Session');
    return reply.status(204).send();
  });

  app.post('/auth/sessions/sign-out-others', { schema: { tags: ['auth'] } }, async (req) => {
    const a = account(req);
    const current = await currentFamily(req, a.aud);
    const n = await asSystem((tx) => tx.delete(refreshTokens).where(and(eq(refreshTokens.userId, a.userId), current ? ne(refreshTokens.familyId, current) : undefined)).returning({ id: refreshTokens.id }));
    return { ok: true, signedOut: new Set(n.map((x) => x.id)).size };
  });

  // ---------------- Tenant policy + help for staff who lost their phone ----------------
  app.get('/admin/security-settings', { preHandler: requireStaff('tenant.settings'), schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    const [row] = await asSystem((tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t.id)));
    const sec = (row?.settings?.security ?? {}) as { requireMfa?: MfaPolicy };
    return { data: { requireMfa: sec.requireMfa ?? 'off' } };
  });

  app.put('/admin/security-settings', {
    preHandler: requireStaff('tenant.settings'),
    schema: { tags: ['admin'], body: z.object({ requireMfa: z.enum(['off', 'admins', 'all']) }) },
  }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    await withTenant(t.id, async (tx) => {
      // Don't let an owner lock themselves out: they must be enrolled before requiring it of admins/all.
      if (req.body.requireMfa !== 'off') {
        const [u] = await tx.select({ on: users.mfaEnabledAt }).from(users).where(eq(users.id, me.userId));
        if (!u?.on) throw new AppError(409, 'enrol_first', 'Turn on two-step sign-in for your own account first');
      }
      await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t.id));
      await tx.update(tenants).set({ settings: { ...(row?.settings ?? {}), security: { ...((row?.settings?.security as object) ?? {}), requireMfa: req.body.requireMfa } } }).where(eq(tenants.id, t.id));
      await audit(tx, req, { action: 'security.policy', entityType: 'tenant', entityId: t.id, changes: req.body });
    });
    return { data: req.body };
  });

  app.post('/admin/staff/:id/reset-mfa', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [u] = await tx.update(users).set({ mfaEnabledAt: null, mfaSecret: null, mfaRecoveryHashes: [] }).where(and(eq(users.id, req.params.id), eq(users.tenantId, t.id))).returning({ id: users.id });
      if (!u) throw notFound('Staff member');
      await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, u.id));
      await audit(tx, req, { action: 'staff.reset_mfa', entityType: 'user', entityId: u.id });
    });
    await invalidateStaffAccess(t.id, req.params.id);
    return { ok: true };
  });
};
