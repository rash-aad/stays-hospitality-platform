import { hash, verify } from '@node-rs/argon2';
import { authTokens, guests, refreshTokens, tenants, users } from '@hp/db';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError, badRequest, unauthorized } from '../../http/errors.js';
import { asSystem, type Tx } from '../../infra/db.js';
import { randomToken, sha256 } from '../../lib/ids.js';
import { mfaRequired } from './mfa.js';
import { signAccess, signMfaChallenge, ACCESS_TTL_SECONDS, type AccessClaims, type MfaState } from './tokens.js';

export const REFRESH_TTL_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

// Burn comparable time when the account does not exist to avoid user enumeration by timing.
let dummyHash: Promise<string> | null = null;
async function burn(pw: string) {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummyHash, pw);
}

export type Session = { accessToken: string; expiresIn: number; refreshToken: string; claims: AccessClaims };

export async function issueSession(
  tx: Tx,
  claims: AccessClaims,
  opts: { userAgent?: string; familyId?: string; ip?: string; deviceId?: string | null } = {},
): Promise<Session> {
  const refreshToken = randomToken(48);
  await tx.insert(refreshTokens).values({
    ip: opts.ip?.slice(0, 60), deviceId: opts.deviceId ?? null, mfa: claims.typ === 'guest' ? null : claims.mfa ?? null,
    tenantId: 'tid' in claims ? claims.tid : null,
    userId: claims.typ === 'guest' ? null : claims.sub,
    guestId: claims.typ === 'guest' ? claims.sub : null,
    tokenHash: sha256(refreshToken),
    familyId: opts.familyId ?? randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
    userAgent: opts.userAgent?.slice(0, 300),
  });
  return { accessToken: await signAccess(claims), expiresIn: ACCESS_TTL_SECONDS, refreshToken, claims };
}

