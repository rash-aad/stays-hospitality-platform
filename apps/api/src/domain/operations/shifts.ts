import { cashMovements, cashShifts, payments, refunds } from '@hp/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';

/** The staff member's open drawer, if any. */
export async function openShiftOf(tx: Tx, tenantId: string, userId: string) {
  const [s] = await tx.select().from(cashShifts).where(and(eq(cashShifts.tenantId, tenantId), eq(cashShifts.userId, userId), eq(cashShifts.status, 'open')));
  return s ?? null;
}

/** What should be in the drawer: float + cash taken − cash refunded + paid in − paid out − drops. */
export async function shiftTotals(tx: Tx, shiftId: string, openingFloat: number) {
  const [cash] = await tx.select({ taken: sql<number>`coalesce(sum(${payments.amount}), 0)::int`, count: sql<number>`count(*)::int` }).from(payments)
    .where(and(eq(payments.shiftId, shiftId), eq(payments.tender, 'cash'), inArray(payments.status, ['captured', 'partially_refunded', 'refunded'])));
  const [other] = await tx.select({ amount: sql<number>`coalesce(sum(${payments.amount}), 0)::int` }).from(payments)
    .where(and(eq(payments.shiftId, shiftId), sql`${payments.tender} <> 'cash'`, inArray(payments.status, ['captured', 'partially_refunded', 'refunded'])));
  const [ref] = await tx.select({ amount: sql<number>`coalesce(sum(${refunds.amount}), 0)::int` }).from(refunds).where(eq(refunds.shiftId, shiftId));
  const moves = await tx.select({ kind: cashMovements.kind, amount: sql<number>`coalesce(sum(${cashMovements.amount}), 0)::int` }).from(cashMovements).where(eq(cashMovements.shiftId, shiftId)).groupBy(cashMovements.kind);
  const m = (k: string) => moves.find((x) => x.kind === k)?.amount ?? 0;
  const expected = openingFloat + cash!.taken - ref!.amount + m('paid_in') - m('paid_out') - m('drop');
  return { openingFloat, cashTaken: cash!.taken, cashPayments: cash!.count, cashRefunds: ref!.amount, paidIn: m('paid_in'), paidOut: m('paid_out'), drops: m('drop'), otherTenders: other!.amount, expected };
}
