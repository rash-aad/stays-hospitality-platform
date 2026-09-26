import { pricingRules, ratePlans, rateSeasons, roomTypes, rooms, tenants } from '@hp/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { TenantInfo } from '../../http/context.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { eachNight, nightlyBase, type PricingRuleInput } from '../bookings/pricing.js';
import { nightPricer } from './rules.js';

const ruleBody = z.object({
  name: z.string().trim().min(2).max(80),
  roomTypeId: z.string().uuid().nullable(),
  kind: z.enum(['occupancy', 'lead_time', 'day_of_week']),
  params: z.object({
    minOccupancyPct: z.number().int().min(1).max(100).optional(),
    minDays: z.number().int().min(0).max(730).optional(),
    maxDays: z.number().int().min(0).max(730).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  }),
  adjustPct: z.number().int().min(-50).max(200).refine((v) => v !== 0, 'Use a non-zero change'),
  active: z.boolean().default(true),
}).superRefine((r, ctx) => {
  if (r.kind === 'occupancy' && r.params.minOccupancyPct == null) ctx.addIssue({ code: 'custom', path: ['params', 'minOccupancyPct'], message: 'Say how full the room type must be' });
  if (r.kind === 'lead_time' && r.params.minDays == null && r.params.maxDays == null) ctx.addIssue({ code: 'custom', path: ['params'], message: 'Set days before arrival (at least, at most, or both)' });
  if (r.kind === 'lead_time' && r.params.minDays != null && r.params.maxDays != null && r.params.minDays > r.params.maxDays) ctx.addIssue({ code: 'custom', path: ['params', 'maxDays'], message: 'Must be at least the minimum' });
  if (r.kind === 'day_of_week' && !r.params.days?.length) ctx.addIssue({ code: 'custom', path: ['params', 'days'], message: 'Pick at least one day' });
});