/** Staff and platform login. Email may exist in several tenants; `tenantSlug` disambiguates. */
export async function staffLogin(input: { email: string; password: string; tenantSlug?: string; userAgent?: string; ip?: string; allowPlatform?: (ip: string) => boolean }) {
  // Failure bookkeeping (failed-attempt counters, lockouts) must commit, so errors are raised after the transaction.
  const outcome = await asSystem(async (tx) => {
    const rows = await tx
      .select({ user: users, tenantSlug: tenants.slug, tenantName: tenants.name, tenantStatus: tenants.status })
      .from(users)
      .leftJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()));
    const candidates = input.tenantSlug ? rows.filter((r) => r.tenantSlug === input.tenantSlug) : rows;
    if (candidates.length === 0) {
      await burn(input.password);
      return { error: unauthorized('Incorrect email or password') } as const;
    }
    const now = new Date();
    const matches: typeof candidates = [];
    for (const c of candidates) {
      if (c.user.lockedUntil && c.user.lockedUntil > now) continue;
      if (c.user.passwordHash && (await verifyPassword(c.user.passwordHash, input.password))) matches.push(c);
      else {
        const failed = c.user.failedLogins + 1;
        await tx
          .update(users)
          .set({ failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, c.user.id));
      }
    }
    if (matches.length === 0) {
      const locked = await tx.select({ lockedUntil: users.lockedUntil }).from(users).where(inArray(users.id, candidates.map((c) => c.user.id)));
      if (locked.every((c) => c.lockedUntil && c.lockedUntil > now)) {
        return { error: new AppError(429, 'locked', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`) } as const;
      }
      return { error: unauthorized('Incorrect email or password') } as const;
    }
    if (matches.length > 1) {
      return { error: new AppError(409, 'choose_workspace', 'This email belongs to more than one workspace', {
        workspaces: matches.map((m) => ({ slug: m.tenantSlug, name: m.tenantName })),
      }) } as const;
    }
    const m = matches[0]!;
    if (m.user.status !== 'active') throw unauthorized('This account is not active');
    if (m.user.tenantId && m.tenantStatus !== 'active') throw unauthorized('This workspace is suspended');
    const isPlatform = m.user.isPlatformAdmin && !m.user.tenantId;
    if (isPlatform && input.allowPlatform && !input.allowPlatform(input.ip ?? '')) throw new AppError(403, 'ip_not_allowed', 'The platform console can’t be used from this network');
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, m.user.id));
    const user = { id: m.user.id, name: m.user.name, email: m.user.email };
    const tenant = m.tenantSlug ? { slug: m.tenantSlug, name: m.tenantName } : null;
    // Two-step sign-in: the password alone only earns a short-lived challenge.
    if (m.user.mfaEnabledAt) return { mfaChallenge: await signMfaChallenge(m.user.id), user, tenant };
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, m.user.id));
    const mfa: MfaState | undefined = (await mfaRequired(tx, m.user)) ? 'pending' : undefined;
    const claims: AccessClaims = isPlatform ? { typ: 'platform', sub: m.user.id, mfa } : { typ: 'staff', sub: m.user.id, tid: m.user.tenantId!, mfa };
    const session = await issueSession(tx, claims, { userAgent: input.userAgent, ip: input.ip });
    return { session, user, tenant };
  });
  if ('error' in outcome) throw outcome.error;
  return outcome;
}

/**
 * Rotate a refresh token. Presenting an already-rotated token revokes the whole family
 * (token theft detection).
 */
export async function rotateRefresh(token: string, userAgent?: string) {
  const outcome = await asSystem(async (tx) => {
    const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
    if (!row?.revokedAt) return 'fresh' as const;
    // A rotated token presented again. If it was rotated moments ago and its successor has never been
    // used, the client simply lost the refresh response (e.g. navigated mid-request): allow it once.
    // Compared in SQL: timestamps are microsecond-precise there, millisecond-precise in JS.
    const [{ used }] = (await tx.execute(sql`select exists(select 1 from refresh_tokens t where t.family_id = ${row.familyId}
      and t.created_at > (select created_at from refresh_tokens where id = ${row.id}) and t.revoked_at is not null) as used`)) as unknown as [{ used: boolean }];
    if (!used && Date.now() - row.revokedAt.getTime() < REUSE_GRACE_MS) {
      // Delete (not revoke) the never-used successor so it can never claim this grace itself.
      await tx.delete(refreshTokens).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      return { grace: row } as const;
    }
    // Otherwise assume theft and destroy the whole family (committed before we reject). Deleting rather
    // than revoking ensures no member of a compromised family can ever qualify for the grace path.
    await tx.delete(refreshTokens).where(eq(refreshTokens.familyId, row.familyId));
    return 'stolen' as const;
  });
  if (outcome === 'stolen') throw unauthorized('Session expired');
  if (typeof outcome === 'object') return asSystem(async (tx) => issueSession(tx, await claimsFor(tx, outcome.grace), { userAgent, familyId: outcome.grace.familyId, ip: outcome.grace.ip ?? undefined, deviceId: outcome.grace.deviceId }));
  return asSystem(async (tx) => {
    const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token))).for('update');
    if (!row || row.revokedAt) throw unauthorized('Session expired');
    if (row.expiresAt < new Date()) throw unauthorized('Session expired');
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return issueSession(tx, await claimsFor(tx, row), { userAgent, familyId: row.familyId, ip: row.ip ?? undefined, deviceId: row.deviceId });
  });
}

const REUSE_GRACE_MS = 10_000;

async function claimsFor(tx: Tx, row: typeof refreshTokens.$inferSelect): Promise<AccessClaims> {
  if (row.guestId) {
    const [g] = await tx.select({ id: guests.id, tenantId: guests.tenantId }).from(guests).where(eq(guests.id, row.guestId));
    if (!g) throw unauthorized('Session expired');
    return { typ: 'guest', sub: g.id, tid: g.tenantId };
  }
  const [u] = await tx.select().from(users).where(eq(users.id, row.userId!));
  if (!u || u.status !== 'active') throw unauthorized('Session expired');
  // A session keeps its second-factor state; a policy switched on later demotes older sessions to 'pending'.
  const mfa: MfaState | undefined = row.mfa === 'ok' ? 'ok' : (await mfaRequired(tx, u)) || u.mfaEnabledAt ? 'pending' : undefined;
  return u.isPlatformAdmin && !u.tenantId ? { typ: 'platform', sub: u.id, mfa } : { typ: 'staff', sub: u.id, tid: u.tenantId!, mfa };
}

export async function revokeRefresh(token: string) {
  await asSystem((tx) =>
    tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, sha256(token)), isNull(refreshTokens.revokedAt))),
  );
}

export async function createOneTimeToken(
  tx: Tx,
  input: { kind: 'email_verify' | 'password_reset' | 'guest_access' | 'staff_invite'; tenantId: string | null; userId?: string; guestId?: string; bookingId?: string; ttlMinutes: number },
) {
  const token = randomToken(32);
  await tx.insert(authTokens).values({
    kind: input.kind, tenantId: input.tenantId, userId: input.userId, guestId: input.guestId, bookingId: input.bookingId,
    tokenHash: sha256(token), expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
  });
  return token;
}

/** Atomically consume a one-time token of the given kind. */
export async function consumeOneTimeToken(tx: Tx, token: string, kind: string) {
  const [row] = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind as 'email_verify'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  if (!row) throw badRequest('This link is invalid or has expired');
  return row;
}

export function validatePasswordStrength(pw: string) {
  if (pw.length < 10) throw badRequest('Password must be at least 10 characters');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) throw badRequest('Password must contain letters and numbers');
}
