import { experienceBookings, experienceSlots, orders, payments } from '@hp/db';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';

/** Expire unpaid order / experience payments whose window lapsed (bookings are handled by expireHolds). */
export async function expireStalePayments(tx: Tx, now = new Date()) {
  const stale = await tx.select().from(payments)
    .where(and(inArray(payments.targetType, ['order', 'experience_booking']), inArray(payments.status, ['awaiting_payment', 'rejected']), lt(payments.expiresAt, now)))
    .limit(200).for('update', { skipLocked: true });
  for (const p of stale) {
    await tx.update(payments).set({ status: 'expired' }).where(eq(payments.id, p.id));
    if (p.targetType === 'order') {
      await tx.update(orders).set({ status: 'cancelled', cancelledReason: 'Payment not received in time' }).where(and(eq(orders.id, p.targetId), eq(orders.status, 'pending_payment')));
    } else {
      const [eb] = await tx.update(experienceBookings).set({ status: 'cancelled' }).where(and(eq(experienceBookings.id, p.targetId), eq(experienceBookings.status, 'pending_payment'))).returning();
      if (eb) await tx.update(experienceSlots).set({ booked: sql`greatest(${experienceSlots.booked} - ${eb.participants}, 0)` }).where(eq(experienceSlots.id, eb.slotId));
    }
  }
  return stale.length;
}
