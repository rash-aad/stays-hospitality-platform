import { domains } from '@hp/db';
import { and, eq, ne } from 'drizzle-orm';
import { resolveTxt } from 'node:dns/promises';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { randomToken } from '../../lib/ids.js';
import { invalidateHost } from '../tenants/tenant-cache.js';

const HOST_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
export const TXT_PREFIX = '_stays-verify';

let txtLookup: (name: string) => Promise<string[][]> = resolveTxt;
/** Test seam for DNS. */
export function setTxtResolver(fn: (name: string) => Promise<string[][]>) {
  txtLookup = fn;
}

export function normaliseHostname(raw: string) {
  const h = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!HOST_RE.test(h)) throw badRequest('Enter a domain like www.yourhotel.com');
  return h;
}

export async function addDomain(tx: Tx, tenantId: string, raw: string, rootDomain: string) {
  const hostname = normaliseHostname(raw);
  if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) throw badRequest('Platform subdomains are assigned automatically');
  const [d] = await tx.insert(domains).values({ tenantId, hostname, kind: 'custom', verificationToken: randomToken(18) }).returning();
  return d!;
}

export async function verifyDomain(tx: Tx, tenantId: string, id: string) {
  const [d] = await tx.select().from(domains).where(and(eq(domains.id, id), eq(domains.tenantId, tenantId))).for('update');
  if (!d) throw notFound('Domain');
  if (d.verifiedAt) return d;
  let records: string[][] = [];
  try {
    records = await txtLookup(`${TXT_PREFIX}.${d.hostname}`);
  } catch {
    throw conflict(`We couldn’t find the TXT record yet. DNS changes can take up to an hour.`, { record: `${TXT_PREFIX}.${d.hostname}`, value: `stays-verify=${d.verificationToken}` });
  }
  const ok = records.some((parts) => parts.join('') === `stays-verify=${d.verificationToken}`);
  if (!ok) throw conflict('The TXT record doesn’t match yet', { record: `${TXT_PREFIX}.${d.hostname}`, value: `stays-verify=${d.verificationToken}` });
  const [u] = await tx.update(domains).set({ verifiedAt: new Date() }).where(eq(domains.id, d.id)).returning();
  await invalidateHost(d.hostname);
  return u!;
}

export async function makePrimary(tx: Tx, tenantId: string, id: string) {
  const [d] = await tx.select().from(domains).where(and(eq(domains.id, id), eq(domains.tenantId, tenantId)));
  if (!d) throw notFound('Domain');
  if (!d.verifiedAt) throw badRequest('Verify the domain before making it primary');
  await tx.update(domains).set({ isPrimary: false }).where(and(eq(domains.tenantId, tenantId), ne(domains.id, id)));
  await tx.update(domains).set({ isPrimary: true }).where(eq(domains.id, id));
}

export async function removeDomain(tx: Tx, tenantId: string, id: string) {
  const [d] = await tx.select().from(domains).where(and(eq(domains.id, id), eq(domains.tenantId, tenantId)));
  if (!d) throw notFound('Domain');
  if (d.kind === 'subdomain') throw badRequest('The platform subdomain cannot be removed');
  await tx.delete(domains).where(eq(domains.id, id));
  if (d.isPrimary) await tx.update(domains).set({ isPrimary: true }).where(and(eq(domains.tenantId, tenantId), eq(domains.kind, 'subdomain')));
  await invalidateHost(d.hostname);
}
