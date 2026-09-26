import { tenants, users } from '@hp/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { redis } from '../../infra/redis.js';
import { decryptSecret } from '../../lib/crypto.js';
import { sha256 } from '../../lib/ids.js';
import { verifyTotp } from '../../lib/totp.js';
import { runtimeConfig } from '../../runtime.js';
import { loadStaffAccess } from './permissions.js';

type User = typeof users.$inferSelect;
export type MfaPolicy = 'off' | 'admins' | 'all';

export function platformRequiresMfa() {
  const c = runtimeConfig();
  return c.PLATFORM_REQUIRE_MFA ? c.PLATFORM_REQUIRE_MFA === '1' : c.NODE_ENV === 'production';
}

export async function tenantMfaPolicy(tx: Tx, tenantId: string): Promise<MfaPolicy> {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const p = (t?.settings?.security as { requireMfa?: MfaPolicy } | undefined)?.requireMfa;
  return p === 'admins' || p === 'all' ? p : 'off';
}

/** Whether this account must use two-step sign-in: always for platform admins in production; per tenant policy otherwise. */
export async function mfaRequired(tx: Tx, u: User): Promise<boolean> {
  if (!u.tenantId) return u.isPlatformAdmin && platformRequiresMfa();
  const policy = await tenantMfaPolicy(tx, u.tenantId);
  if (policy === 'all') return true;
  if (policy === 'off') return false;
  const access = await loadStaffAccess(u.tenantId, u.id);
  return access.isOwner || access.permissions.includes('staff.manage') || access.permissions.includes('tenant.settings');
}

/**
 * Check a 6-digit authenticator code (each time-step accepted once) or a one-time recovery code,
 * which is consumed on use.
 */
export async function checkSecondFactor(tx: Tx, u: User, code: string): Promise<void> {
  const clean = code.trim().toLowerCase().replace(/\s/g, '');
  if (!u.mfaSecret) throw new AppError(400, 'mfa_not_set_up', 'Two-step sign-in is not set up');
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(u.mfaSecret, runtimeConfig().SECRETS_MASTER_KEY), clean);
    // A code can be used only once, so an observed code can't be replayed within its 30 s window.
    if (step !== null && (await redis().set(`mfa:used:${u.id}:${step}`, '1', 'EX', 120, 'NX')) === 'OK') return;
    throw new AppError(401, 'mfa_invalid', 'That code didn’t match. Check your authenticator app and try again.');
  }
  const h = sha256(clean.replace(/[^a-z0-9]/g, '').replace(/^(.{4})/, '$1-'));
  if (u.mfaRecoveryHashes.includes(h)) {
    await tx.update(users).set({ mfaRecoveryHashes: u.mfaRecoveryHashes.filter((x) => x !== h) }).where(eq(users.id, u.id));
    return;
  }
  throw new AppError(401, 'mfa_invalid', 'That code didn’t match. Check your authenticator app and try again.');
}
