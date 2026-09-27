import { createHmac, timingSafeEqual } from 'node:crypto';
import { campaigns, guests, notifications, tenants } from '@hp/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { siteUrl } from '../../lib/site-url.js';
import { runtimeConfig } from '../../runtime.js';

export type Segment = { stayedWithinDays?: number | null; minStays?: number | null; tags?: string[]; country?: string | null };

const sign = (tenantId: string, guestId: string) => createHmac('sha256', runtimeConfig().JWT_SECRET).update(`unsubscribe:${tenantId}:${guestId}`).digest('base64url');
export const unsubscribeToken = (tenantId: string, guestId: string) => `${guestId}.${sign(tenantId, guestId)}`;
export function verifyUnsubscribe(tenantId: string, token: string) {
  const [guestId, sig] = token.split('.');
  if (!guestId || !sig || !/^[0-9a-f-]{36}$/.test(guestId)) return null;
  const want = Buffer.from(sign(tenantId, guestId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? guestId : null;
}

/** Guests who opted in to marketing (and weren't erased), narrowed by the segment. */
export async function audience(tx: Tx, tenantId: string, timezone: string, seg: Segment) {
  const conds = [eq(guests.tenantId, tenantId), eq(guests.marketingOptIn, true), isNull(guests.anonymizedAt)];
  if (seg.stayedWithinDays) conds.push(sql`exists (select 1 from bookings b where b.guest_id = ${guests.id} and b.status = 'checked_out' and b.check_out >= ${addDays(todayIn(timezone), -seg.stayedWithinDays)}::date)`);
  if (seg.minStays) conds.push(sql`(select count(*) from bookings b where b.guest_id = ${guests.id} and b.status = 'checked_out') >= ${seg.minStays}`);
  if (seg.tags?.length) conds.push(sql`${guests.tags} && ${`{${seg.tags.map((t) => `"${t.replace(/"/g, '')}"`).join(',')}}`}::text[]`);
  if (seg.country) conds.push(eq(guests.country, seg.country));
  return tx.select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName, email: guests.email }).from(guests).where(and(...conds)).orderBy(guests.lastName);
}

const personalise = (text: string, firstName: string) => text.replaceAll('{{firstName}}', firstName);

/** Queue one email per recipient (outbox), each with its own unsubscribe link. */
export async function sendCampaign(tx: Tx, tenantId: string, campaignId: string) {
  const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId))).for('update');
  if (!c || c.status === 'sent') return 0;
  const [t] = await tx.select({ name: tenants.name, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const people = await audience(tx, tenantId, t!.timezone, c.segment);
  const base = await siteUrl(tx, tenantId);
  const rows = people.map((p) => ({
    tenantId, channel: 'email' as const, recipientType: 'guest' as const, recipientId: p.id, toAddress: p.email, templateKey: 'marketing.campaign',
    subject: personalise(c.subject, p.firstName),
    body: `${personalise(c.body, p.firstName)}\n\n—\nYou’re receiving this because you asked ${t!.name} for news and offers. Unsubscribe in one click: ${base}/unsubscribe?token=${unsubscribeToken(tenantId, p.id)}`,
    status: 'queued' as const, relatedType: 'campaign', relatedId: c.id,
  }));
  for (let i = 0; i < rows.length; i += 500) await tx.insert(notifications).values(rows.slice(i, i + 500));
  await tx.update(campaigns).set({ status: 'sent', recipients: rows.length, sentAt: new Date() }).where(eq(campaigns.id, c.id));
  return rows.length;
}