/** Next N nights per room type: occupancy, rooms left, base vs selling price (cheapest plan, base occupancy), rules applied. */
async function overview(tx: Tx, t: TenantInfo, days: number, draft?: PricingRuleInput, replaceId?: string) {
  const from = todayIn(t.timezone);
  const to = addDays(from, days);
  const dates = eachNight(from, to);
  const types = await tx.select().from(roomTypes).where(and(eq(roomTypes.tenantId, t.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sort));
  const out = [];
  for (const rt of types) {
    const [plan] = await tx.select().from(ratePlans).where(and(eq(ratePlans.roomTypeId, rt.id), eq(ratePlans.active, true))).orderBy(asc(ratePlans.basePrice)).limit(1);
    if (!plan) continue;
    const seasons = await tx.select().from(rateSeasons).where(eq(rateSeasons.ratePlanId, plan.id));
    const pricer = await nightPricer(tx, t.id, t.timezone, rt.id, from, to, draft ? [draft] : [], replaceId);
    const [{ sellable }] = (await tx.select({ sellable: sql<number>`count(*)::int` }).from(rooms).where(and(eq(rooms.roomTypeId, rt.id), eq(rooms.status, 'active')))) as [{ sellable: number }];
    const ledger = await tx.execute<{ date: string; left: number; booked: number; total: number }>(sql`select date::text as date, (total - booked)::int as left, booked, total from availability where room_type_id = ${rt.id} and date >= ${from} and date < ${to}`);
    const byDate = new Map([...ledger].map((l) => [l.date, l]));
    out.push({
      id: rt.id, name: rt.name, priceFloor: rt.priceFloor, priceCeiling: rt.priceCeiling, plan: { id: plan.id, name: plan.name },
      nights: dates.map((d) => {
        const base = nightlyBase(d, plan, seasons);
        const x = pricer?.explain(d, base);
        const l = byDate.get(d);
        const total = l?.total ?? sellable;
        return { date: d, base, price: x?.price ?? base, applied: x?.applied ?? [], left: l ? l.left : sellable, occupancyPct: total ? Math.round(((l?.booked ?? 0) / total) * 100) : 0 };
      }),
    });
  }
  // Pickup: room nights booked in the last 7 days, by stay date.
  const pickup = await tx.execute<{ date: string; nights: number }>(sql`
    select (n->>'date') as date, count(*)::int as nights
    from bookings b join booking_items bi on bi.booking_id = b.id and bi.kind = 'room', jsonb_array_elements(bi.nightly) n
    where b.tenant_id = ${t.id} and b.status in ('confirmed','checked_in','checked_out') and b.created_at >= now() - interval '7 days'
      and (n->>'date')::date >= ${from}::date and (n->>'date')::date < ${to}::date
    group by 1`);
  const [cap] = (await tx.select({ n: sql<number>`count(*)::int` }).from(rooms).where(and(eq(rooms.tenantId, t.id), eq(rooms.status, 'active')))) as [{ n: number }];
  const occ = await tx.execute<{ date: string; sold: number }>(sql`select date::text as date, sum(booked)::int as sold from availability where tenant_id = ${t.id} and date >= ${from} and date < ${to} group by date`);
  const occBy = new Map([...occ].map((o) => [o.date, o.sold]));
  return {
    from, dates, roomTypes: out,
    house: dates.map((d) => ({ date: d, occupancyPct: cap.n ? Math.round(((occBy.get(d) ?? 0) / cap.n) * 100) : 0, pickup: [...pickup].find((p) => p.date === d)?.nights ?? 0 })),
  };
}

async function revenueSettings(tx: Tx, tenantId: string) {
  const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const r = (row?.settings?.revenue ?? {}) as { scarcityThreshold?: number };
  return { scarcityThreshold: r.scarcityThreshold ?? 3 };
}
export { revenueSettings };

export const revenueRoutes: Routes = async (app) => {
  app.addHook('preHandler', requireModule('room_booking'));

  app.get('/admin/revenue/overview', { preHandler: requireStaff('bookings.read'), schema: { tags: ['revenue'], querystring: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await overview(tx, t, req.query.days), settings: await revenueSettings(tx, t.id) }));
  });

  /** What the next weeks would look like with a draft rule (optionally replacing an existing one). */
  app.post('/admin/revenue/preview', { preHandler: requireStaff('property.manage'), schema: { tags: ['revenue'], body: z.object({ rule: ruleBody, replaceId: z.string().uuid().optional(), days: z.number().int().min(7).max(90).default(30) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await overview(tx, t, req.body.days, { ...req.body.rule, id: 'draft' }, req.body.replaceId) }));
  });

  app.get('/admin/pricing-rules', { preHandler: requireStaff('bookings.read'), schema: { tags: ['revenue'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tx.select().from(pricingRules).where(eq(pricingRules.tenantId, t.id)).orderBy(asc(pricingRules.createdAt)) }));
  });

  async function checkType(tx: Tx, tenantId: string, id: string | null) {
    if (!id) return;
    const [rt] = await tx.select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.id, id), eq(roomTypes.tenantId, tenantId)));
    if (!rt) throw badRequest('Unknown room type');
  }

  app.post('/admin/pricing-rules', { preHandler: requireStaff('property.manage'), schema: { tags: ['revenue'], body: ruleBody } }, async (req, reply) => {
    const t = tenantOf(req);
    const r = await withTenant(t.id, async (tx) => {
      await checkType(tx, t.id, req.body.roomTypeId);
      const [r] = await tx.insert(pricingRules).values({ ...req.body, tenantId: t.id }).returning();
      await audit(tx, req, { action: 'pricing_rule.create', entityType: 'pricing_rule', entityId: r!.id, changes: req.body });
      return r!;
    });
    return reply.status(201).send({ data: r });
  });

  app.put('/admin/pricing-rules/:id', { preHandler: requireStaff('property.manage'), schema: { tags: ['revenue'], params: z.object({ id: z.string().uuid() }), body: ruleBody } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await checkType(tx, t.id, req.body.roomTypeId);
      const [r] = await tx.update(pricingRules).set(req.body).where(and(eq(pricingRules.id, req.params.id), eq(pricingRules.tenantId, t.id))).returning();
      if (!r) throw notFound('Rule');
      await audit(tx, req, { action: 'pricing_rule.update', entityType: 'pricing_rule', entityId: r.id, changes: req.body });
      return { data: r };
    });
  });

  app.delete('/admin/pricing-rules/:id', { preHandler: requireStaff('property.manage'), schema: { tags: ['revenue'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [r] = await tx.delete(pricingRules).where(and(eq(pricingRules.id, req.params.id), eq(pricingRules.tenantId, t.id))).returning();
      if (!r) throw notFound('Rule');
      await audit(tx, req, { action: 'pricing_rule.delete', entityType: 'pricing_rule', entityId: r.id });
    });
    return reply.status(204).send();
  });

  app.put('/admin/revenue/guardrails/:roomTypeId', {
    preHandler: requireStaff('property.manage'),
    schema: { tags: ['revenue'], params: z.object({ roomTypeId: z.string().uuid() }), body: z.object({ priceFloor: z.number().int().min(0).nullable(), priceCeiling: z.number().int().min(0).nullable() }).refine((b) => b.priceFloor == null || b.priceCeiling == null || b.priceFloor <= b.priceCeiling, { message: 'The floor must be below the ceiling', path: ['priceCeiling'] }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [rt] = await tx.update(roomTypes).set(req.body).where(and(eq(roomTypes.id, req.params.roomTypeId), eq(roomTypes.tenantId, t.id))).returning({ id: roomTypes.id });
      if (!rt) throw notFound('Room type');
      await audit(tx, req, { action: 'room_type.guardrails', entityType: 'room_type', entityId: rt.id, changes: req.body });
      return { data: req.body };
    });
  });

  app.put('/admin/revenue/settings', { preHandler: requireStaff('property.manage'), schema: { tags: ['revenue'], body: z.object({ scarcityThreshold: z.number().int().min(0).max(20) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t.id));
      await tx.update(tenants).set({ settings: { ...(row?.settings ?? {}), revenue: { ...((row?.settings?.revenue as object) ?? {}), ...req.body } } }).where(eq(tenants.id, t.id));
      return { data: req.body };
    });
  });
};
