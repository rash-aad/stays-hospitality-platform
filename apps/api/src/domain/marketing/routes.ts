import { campaigns, guestFeedback, guests, loyaltyLedger, tenants, users } from '@hp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { guestActor, requireGuest, requireStaff, resolvePublicTenant, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { enqueue } from '../../infra/queue.js';
import { audit } from '../../lib/audit.js';
import { loyaltySettings, nightsLastYear, pointsBalance, redeemPoints, tierFor, type LoyaltySettings } from '../loyalty/service.js';
import { notify } from '../notifications/notify.js';
import { audience, sendCampaign, verifyUnsubscribe } from './campaigns.js';

const idParam = z.object({ id: z.string().uuid() });
const segment = z.object({ stayedWithinDays: z.number().int().min(1).max(3650).nullish(), minStays: z.number().int().min(1).max(100).nullish(), tags: z.array(z.string().max(30)).max(10).optional(), country: z.string().length(2).nullish() });
const campaignBody = z.object({ name: z.string().trim().min(2).max(80), subject: z.string().trim().min(2).max(150), body: z.string().trim().min(10).max(10_000), segment });

async function saveTenantSetting(tx: Tx, tenantId: string, key: string, value: unknown) {
  await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
  const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  await tx.update(tenants).set({ settings: { ...(row?.settings ?? {}), [key]: value } }).where(eq(tenants.id, tenantId));
}

export async function reviewLinks(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const r = (t?.settings?.reviews ?? {}) as { googleUrl?: string | null; tripadvisorUrl?: string | null };
  return { googleUrl: r.googleUrl ?? null, tripadvisorUrl: r.tripadvisorUrl ?? null };
}

/**
 * After a 4★+ feedback, invite the guest (once) to post a public review, if the property set a link.
 * Returns the links for the thank-you screen.
 */
export async function maybeRequestReview(tx: Tx, tenantId: string, feedbackId: string) {
  const [f] = await tx.select().from(guestFeedback).where(eq(guestFeedback.id, feedbackId));
  const links = await reviewLinks(tx, tenantId);
  if (!f || f.overall < 4 || (!links.googleUrl && !links.tripadvisorUrl)) return null;
  if (!f.reviewRequestedAt) {
    await tx.update(guestFeedback).set({ reviewRequestedAt: new Date() }).where(eq(guestFeedback.id, f.id));
    const [g] = await tx.select({ firstName: guests.firstName }).from(guests).where(eq(guests.id, f.guestId));
    const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    await notify(tx, { tenantId, recipient: { type: 'guest', id: f.guestId }, templateKey: 'review.request', channels: ['email'], vars: { name: g!.firstName, property: t!.name, links: [links.googleUrl && `Google: ${links.googleUrl}`, links.tripadvisorUrl && `Tripadvisor: ${links.tripadvisorUrl}`].filter(Boolean).join('\n') } });
  }
  return links;
}

