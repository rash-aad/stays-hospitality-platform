import { availability, rooms, roomTypes } from '@hp/db';
import { and, asc, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { outer } from '../../lib/sql.js';
import { conflict } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { eachNight } from './pricing.js';

async function sellableRooms(tx: Tx, roomTypeId: string) {
  const [r] = await tx.select({ n: count() }).from(rooms).where(and(eq(rooms.roomTypeId, roomTypeId), eq(rooms.status, 'active')));
  return r?.n ?? 0;
}

/** Make sure a ledger row exists for every night (total defaults to the sellable room count). */
export async function ensureLedger(tx: Tx, tenantId: string, roomTypeId: string, dates: string[]) {
  if (!dates.length) return;
  const total = await sellableRooms(tx, roomTypeId);
  await tx
    .insert(availability)
    .values(dates.map((date) => ({ tenantId, roomTypeId, date, total })))
    .onConflictDoNothing();
}

/**
 * Take one unit of inventory for each night. Rows are locked in date order (deadlock-free), and the
 * CHECK (booked <= total) constraint is the final guard against overselling.
 */
export async function reserveInventory(tx: Tx, tenantId: string, roomTypeId: string, checkIn: string, checkOut: string) {
  const dates = eachNight(checkIn, checkOut);
  await ensureLedger(tx, tenantId, roomTypeId, dates);
  const rows = await tx
    .select()
    .from(availability)
    .where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates)))
    .orderBy(asc(availability.date))
    .for('update');
  const first = rows[0];
  if (first?.closedToArrival && first.date === checkIn) throw conflict('Arrivals are closed on this date', { date: checkIn });
  const blocked = rows.find((r) => r.closed || r.booked >= r.total);
  if (blocked) throw conflict('Sorry — this room type just sold out for your dates', { date: blocked.date });
  const minStay = Math.max(0, ...rows.map((r) => r.minStay ?? 0));
  if (dates.length < minStay) throw conflict(`A minimum stay of ${minStay} nights applies to these dates`);
  await tx
    .update(availability)
    .set({ booked: sql`${availability.booked} + 1` })
    .where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates)));
}

export async function releaseInventory(tx: Tx, roomTypeId: string, checkIn: string, checkOut: string) {
  const dates = eachNight(checkIn, checkOut);
  await tx
    .update(availability)
    .set({ booked: sql`greatest(${availability.booked} - 1, 0)` })
    .where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates)));
}

/** Units left per room type across a date range (minimum over nights), honouring closures. */
export async function availableUnits(tx: Tx, propertyId: string, checkIn: string, checkOut: string) {
  const dates = eachNight(checkIn, checkOut);
  const types = await tx
    .select({ id: roomTypes.id, sellable: sql<number>`(select count(*)::int from rooms r where r.room_type_id = ${outer(roomTypes.id)} and r.status = 'active')` })
    .from(roomTypes)
    .where(and(eq(roomTypes.propertyId, propertyId), eq(roomTypes.active, true)));
  if (!types.length) return new Map<string, { units: number; minStay: number; closedToArrival: boolean }>();
  const ledger = await tx
    .select()
    .from(availability)
    .where(and(inArray(availability.roomTypeId, types.map((t) => t.id)), gte(availability.date, checkIn), lt(availability.date, checkOut)));
  const out = new Map<string, { units: number; minStay: number; closedToArrival: boolean }>();
  for (const t of types) {
    const rows = new Map(ledger.filter((l) => l.roomTypeId === t.id).map((l) => [l.date, l]));
    let units = Infinity;
    let minStay = 0;
    let cta = false;
    for (const d of dates) {
      const r = rows.get(d);
      const free = r ? (r.closed ? 0 : r.total - r.booked) : t.sellable;
      units = Math.min(units, free);
      minStay = Math.max(minStay, r?.minStay ?? 0);
      if (d === checkIn && r?.closedToArrival) cta = true;
    }
    out.set(t.id, { units: Math.max(0, units === Infinity ? 0 : units), minStay, closedToArrival: cta });
  }
  return out;
}

/** Re-sync ledger totals after rooms are added/removed/taken out of service. */
export async function resyncTotals(tx: Tx, roomTypeId: string) {
  const total = await sellableRooms(tx, roomTypeId);
  await tx
    .update(availability)
    .set({ total: sql`greatest(${total}, ${availability.booked})` })
    .where(and(eq(availability.roomTypeId, roomTypeId), gte(availability.date, sql`current_date`)));
}
