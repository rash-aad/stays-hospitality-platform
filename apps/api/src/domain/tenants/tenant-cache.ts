import { effectiveModules } from '@hp/contracts';
import { domains, tenantModules, tenantSubscriptions, tenants } from '@hp/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { asSystem } from '../../infra/db.js';
import { redis } from '../../infra/redis.js';
import type { TenantInfo } from '../../http/context.js';

const TTL = 300;
type Cached = Omit<TenantInfo, 'modules'> & { modules: string[] };

export async function loadTenant(tenantId: string): Promise<TenantInfo | null> {
  const key = `tenant:${tenantId}`;
  const hit = await redis().get(key);
  let data: Cached | null = hit ? (JSON.parse(hit) as Cached) : null;
  if (!data) {
    data = await asSystem(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!t) return null;
      const mods = await tx
        .select({ key: tenantModules.moduleKey })
        .from(tenantModules)
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)));
      const [sub] = await tx.select({ reason: tenantSubscriptions.suspendedReason }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
      return {
        id: t.id, slug: t.slug, name: t.name, status: t.status, currency: t.currency, timezone: t.timezone,
        modules: mods.map((m) => m.key), billingLocked: t.status === 'suspended' && sub?.reason === 'non_payment',
      };
    });
    if (!data) return null;
    await redis().set(key, JSON.stringify(data), 'EX', TTL);
  }
  return { ...data, modules: effectiveModules(data.modules) };
}

export async function invalidateTenant(tenantId: string) {
  await redis().del(`tenant:${tenantId}`);
}

function normaliseHost(host: string) {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * Resolve a request hostname to a tenant. Custom domains must be verified; platform
 * subdomains (<slug>.<root>) resolve by tenant slug.
 */
export async function resolveHost(rawHost: string, rootDomain: string): Promise<string | null> {
  const host = normaliseHost(rawHost);
  if (!host) return null;
  const key = `host:${host}`;
  const hit = await redis().get(key);
  if (hit) return hit === '-' ? null : hit;
  const tenantId = await asSystem(async (tx) => {
    const [d] = await tx
      .select({ tenantId: domains.tenantId })
      .from(domains)
      .where(and(eq(sql`lower(${domains.hostname})`, host), isNotNull(domains.verifiedAt)));
    if (d) return d.tenantId;
    const root = normaliseHost(rootDomain);
    if (host.endsWith(`.${root}`)) {
      const slug = host.slice(0, -(root.length + 1));
      if (/^[a-z0-9-]+$/.test(slug)) {
        const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
        if (t) return t.id;
      }
    }
    return null;
  });
  await redis().set(key, tenantId ?? '-', 'EX', 60);
  return tenantId;
}

export async function invalidateHost(host: string) {
  await redis().del(`host:${normaliseHost(host)}`);
}

export async function resolveSlug(slug: string): Promise<string | null> {
  return asSystem(async (tx) => {
    const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
    return t?.id ?? null;
  });
}
