import { bookingItems, bookings, entityEvents, externalBlocks, guests, housekeepingTasks, ratePlans, rooms, roomTypes, stays } from '@hp/db';
import { and, asc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { releaseInventory, reserveInventory } from './inventory.js';
import { eachNight } from './pricing.js';
import { assignRoom, lockRoomAssignments, modifyBooking, priceStay } from './service.js';

/** Rooms down the side, dates across the top, a bar per booking — the front desk's view of the house. */
export async function tapeChart(tx: Tx, tenant: TenantInfo, from: string, days: number) {
  const to = addDays(from, days);
  const types = await tx.select({ id: roomTypes.id, name: roomTypes.name, sort: roomTypes.sort }).from(roomTypes).where(and(eq(roomTypes.tenantId, tenant.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sort), asc(roomTypes.name));
  const roomRows = await tx.select({ id: rooms.id, number: rooms.number, floor: rooms.floor, roomTypeId: rooms.roomTypeId, status: rooms.status, housekeepingStatus: rooms.housekeepingStatus })
    .from(rooms).where(eq(rooms.tenantId, tenant.id)).orderBy(asc(rooms.number));
  const bars = await tx.select({
    bookingId: bookings.id, reference: bookings.reference, status: bookings.status, paymentStatus: bookings.paymentStatus, checkIn: bookings.checkIn, checkOut: bookings.checkOut,
    adults: bookings.adults, children: bookings.children, source: bookings.source, total: bookings.total, amountPaid: bookings.amountPaid,
    guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`, roomTypeId: bookingItems.roomTypeId, roomId: stays.roomId,
  }).from(bookings)
    .innerJoin(guests, eq(guests.id, bookings.guestId))
    .innerJoin(bookingItems, and(eq(bookingItems.bookingId, bookings.id), eq(bookingItems.kind, 'room')))
    .leftJoin(stays, eq(stays.bookingId, bookings.id))
    .where(and(eq(bookings.tenantId, tenant.id), inArray(bookings.status, ['pending_payment', 'confirmed', 'checked_in', 'checked_out']), lt(bookings.checkIn, to), gt(bookings.checkOut, from)))
    .orderBy(asc(bookings.checkIn));
  const blocks = await tx.select({ id: externalBlocks.id, roomTypeId: externalBlocks.roomTypeId, startDate: externalBlocks.startDate, endDate: externalBlocks.endDate, summary: externalBlocks.summary, status: externalBlocks.status })
    .from(externalBlocks).where(and(eq(externalBlocks.tenantId, tenant.id), lt(externalBlocks.startDate, to), gt(externalBlocks.endDate, from)));
  const avail = await tx.execute<{ room_type_id: string; date: string; left: number; closed: boolean }>(sql`
    select room_type_id, date::text as date, (total - booked)::int as left, closed from availability
    where tenant_id = ${tenant.id} and date >= ${from} and date < ${to}`);
  return {
    from, to, today: todayIn(tenant.timezone), days: eachNight(from, to),
    roomTypes: types.map((t) => ({ ...t, rooms: roomRows.filter((r) => r.roomTypeId === t.id), availability: Object.fromEntries([...avail].filter((a) => a.room_type_id === t.id).map((a) => [a.date, { left: a.left, closed: a.closed }])) })),
    bars, blocks,
  };
}

export type MoveInput = { roomId?: string | null; checkIn?: string; checkOut?: string; pricing?: 'reprice' | 'keep' };

/**
 * Move a booking on the chart: another room (same or different type), other dates, or a longer/shorter
 * in-house stay. Upcoming stays are re-priced unless the desk keeps the rate (a complimentary upgrade);
 * in-house room moves keep the rate and send the old room for cleaning; extensions charge the extra nights.
 */
export async function moveBooking(tx: Tx, tenant: TenantInfo, id: string, input: MoveInput, actorId: string) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  const [stay] = await tx.select().from(stays).where(eq(stays.bookingId, b.id));
  const [target] = input.roomId ? await tx.select().from(rooms).where(and(eq(rooms.id, input.roomId), eq(rooms.tenantId, tenant.id))) : [];
  if (input.roomId && !target) throw badRequest('Unknown room');
  if (target && target.status !== 'active') throw conflict(`Room ${target.number} is out of service`);
  const newType = target?.roomTypeId ?? item!.roomTypeId!;
  const typeChanges = newType !== item!.roomTypeId;
  const checkIn = input.checkIn ?? b.checkIn;
  const checkOut = input.checkOut ?? b.checkOut;
  if (checkOut <= checkIn) throw badRequest('Departure must be after arrival');
  const log = (body: string) => tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'booking', entityId: b.id, kind: 'update', body, actorType: 'user', actorId });
  const notes: string[] = [];

  if (b.status === 'confirmed' || b.status === 'pending_payment') {
    if (typeChanges && input.pricing === 'keep') {
      // Complimentary upgrade: take the new type's nights, keep what the guest pays.
      if (checkIn !== b.checkIn || checkOut !== b.checkOut) throw badRequest('Change the dates and the room type in two steps when keeping the rate');
      await releaseInventory(tx, item!.roomTypeId!, b.checkIn, b.checkOut);
      await reserveInventory(tx, tenant.id, newType, checkIn, checkOut, { skipRestrictions: true });
      const [plan] = await tx.select().from(ratePlans).where(and(eq(ratePlans.roomTypeId, newType), eq(ratePlans.active, true))).orderBy(asc(ratePlans.basePrice)).limit(1);
      const [rt] = await tx.select({ name: roomTypes.name }).from(roomTypes).where(eq(roomTypes.id, newType));
      await tx.update(bookingItems).set({ roomTypeId: newType, ratePlanId: plan?.id ?? item!.ratePlanId, description: `${rt!.name} — complimentary upgrade` }).where(eq(bookingItems.id, item!.id));
      notes.push(`Upgraded to ${rt!.name} at the original rate`);
    } else if (typeChanges || checkIn !== b.checkIn || checkOut !== b.checkOut) {
      let ratePlanId: string | undefined;
      if (typeChanges) {
        // Same rate code on the new type if it exists (e.g. BB → BB), otherwise its cheapest plan.
        const [cur] = await tx.select({ code: ratePlans.code }).from(ratePlans).where(eq(ratePlans.id, item!.ratePlanId!));
        const plans = await tx.select().from(ratePlans).where(and(eq(ratePlans.roomTypeId, newType), eq(ratePlans.active, true))).orderBy(asc(ratePlans.basePrice));
        ratePlanId = (plans.find((p) => p.code === cur?.code) ?? plans[0])?.id;
        if (!ratePlanId) throw conflict('That room type has no rate to sell');
      }
      const r = await modifyBooking(tx, tenant, b.id, { checkIn, checkOut, adults: b.adults, children: b.children, roomTypeId: newType, ratePlanId });
      notes.push(`Moved to ${checkIn} → ${checkOut}; total ${b.total} → ${r.booking.total}`);
    }
    if (target) {
      await assignRoom(tx, tenant, b.id, target.id);
      notes.push(`Room ${target.number}`);
    } else if (typeChanges) {
      await tx.update(stays).set({ roomId: null }).where(eq(stays.bookingId, b.id));
      await tx.update(bookingItems).set({ roomId: null }).where(eq(bookingItems.id, item!.id));
    }
  } else if (b.status === 'checked_in') {
    const today = todayIn(tenant.timezone);
    if (checkIn !== b.checkIn) throw conflict('The guest has already arrived — only the departure date can change');
    // Room move mid-stay: free the target for the remaining nights, send the old room for cleaning.
    if (target && target.id !== stay?.roomId) {
      await lockRoomAssignments(tx, newType);
      const from = today > b.checkIn ? today : b.checkIn;
      const [busy] = await tx.select({ id: stays.id }).from(stays).innerJoin(bookings, eq(bookings.id, stays.bookingId))
        .where(and(eq(stays.roomId, target.id), ne(stays.bookingId, b.id), inArray(stays.status, ['upcoming', 'in_house']), inArray(bookings.status, ['confirmed', 'checked_in']), lt(bookings.checkIn, b.checkOut), gt(bookings.checkOut, from)));
      if (busy) throw conflict(`Room ${target.number} is taken for part of this stay`);
      if (typeChanges) {
        await releaseInventory(tx, item!.roomTypeId!, from, b.checkOut);
        await reserveInventory(tx, tenant.id, newType, from, b.checkOut, { skipRestrictions: true });
        await tx.update(bookingItems).set({ roomTypeId: newType }).where(eq(bookingItems.id, item!.id));
      }
      if (stay?.roomId) {
        await tx.update(rooms).set({ housekeepingStatus: 'dirty' }).where(and(eq(rooms.id, stay.roomId), sql`${rooms.housekeepingStatus} <> 'out_of_service'`));
        await tx.insert(housekeepingTasks).values({ tenantId: tenant.id, propertyId: b.propertyId, roomId: stay.roomId, kind: 'departure', priority: 'high', scheduledFor: today, notes: 'Room move — guest moved out' });
      }
      await tx.update(stays).set({ roomId: target.id }).where(eq(stays.bookingId, b.id));
      await tx.update(bookingItems).set({ roomId: target.id }).where(eq(bookingItems.id, item!.id));
      notes.push(`Room move to ${target.number}`);
    }
    if (checkOut !== b.checkOut) {
      if (checkOut <= today) throw conflict('To end the stay today, check the guest out');
      const roomType = target?.roomTypeId ?? newType;
      const nightly = [...item!.nightly];
      let amount = item!.amount, tax = item!.taxAmount;
      if (checkOut > b.checkOut) {
        // Extension: the extra nights at today's rate for the same plan.
        await reserveInventory(tx, tenant.id, roomType, b.checkOut, checkOut, { skipRestrictions: true });
        const { quote } = await priceStay(tx, tenant, { roomTypeId: roomType, ratePlanId: item!.ratePlanId!, checkIn: b.checkOut, checkOut, adults: b.adults, children: b.children }, { enforceLeadTime: false, ignoreStayRules: true });
        nightly.push(...quote.nights);
        amount += quote.roomSubtotal;
        tax += quote.taxTotal;
      } else {
        // Leaving early (decided before the day): give back the unused nights and their charge.
        await releaseInventory(tx, roomType, checkOut, b.checkOut);
        const dropped = nightly.filter((n) => n.date >= checkOut);
        const dropAmount = dropped.reduce((s, n) => s + n.price, 0);
        const dropTax = item!.amount > 0 ? Math.round((item!.taxAmount * dropAmount) / item!.amount) : 0;
        nightly.splice(0, nightly.length, ...nightly.filter((n) => n.date < checkOut));
        amount -= Math.min(dropAmount, amount);
        tax -= Math.min(dropTax, tax);
      }
      await tx.update(bookingItems).set({ nightly, quantity: nightly.length, amount, taxAmount: tax }).where(eq(bookingItems.id, item!.id));
      const subtotal = b.subtotal + (amount - item!.amount);
      const taxTotal = b.taxTotal + (tax - item!.taxAmount);
      const total = subtotal - b.discount + taxTotal;
      await tx.update(bookings).set({ checkOut, subtotal, taxTotal, total, paymentStatus: b.amountPaid >= total ? 'paid' : b.amountPaid > 0 ? 'partially_paid' : b.paymentStatus }).where(eq(bookings.id, b.id));
      notes.push(`${checkOut > b.checkOut ? 'Extended' : 'Shortened'} to ${checkOut}`);
    }
  } else {
    throw conflict(`A ${b.status.replace('_', ' ')} booking can’t be moved`);
  }
  if (notes.length) await log(notes.join(' · '));
  const [updated] = await tx.select().from(bookings).where(eq(bookings.id, b.id));
  return updated!;
}
