import { guests, properties, tenants, users } from '@hp/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest, unauthorized } from '../../http/errors.js';
import { resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { notify } from '../notifications/notify.js';
import { siteUrl } from '../../lib/site-url.js';
import {
  consumeOneTimeToken, createOneTimeToken, hashPassword, issueSession, revokeRefresh, rotateRefresh,
  staffLogin, validatePasswordStrength, verifyPassword, REFRESH_TTL_DAYS, type Session,
} from './service.js';

const COOKIE = { staff: 'hp_rt_staff', guest: 'hp_rt_guest' } as const;
type Audience = keyof typeof COOKIE;

const sessionOut = z.object({ accessToken: z.string(), expiresIn: z.number() });
const loginLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: Routes = async (app, { config }) => {
  const secure = config.NODE_ENV === 'production';
  function setRefresh(reply: FastifyReply, aud: Audience, s: Session) {
    reply.setCookie(COOKIE[aud], s.refreshToken, {
      httpOnly: true, secure, sameSite: 'lax', path: '/api/v1/auth', maxAge: REFRESH_TTL_DAYS * 86400,
    });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn };
  }
  /** Cookie-authenticated endpoints require a custom header: cross-site forms cannot set it and CORS blocks scripts. */
  function assertCsrf(headers: Record<string, unknown>) {
    if (headers['x-csrf'] !== '1') throw new AppError(403, 'csrf', 'Missing CSRF header');
  }

  // ---------------- Staff / platform ----------------
  app.post('/auth/staff/login', {
    config: loginLimit,
    schema: {
      tags: ['auth'],
      body: z.object({ email: z.string().email(), password: z.string().min(1).max(200), workspace: z.string().optional() }),
      response: { 200: sessionOut.extend({ user: z.object({ id: z.string(), name: z.string(), email: z.string() }), kind: z.enum(['staff', 'platform']), workspace: z.object({ slug: z.string().nullable(), name: z.string().nullable() }).nullable() }) },
    },
  }, async (req, reply) => {
    const r = await staffLogin({ ...req.body, tenantSlug: req.body.workspace, userAgent: req.headers['user-agent'] });
    await asSystem((tx) => audit(tx, null, { action: 'auth.login', entityType: 'user', entityId: r.user.id, tenantId: 'tid' in r.session.claims ? r.session.claims.tid : null }));
    return { ...setRefresh(reply, 'staff', r.session), user: r.user, kind: r.session.claims.typ === 'platform' ? 'platform' as const : 'staff' as const, workspace: r.tenant };
  });

  app.post('/auth/refresh', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['auth'], querystring: z.object({ aud: z.enum(['staff', 'guest']).default('staff') }), response: { 200: sessionOut } },
  }, async (req, reply) => {
    assertCsrf(req.headers);
    const token = req.cookies[COOKIE[req.query.aud]];
    if (!token) throw unauthorized('Session expired');
    return setRefresh(reply, req.query.aud, await rotateRefresh(token, req.headers['user-agent']));
  });

  app.post('/auth/logout', {
    schema: { tags: ['auth'], querystring: z.object({ aud: z.enum(['staff', 'guest']).default('staff') }) },
  }, async (req, reply) => {
    assertCsrf(req.headers);
    const token = req.cookies[COOKIE[req.query.aud]];
    if (token) await revokeRefresh(token);
    reply.clearCookie(COOKIE[req.query.aud], { path: '/api/v1/auth' });
    return { ok: true };
  });

  app.get('/auth/me', { schema: { tags: ['auth'] } }, async (req) => {
    const a = req.actor;
    if (a.type === 'anon') throw unauthorized();
    if (a.type === 'guest') {
      const [g] = await withTenant(a.tenantId, (tx) => tx.select().from(guests).where(eq(guests.id, a.guestId)));
      return { kind: 'guest', guest: { id: g!.id, firstName: g!.firstName, lastName: g!.lastName, email: g!.email, phone: g!.phone }, tenant: pickTenant(req.tenant) };
    }
    const [u] = await asSystem((tx) => tx.select().from(users).where(eq(users.id, a.userId)));
    const base = { id: u!.id, name: u!.name, email: u!.email, emailVerified: !!u!.emailVerifiedAt };
    if (a.type === 'platform') return { kind: 'platform', user: base };
    return { kind: 'staff', user: base, isOwner: a.isOwner, permissions: [...a.permissions], tenant: pickTenant(req.tenant) };
  });

  app.post('/auth/password/forgot', {
    config: loginLimit,
    schema: { tags: ['auth'], body: z.object({ email: z.string().email(), workspace: z.string().optional() }) },
  }, async (req) => {
    // Always respond identically to avoid account enumeration.
    await asSystem(async (tx) => {
      const rows = await tx
        .select({ u: users, slug: tenants.slug, tname: tenants.name })
        .from(users)
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(sql`lower(${users.email})`, req.body.email.toLowerCase()));
      for (const r of rows.filter((x) => !req.body.workspace || x.slug === req.body.workspace)) {
        if (!r.u.tenantId) continue; // platform admins reset out of band
        const token = await createOneTimeToken(tx, { kind: 'password_reset', tenantId: r.u.tenantId, userId: r.u.id, ttlMinutes: 60 });
        await notify(tx, {
          tenantId: r.u.tenantId, recipient: { type: 'user', id: r.u.id }, templateKey: 'auth.password_reset', channels: ['email'],
          vars: { name: r.u.name, link: `${config.WEB_PUBLIC_URL}/admin/reset-password?token=${token}` },
        });
      }
    });
    return { ok: true };
  });

  app.post('/auth/password/reset', {
    config: loginLimit,
    schema: { tags: ['auth'], body: z.object({ token: z.string().min(10), password: z.string().max(200) }) },
  }, async (req) => {
    validatePasswordStrength(req.body.password);
    await asSystem(async (tx) => {
      const t = await consumeOneTimeToken(tx, req.body.token, 'password_reset');
      if (t.userId) {
        await tx.update(users).set({ passwordHash: await hashPassword(req.body.password), failedLogins: 0, lockedUntil: null, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, t.userId));
      } else if (t.guestId) {
        await tx.update(guests).set({ passwordHash: await hashPassword(req.body.password) }).where(eq(guests.id, t.guestId));
      }
      await audit(tx, req, { action: 'auth.password_reset', entityType: t.userId ? 'user' : 'guest', entityId: (t.userId ?? t.guestId)!, tenantId: t.tenantId });
    });
    return { ok: true };
  });

  /** Accept a staff invite: set password and activate. */
  app.post('/auth/invite/accept', {
    config: loginLimit,
    schema: { tags: ['auth'], body: z.object({ token: z.string().min(10), password: z.string().max(200) }) },
  }, async (req) => {
    validatePasswordStrength(req.body.password);
    await asSystem(async (tx) => {
      const t = await consumeOneTimeToken(tx, req.body.token, 'staff_invite');
      await tx.update(users).set({ passwordHash: await hashPassword(req.body.password), status: 'active', emailVerifiedAt: new Date() }).where(eq(users.id, t.userId!));
    });
    return { ok: true };
  });

  app.post('/auth/email/verify', {
    schema: { tags: ['auth'], body: z.object({ token: z.string().min(10) }) },
  }, async (req) => {
    await asSystem(async (tx) => {
      const t = await consumeOneTimeToken(tx, req.body.token, 'email_verify');
      if (t.userId) await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
      if (t.guestId) await tx.update(guests).set({ emailVerifiedAt: new Date() }).where(eq(guests.id, t.guestId));
    });
    return { ok: true };
  });

  // ---------------- Guests (tenant resolved from site host) ----------------
  app.post('/guest-auth/register', {
    config: loginLimit,
    preHandler: resolvePublicTenant,
    schema: {
      tags: ['guest-auth'],
      body: z.object({ email: z.string().email(), password: z.string().max(200), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().max(30).optional() }),
    },
  }, async (req, reply) => {
    validatePasswordStrength(req.body.password);
    const tenant = tenantOf(req);
    const session = await withTenant(tenant.id, async (tx) => {
      const [existing] = await tx.select().from(guests).where(and(eq(guests.tenantId, tenant.id), eq(sql`lower(${guests.email})`, req.body.email.toLowerCase())));
      if (existing?.passwordHash) throw new AppError(409, 'account_exists', 'An account with this email already exists. Sign in instead.');
      const pw = await hashPassword(req.body.password);
      let guestId: string;
      if (existing) {
        // Guest booked before without an account: claiming requires email verification before stays are visible.
        await tx.update(guests).set({ passwordHash: pw, emailVerifiedAt: null }).where(eq(guests.id, existing.id));
        guestId = existing.id;
      } else {
        const [g] = await tx.insert(guests).values({ tenantId: tenant.id, email: req.body.email, firstName: req.body.firstName, lastName: req.body.lastName, phone: req.body.phone, passwordHash: pw }).returning();
        guestId = g!.id;
      }
      const token = await createOneTimeToken(tx, { kind: 'email_verify', tenantId: tenant.id, guestId, ttlMinutes: 60 * 24 });
      const [prop] = await tx.select({ name: properties.name }).from(properties).limit(1);
      await notify(tx, {
        tenantId: tenant.id, recipient: { type: 'guest', id: guestId }, templateKey: 'auth.email_verify', channels: ['email'],
        vars: { name: req.body.firstName, property: prop?.name ?? tenant.name, link: `${await siteUrl(tx, tenant.id)}/stay/verify?token=${token}` },
      });
      return issueSession(tx, { typ: 'guest', sub: guestId, tid: tenant.id }, { userAgent: req.headers['user-agent'] });
    });
    return setRefresh(reply, 'guest', session);
  });

  app.post('/guest-auth/login', {
    config: loginLimit,
    preHandler: resolvePublicTenant,
    schema: { tags: ['guest-auth'], body: z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), response: { 200: sessionOut } },
  }, async (req, reply) => {
    const tenant = tenantOf(req);
    const session = await withTenant(tenant.id, async (tx) => {
      const [g] = await tx.select().from(guests).where(and(eq(guests.tenantId, tenant.id), eq(sql`lower(${guests.email})`, req.body.email.toLowerCase())));
      if (!g?.passwordHash || !(await verifyPassword(g.passwordHash, req.body.password))) throw unauthorized('Incorrect email or password');
      return issueSession(tx, { typ: 'guest', sub: g.id, tid: tenant.id }, { userAgent: req.headers['user-agent'] });
    });
    return setRefresh(reply, 'guest', session);
  });

  /**
   * Request a private access link. Requires both the booking reference and the email on the booking,
   * and the link is only ever sent to that email — the response never reveals whether they matched.
   */
  app.post('/guest-auth/access-link', {
    config: loginLimit,
    preHandler: resolvePublicTenant,
    schema: { tags: ['guest-auth'], body: z.object({ email: z.string().email(), reference: z.string().min(4).max(20) }) },
  }, async (req) => {
    const tenant = tenantOf(req);
    const { sendGuestAccessLink } = await import('../guests/access.js');
    await withTenant(tenant.id, (tx) => sendGuestAccessLink(tx, { tenant, email: req.body.email, reference: req.body.reference, webUrl: config.WEB_PUBLIC_URL }));
    return { ok: true };
  });

  app.post('/guest-auth/access-link/redeem', {
    config: loginLimit,
    preHandler: resolvePublicTenant,
    schema: { tags: ['guest-auth'], body: z.object({ token: z.string().min(10) }), response: { 200: sessionOut } },
  }, async (req, reply) => {
    const tenant = tenantOf(req);
    const session = await withTenant(tenant.id, async (tx) => {
      const t = await consumeOneTimeToken(tx, req.body.token, 'guest_access');
      if (t.tenantId !== tenant.id || !t.guestId) throw badRequest('This link is invalid or has expired');
      // Possession of the emailed link proves control of the address.
      await tx.update(guests).set({ emailVerifiedAt: sql`coalesce(${guests.emailVerifiedAt}, now())` }).where(eq(guests.id, t.guestId));
      return issueSession(tx, { typ: 'guest', sub: t.guestId, tid: tenant.id }, { userAgent: req.headers['user-agent'] });
    });
    return setRefresh(reply, 'guest', session);
  });
};

function pickTenant(t: { id: string; slug: string; name: string; currency: string; timezone: string; modules: Set<string> } | null) {
  return t && { id: t.id, slug: t.slug, name: t.name, currency: t.currency, timezone: t.timezone, modules: [...t.modules] };
}
