import { availability, pricingRules, roomTypes, rooms } from '@hp/db';
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';
import { todayIn } from '../../lib/dates.js';
import { dynamicPrice, type NightContext, type PricingRuleInput } from '../bookings/pricing.js';

const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function activeRules(tx: Tx, tenantId: string, roomTypeId: string): Promise<PricingRuleInput[]> {
  return tx.select().from(pricingRules).where(and(eq(pricingRules.tenantId, tenantId), eq(pricingRules.active, true), or(isNull(pricingRules.roomTypeId), eq(pricingRules.roomTypeId, roomTypeId))));
}

/**
 * Build the per-night pricer for a room type and stay: occupancy of each night (from the inventory ledger),
 * lead time from today to arrival, and the room type's guardrails. Returns null when no rule is active.
 */
export async function nightPricer(tx: Tx, tenantId: string, timezone: string, roomTypeId: string, checkIn: string, checkOut: string, extra: PricingRuleInput[] = [], replaceId?: string) {
  const rules = [...(await activeRules(tx, tenantId, roomTypeId)).filter((r) => r.id !== replaceId), ...extra.filter((r) => !r.roomTypeId || r.roomTypeId === roomTypeId)];
  if (!rules.length) return null;
  const [rt] = await tx.select({ floor: roomTypes.priceFloor, ceiling: roomTypes.priceCeiling }).from(roomTypes).where(eq(roomTypes.id, roomTypeId));
  const [{ sellable }] = (await tx.select({ sellable: sql<number>`count(*)::int` }).from(rooms).where(and(eq(rooms.roomTypeId, roomTypeId), eq(rooms.status, 'active')))) as [{ sellable: number }];
  const ledger = await tx.select({ date: availability.date, booked: availability.booked, total: availability.total }).from(availability)
    .where(and(eq(availability.roomTypeId, roomTypeId), gte(availability.date, checkIn), lt(availability.date, checkOut)));
  const byDate = new Map(ledger.map((l) => [l.date, l]));
  const leadDays = diffDays(todayIn(timezone), checkIn);
  const ctx = (date: string): NightContext => {
    const l = byDate.get(date);
    const total = l?.total ?? sellable;
    return { date, leadDays, occupancyPct: total > 0 ? Math.round(((l?.booked ?? 0) / total) * 100) : 0 };
  };
  const guard = { floor: rt?.floor, ceiling: rt?.ceiling };
  return {
    price: (date: string, base: number) => dynamicPrice(base, ctx(date), rules, guard).price,
    explain: (date: string, base: number) => ({ ...dynamicPrice(base, ctx(date), rules, guard), ...ctx(date) }),
  };
}
