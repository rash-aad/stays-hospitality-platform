import { dependentsOf, MODULES, type ModuleKey } from '@hp/contracts';
import { tenantModules } from '@hp/db';
import { and, eq, inArray } from 'drizzle-orm';
import { badRequest } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { invalidateTenant } from './tenant-cache.js';

export async function listModules(tx: Tx, tenantId: string) {
  const rows = await tx.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
  const on = new Map(rows.map((r) => [r.moduleKey, r.enabled]));
  return (Object.keys(MODULES) as ModuleKey[]).map((key) => ({
    key, ...MODULES[key], requires: [...MODULES[key].requires], enabled: on.get(key) ?? false,
  }));
}

/**
 * Toggle a module. Enabling requires prerequisites to be on; disabling cascades to dependents
 * so no orphaned capability stays reachable.
 */
export async function setModule(tx: Tx, tenantId: string, key: ModuleKey, enabled: boolean) {
  const current = await listModules(tx, tenantId);
  const changed: ModuleKey[] = [key];
  if (enabled) {
    const missing = (MODULES[key].requires as readonly ModuleKey[]).filter((r) => !current.find((m) => m.key === r)?.enabled);
    if (missing.length) throw badRequest(`Enable ${missing.map((m) => MODULES[m].name).join(', ')} first`, { requires: missing });
  } else {
    changed.push(...dependentsOf(key));
  }
  await tx
    .insert(tenantModules)
    .values(changed.map((k) => ({ tenantId, moduleKey: k, enabled })))
    .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleKey], set: { enabled, updatedAt: new Date() } });
  if (!enabled && changed.length > 1) {
    await tx.update(tenantModules).set({ enabled: false }).where(and(eq(tenantModules.tenantId, tenantId), inArray(tenantModules.moduleKey, changed)));
  }
  await invalidateTenant(tenantId);
  return changed;
}
