import { domains } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../infra/db.js';
import { runtimeConfig } from '../runtime.js';

/**
 * Public base URL of a tenant's own site (primary domain), used for every guest-facing link so
 * emails open the property's branded portal rather than the platform host.
 */
export async function siteUrl(tx: Tx, tenantId: string): Promise<string> {
  const base = new URL(runtimeConfig().WEB_PUBLIC_URL);
  const [d] = await tx.select({ hostname: domains.hostname, kind: domains.kind }).from(domains).where(and(eq(domains.tenantId, tenantId), eq(domains.isPrimary, true)));
  if (!d) return base.origin;
  // Custom domains are served over https in production; platform subdomains inherit the platform scheme/port.
  if (d.kind === 'custom' && runtimeConfig().NODE_ENV === 'production') return `https://${d.hostname}`;
  return `${base.protocol}//${d.hostname}${base.port ? `:${base.port}` : ''}`;
}
