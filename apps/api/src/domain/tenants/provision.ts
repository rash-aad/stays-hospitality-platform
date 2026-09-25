import { MODULE_KEYS, PERMISSIONS, SYSTEM_ROLES, type ModuleKey } from '@hp/contracts';
import { domains, paymentSettings, permissions, rolePermissions, roles, siteSettings, tenantModules, tenants, themes, users } from '@hp/db';
import { randomToken } from '../../lib/ids.js';
import type { Tx } from '../../infra/db.js';

/** Ensure the global permission catalog matches the code. */
export async function syncPermissions(tx: Tx) {
  await tx
    .insert(permissions)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoNothing();
}

export async function createSystemRoles(tx: Tx, tenantId: string) {
  const out: Record<string, string> = {};
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const [r] = await tx.insert(roles).values({ tenantId, key, name: def.name, isSystem: true }).returning();
    out[key] = r!.id;
    const perms = def.permissions === '*' ? Object.keys(PERMISSIONS) : def.permissions;
    if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ tenantId, roleId: r!.id, permissionKey: p })));
  }
  return out;
}

/**
 * Onboard a tenant without engineering intervention: tenant row, modules, system roles,
 * owner account (invited), platform subdomain, default site/theme and payment settings.
 */
export async function provisionTenant(
  tx: Tx,
  input: {
    name: string; slug: string; currency?: string; timezone?: string; contactEmail?: string;
    modules?: ModuleKey[]; templateKey?: string; rootDomain: string;
    owner?: { name: string; email: string; passwordHash?: string };
  },
) {
  await syncPermissions(tx);
  const [t] = await tx
    .insert(tenants)
    .values({ name: input.name, slug: input.slug, currency: input.currency ?? 'INR', timezone: input.timezone ?? 'Asia/Kolkata', contactEmail: input.contactEmail })
    .returning();
  const tenantId = t!.id;
  const enabled = new Set(input.modules ?? ['room_booking', 'payments', 'guest_portal', 'website_builder', 'notifications', 'reports']);
  await tx.insert(tenantModules).values(MODULE_KEYS.map((k) => ({ tenantId, moduleKey: k, enabled: enabled.has(k) })));
  const roleIds = await createSystemRoles(tx, tenantId);
  await tx.insert(domains).values({
    tenantId, hostname: `${input.slug}.${input.rootDomain}`, kind: 'subdomain', verificationToken: randomToken(16), verifiedAt: new Date(), isPrimary: true,
  });
  await tx.insert(themes).values({ tenantId, templateKey: input.templateKey ?? 'luxury' });
  await tx.insert(siteSettings).values({ tenantId });
  await tx.insert(paymentSettings).values({ tenantId, methodsEnabled: ['pay_at_property'] });
  let ownerId: string | null = null;
  if (input.owner) {
    const [u] = await tx
      .insert(users)
      .values({
        tenantId, email: input.owner.email, name: input.owner.name, passwordHash: input.owner.passwordHash,
        status: input.owner.passwordHash ? 'active' : 'invited', emailVerifiedAt: input.owner.passwordHash ? new Date() : null,
      })
      .returning();
    ownerId = u!.id;
    const { userRoles } = await import('@hp/db');
    await tx.insert(userRoles).values({ tenantId, userId: ownerId, roleId: roleIds.owner! });
  }
  return { tenant: t!, ownerId, roleIds };
}