export const marketingRoutes: Routes = async (app) => {
  // ---------------- Loyalty ----------------
  const loyaltyBody = z.object({
    enabled: z.boolean(), earnPerHundred: z.number().int().min(0).max(100), pointValue: z.number().int().min(1).max(10_000), minRedeem: z.number().int().min(0).max(1_000_000),
    tiers: z.array(z.object({ name: z.string().trim().min(1).max(30), minNights: z.number().int().min(0).max(365), bonusPct: z.number().int().min(0).max(200) })).min(1).max(6),
  });
  app.get('/admin/loyalty-settings', { preHandler: requireStaff('guests.read'), schema: { tags: ['loyalty'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await loyaltySettings(tx, t.id) }));
  });
  app.put('/admin/loyalty-settings', { preHandler: requireStaff('tenant.settings'), schema: { tags: ['loyalty'], body: loyaltyBody } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await saveTenantSetting(tx, t.id, 'loyalty', req.body satisfies LoyaltySettings);
      await audit(tx, req, { action: 'loyalty.settings', entityType: 'tenant', entityId: t.id, changes: req.body });
      return { data: req.body };
    });
  });
  app.get('/admin/guests/:id/loyalty', { preHandler: requireStaff('guests.read'), schema: { tags: ['loyalty'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const s = await loyaltySettings(tx, t.id);
      const nights = await nightsLastYear(tx, req.params.id, t.timezone);
      const ledger = await tx.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.guestId, req.params.id), eq(loyaltyLedger.tenantId, t.id))).orderBy(desc(loyaltyLedger.createdAt)).limit(50);
      return { data: { enabled: s.enabled, balance: await pointsBalance(tx, req.params.id), valuePerPoint: s.pointValue, nightsLastYear: nights, tier: tierFor(s, nights), ledger } };
    });
  });
  app.post('/admin/guests/:id/loyalty/adjust', { preHandler: requireStaff('guests.write'), schema: { tags: ['loyalty'], params: idParam, body: z.object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0), note: z.string().trim().min(2).max(200) }) } }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const [g] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.id, req.params.id), eq(guests.tenantId, t.id)));
      if (!g) throw notFound('Guest');
      const balance = await pointsBalance(tx, g.id);
      if (balance + req.body.points < 0) throw badRequest(`The guest has only ${balance} points`);
      await tx.insert(loyaltyLedger).values({ tenantId: t.id, guestId: g.id, kind: 'adjust', points: req.body.points, note: req.body.note, createdByUserId: me.userId });
      await audit(tx, req, { action: 'loyalty.adjust', entityType: 'guest', entityId: g.id, changes: req.body });
      return { data: { balance: balance + req.body.points } };
    });
  });
  app.get('/portal/loyalty', { preHandler: requireGuest, schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const s = await loyaltySettings(tx, t.id);
      if (!s.enabled) return { data: { enabled: false } };
      const nights = await nightsLastYear(tx, g.guestId, t.timezone);
      const ledger = await tx.select({ kind: loyaltyLedger.kind, points: loyaltyLedger.points, note: loyaltyLedger.note, createdAt: loyaltyLedger.createdAt }).from(loyaltyLedger).where(eq(loyaltyLedger.guestId, g.guestId)).orderBy(desc(loyaltyLedger.createdAt)).limit(30);
      return { data: { enabled: true, balance: await pointsBalance(tx, g.guestId), pointValue: s.pointValue, minRedeem: s.minRedeem, earnPerHundred: s.earnPerHundred, tier: tierFor(s, nights), nightsLastYear: nights, ledger } };
    });
  });
  app.post('/portal/bookings/:id/redeem-points', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam, body: z.object({ points: z.number().int().min(1) }) } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await redeemPoints(tx, t, g.guestId, req.params.id, req.body.points) }));
  });

  // ---------------- Review links ----------------
  app.get('/admin/review-settings', { preHandler: requireStaff('guests.read'), schema: { tags: ['marketing'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await reviewLinks(tx, t.id) }));
  });
  app.put('/admin/review-settings', { preHandler: requireStaff('tenant.settings'), schema: { tags: ['marketing'], body: z.object({ googleUrl: z.string().url().startsWith('https://').max(500).nullable(), tripadvisorUrl: z.string().url().startsWith('https://').max(500).nullable() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => { await saveTenantSetting(tx, t.id, 'reviews', req.body); return { data: req.body }; });
  });

  // ---------------- Campaigns ----------------
  const write = requireStaff('guests.write');
  app.get('/admin/campaigns', { preHandler: requireStaff('guests.read'), schema: { tags: ['marketing'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tx.select().from(campaigns).where(eq(campaigns.tenantId, t.id)).orderBy(desc(campaigns.createdAt)) }));
  });
  app.post('/admin/campaigns/audience', { preHandler: requireStaff('guests.read'), schema: { tags: ['marketing'], body: z.object({ segment }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const people = await audience(tx, t.id, t.timezone, req.body.segment);
      return { data: { count: people.length, sample: people.slice(0, 5).map((p) => `${p.firstName} ${p.lastName}`) } };
    });
  });
  app.post('/admin/campaigns', { preHandler: write, schema: { tags: ['marketing'], body: campaignBody } }, async (req, reply) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    const c = await withTenant(t.id, async (tx) => (await tx.insert(campaigns).values({ ...req.body, tenantId: t.id, createdByUserId: me.userId }).returning())[0]!);
    return reply.status(201).send({ data: c });
  });
  app.put('/admin/campaigns/:id', { preHandler: write, schema: { tags: ['marketing'], params: idParam, body: campaignBody } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [c] = await tx.update(campaigns).set(req.body).where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantId, t.id), eq(campaigns.status, 'draft'))).returning();
      if (!c) throw conflict('Only drafts can be edited');
      return { data: c };
    });
  });
  app.delete('/admin/campaigns/:id', { preHandler: write, schema: { tags: ['marketing'], params: idParam } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [c] = await tx.delete(campaigns).where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantId, t.id), eq(campaigns.status, 'draft'))).returning();
      if (!c) throw conflict('Only drafts can be deleted');
    });
    return reply.status(204).send();
  });
  /** Send a preview to yourself. */
  app.post('/admin/campaigns/:id/test', { preHandler: write, schema: { tags: ['marketing'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantId, t.id)));
      if (!c) throw notFound('Campaign');
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, me.userId));
      const first = u!.name.split(' ')[0]!;
      await notify(tx, { tenantId: t.id, recipient: { type: 'user', id: me.userId }, templateKey: 'marketing.test', channels: ['email'], vars: { subject: c.subject.replaceAll('{{firstName}}', first), body: c.body.replaceAll('{{firstName}}', first) } });
      return { ok: true };
    });
  });
  app.post('/admin/campaigns/:id/send', { preHandler: write, schema: { tags: ['marketing'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const c = await withTenant(t.id, async (tx) => {
      const [c] = await tx.update(campaigns).set({ status: 'sending' }).where(and(eq(campaigns.id, req.params.id), eq(campaigns.tenantId, t.id), eq(campaigns.status, 'draft'))).returning();
      if (!c) throw conflict('This campaign was already sent');
      await audit(tx, req, { action: 'campaign.send', entityType: 'campaign', entityId: c.id });
      return c;
    });
    await enqueue('campaign-send', { tenantId: t.id, campaignId: c.id }, { jobId: `campaign:${c.id}` });
    return { data: { id: c.id, status: 'sending' } };
  });

  // ---------------- One-click unsubscribe (public, on the property's site) ----------------
  app.post('/public/unsubscribe', { preHandler: resolvePublicTenant, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['marketing'], body: z.object({ token: z.string().max(200) }) } }, async (req) => {
    const t = tenantOf(req);
    const guestId = verifyUnsubscribe(t.id, req.body.token);
    if (!guestId) throw badRequest('This unsubscribe link isn’t valid');
    await withTenant(t.id, (tx) => tx.update(guests).set({ marketingOptIn: false }).where(and(eq(guests.id, guestId), eq(guests.tenantId, t.id))));
    return { ok: true, property: t.name };
  });
};

export { sendCampaign };
