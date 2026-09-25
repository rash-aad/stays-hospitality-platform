import { domains } from '@hp/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { asSystem } from '../infra/db.js';
import { runtimeConfig } from '../runtime.js';

/** Ask the web tier to drop cached pages for every host of a tenant (fire-and-forget). */
export function purgeSite(tenantId: string) {
  const cfg = runtimeConfig();
  if (!cfg.REVALIDATE_SECRET || cfg.NODE_ENV === 'test') return;
  void (async () => {
    const rows = await asSystem((tx) => tx.select({ h: domains.hostname }).from(domains).where(and(eq(domains.tenantId, tenantId), isNotNull(domains.verifiedAt))));
    await fetch(`${cfg.WEB_INTERNAL_URL}/internal/revalidate`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-revalidate-secret': cfg.REVALIDATE_SECRET! },
      body: JSON.stringify({ hosts: rows.map((r) => r.h) }), signal: AbortSignal.timeout(5000),
    });
  })().catch(() => {});
}
