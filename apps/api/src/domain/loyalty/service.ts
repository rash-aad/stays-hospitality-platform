import { bookingItems, bookings, folioCharges, loyaltyLedger, payments, tenants } from '@hp/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { reference } from '../../lib/ids.js';

export type Tier = { name: string; minNights: number; bonusPct: number };
export type LoyaltySettings = { enabled: boolean; earnPerHundred: number; pointValue: number; minRedeem: number; tiers: Tier[] };
export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false, earnPerHundred: 10, pointValue: 25, minRedeem: 200,
  tiers: [{ name: 'Member', minNights: 0, bonusPct: 0 }, { name: 'Silver', minNights: 5, bonusPct: 10 }, { name: 'Gold', minNights: 15, bonusPct: 25 }],
};

export async function loyaltySettings(tx: Tx, tenantId: string): Promise<LoyaltySettings> {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_LOYALTY, ...((t?.settings?.loyalty as Partial<LoyaltySettings>) ?? {}) };
}

export async function pointsBalance(tx: Tx, guestId: string) {
  const [r] = (await tx.select({ n: sql<number>`coalesce(sum(${loyaltyLedger.points}), 0)::int` }).from(loyaltyLedger).where(eq(loyaltyLedger.guestId, guestId))) as [{ n: number }];
  return r.n;
}

/** Nights stayed (checked out) in the last 12 months — decides the tier. */
export async function nightsLastYear(tx: Tx, guestId: string, timezone: string) {
  const since = addDays(todayIn(timezone), -365);
  const [r] = (await tx.select({ n: sql<number>`coalesce(sum(${bookings.checkOut} - ${bookings.checkIn}), 0)::int` }).from(bookings)
    .where(and(eq(bookings.guestId, guestId), eq(bookings.status, 'checked_out'), gte(bookings.checkOut, since)))) as [{ n: number }];
  return r.n;
}

export function tierFor(s: LoyaltySettings, nights: number) {
  const sorted = [...s.tiers].sort((a, b) => a.minNights - b.minNights);
  const current = [...sorted].reverse().find((t) => nights >= t.minNights) ?? sorted[0] ?? { name: 'Member', minNights: 0, bonusPct: 0 };
  const next = sorted.find((t) => t.minNights > nights) ?? null;
  return { current, next, nightsToNext: next ? next.minNights - nights : 0 };
}

/** Points for a checked-out stay: room revenue (excl. tax) × rate, plus the guest's tier bonus. Once per booking. */
export async function earnForStay(tx: Tx, tenant: TenantInfo, bookingId: string) {
  const s = await loyaltySettings(tx, tenant.id);
  if (!s.enabled) return 0;
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  const [room] = await tx.select({ amount: bookingItems.amount }).from(bookingItems).where(and(eq(bookingItems.bookingId, bookingId), eq(bookingItems.kind, 'room')));
  if (!b || !room) return 0;
  const tier = tierFor(s, await nightsLastYear(tx, b.guestId, tenant.timezone)).current;
  const points = Math.floor((room.amount / 10_000) * s.earnPerHundred * (1 + tier.bonusPct / 100));
  if (points <= 0) return 0;
  const [row] = await tx.insert(loyaltyLedger).values({ tenantId: tenant.id, guestId: b.guestId, bookingId, kind: 'earn', points, note: `Stay ${b.reference}${tier.bonusPct ? ` (${tier.name} +${tier.bonusPct}%)` : ''}` }).onConflictDoNothing().returning();
  return row ? points : 0;
}

/** Spend points against a booking's balance: recorded as a captured "loyalty" payment. */
export async function redeemPoints(tx: Tx, tenant: TenantInfo, guestId: string, bookingId: string, points: number) {
  const s = await loyaltySettings(tx, tenant.id);
  if (!s.enabled) throw conflict('Loyalty points aren’t available at this property');
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.guestId, guestId))).for('update');
  if (!b) throw notFound('Booking');
  if (!['confirmed', 'checked_in'].includes(b.status)) throw conflict('Points can be used on upcoming or current stays');
  if (points < s.minRedeem) throw badRequest(`Use at least ${s.minRedeem} points`);
  const balance = await pointsBalance(tx, guestId);
  if (points > balance) throw badRequest(`You have ${balance} points`);
  const [f] = (await tx.select({ n: sql<number>`coalesce(sum(${folioCharges.amount} + ${folioCharges.taxAmount}), 0)::int` }).from(folioCharges).where(eq(folioCharges.bookingId, b.id))) as [{ n: number }];
  const due = b.total + f.n - b.amountPaid;
  const value = points * s.pointValue;
  if (value > due) throw badRequest(`That’s more than you owe — use at most ${Math.floor(due / s.pointValue)} points`);
  const { capture } = await import('../payments/service.js');
  const [p] = await tx.insert(payments).values({
    tenantId: tenant.id, guestId, targetType: 'booking', targetId: b.id, bookingId: b.id, method: 'loyalty', status: 'awaiting_payment',
    amount: value, currency: b.currency, reference: reference('PTS', 8), metadata: { points },
  }).returning();
  await capture(tx, p!);
  await tx.insert(loyaltyLedger).values({ tenantId: tenant.id, guestId, bookingId: b.id, paymentId: p!.id, kind: 'redeem', points: -points, note: `Used on ${b.reference}` });
  return { points, value, balance: balance - points };
}

/** On cancellation, points spent on the booking go back to the guest; returns the money value they covered. */
export async function returnPointsOnCancel(tx: Tx, tenantId: string, bookingId: string) {
  const spent = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, bookingId), eq(payments.method, 'loyalty'), inArray(payments.status, ['captured', 'partially_refunded'])));
  let value = 0;
  for (const p of spent) {
    const points = Number((p.metadata as { points?: number }).points ?? 0);
    await tx.update(payments).set({ status: 'refunded', refundedAmount: p.amount }).where(eq(payments.id, p.id));
    if (points) await tx.insert(loyaltyLedger).values({ tenantId, guestId: p.guestId!, bookingId, paymentId: p.id, kind: 'reverse', points, note: 'Booking cancelled — points returned' });
    value += p.amount;
  }
  if (spent.length) {
    const { recomputePaid } = await import('../bookings/service.js');
    await recomputePaid(tx, bookingId);
  }
  return value;
}
