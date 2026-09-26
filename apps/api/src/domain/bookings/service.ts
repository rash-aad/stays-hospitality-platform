import {
  addOns, bookingItems, bookings, coupons, folioCharges, guests, housekeepingTasks, invoices, payments, properties,
  ratePlans, rateSeasons, rooms, roomTypes, stays, taxes, type BillTo, type InvoiceLine, type PaymentMethod,
} from '@hp/db';
import { and, asc, eq, gt, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { AppError, badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { formatDate, todayIn, zonedTime } from '../../lib/dates.js';
import { reference } from '../../lib/ids.js';
import { formatMoney } from '../../lib/money.js';
import { siteUrl } from '../../lib/site-url.js';
import { getBilling, supplierSnapshot } from '../billing/service.js';
import { financialYear } from '../billing/gst.js';
import { payToken } from './pay-token.js';
import { issueAccessLink } from '../guests/access.js';
import { notify } from '../notifications/notify.js';
import { enabledMethods, getSettings, startPayment, type Instructions } from '../payments/service.js';
import { registerPaymentTarget } from '../payments/targets.js';
import { releaseInventory, reserveInventory } from './inventory.js';
import { nightPricer } from '../revenue/rules.js';
import { cancellationFee, eachNight, quoteStay, type Quote } from './pricing.js';

type Booking = typeof bookings.$inferSelect;

export type StayRequest = {
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  couponCode?: string | null;
  addOnIds?: string[];
};

export async function priceStay(tx: Tx, tenant: TenantInfo, req: StayRequest, opts: { enforceLeadTime?: boolean; ignoreStayRules?: boolean } = {}) {
  const [rt] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, req.roomTypeId), eq(roomTypes.tenantId, tenant.id), eq(roomTypes.active, true)));
  if (!rt) throw notFound('Room type');
  const [plan] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, req.ratePlanId), eq(ratePlans.roomTypeId, rt.id), eq(ratePlans.active, true)));
  if (!plan) throw notFound('Rate plan');
  const [prop] = await tx.select().from(properties).where(eq(properties.id, rt.propertyId));
  if (req.checkOut <= req.checkIn) throw badRequest('Departure must be after arrival');
  if (opts.enforceLeadTime !== false && req.checkIn < todayIn(prop!.timezone)) throw badRequest('Arrival date is in the past');
  const nights = eachNight(req.checkIn, req.checkOut).length;
  if (nights > 60) throw badRequest('Stays longer than 60 nights must be booked with the property');
  if (req.adults < 1) throw badRequest('At least one adult is required');
  if (req.adults > rt.maxAdults || req.children > rt.maxChildren || req.adults + req.children > rt.maxOccupancy) {
    throw badRequest(`${rt.name} sleeps up to ${rt.maxOccupancy} (${rt.maxAdults} adults, ${rt.maxChildren} children)`);
  }
  const seasons = await tx.select().from(rateSeasons).where(and(eq(rateSeasons.ratePlanId, plan.id), lte(rateSeasons.startDate, req.checkOut), sql`${rateSeasons.endDate} >= ${req.checkIn}`));
  const seasonMin = Math.max(plan.minStay, ...seasons.map((s) => s.minStay ?? 0));
  if (!opts.ignoreStayRules && nights < seasonMin) throw badRequest(`${plan.name} requires a minimum stay of ${seasonMin} nights`);
  if (!opts.ignoreStayRules && nights > plan.maxStay) throw badRequest(`${plan.name} allows at most ${plan.maxStay} nights`);
  const taxRows = await tx.select().from(taxes).where(and(eq(taxes.tenantId, tenant.id), eq(taxes.active, true)));
  let coupon: typeof coupons.$inferSelect | undefined;
  let couponError: string | null = null;
  if (req.couponCode?.trim()) {
    [coupon] = await tx.select().from(coupons).where(and(eq(coupons.tenantId, tenant.id), eq(sql`upper(${coupons.code})`, req.couponCode.trim().toUpperCase()), eq(coupons.active, true)));
    const today = todayIn(prop!.timezone);
    if (!coupon) couponError = 'This code is not valid';
    else if ((coupon.validFrom && today < coupon.validFrom) || (coupon.validTo && today > coupon.validTo)) couponError = 'This code has expired', (coupon = undefined);
    else if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) couponError = 'This code has been fully redeemed', (coupon = undefined);
  }
  const extras = req.addOnIds?.length
    ? await tx.select().from(addOns).where(and(eq(addOns.tenantId, tenant.id), inArray(addOns.id, req.addOnIds), eq(addOns.active, true)))
    : [];
  const pricer = await nightPricer(tx, tenant.id, prop!.timezone, rt.id, req.checkIn, req.checkOut);
  const quote = quoteStay({
    checkIn: req.checkIn, checkOut: req.checkOut, adults: req.adults, children: req.children, baseOccupancy: rt.baseOccupancy,
    plan, seasons, taxes: taxRows, coupon: coupon ?? null, addOns: extras, nightPrice: pricer?.price,
  });
  if (couponError) quote.couponError = couponError;
  return { quote, roomType: rt, plan, property: prop!, coupon: quote.couponApplied ? coupon! : null };
}

export type GuestDetails = { email: string; firstName: string; lastName: string; phone?: string | null; country?: string | null };

async function upsertGuest(tx: Tx, tenantId: string, g: GuestDetails) {
  const [existing] = await tx.select().from(guests).where(and(eq(guests.tenantId, tenantId), eq(sql`lower(${guests.email})`, g.email.trim().toLowerCase())));
  if (existing) {
    // Never overwrite a known guest's identity from an anonymous form; only fill blanks.
    if (!existing.phone && g.phone) await tx.update(guests).set({ phone: g.phone }).where(eq(guests.id, existing.id));
    return existing;
  }
  const [created] = await tx.insert(guests).values({ tenantId, email: g.email.trim(), firstName: g.firstName.trim(), lastName: g.lastName.trim(), phone: g.phone, country: g.country }).returning();
  return created!;
}

export async function createBooking(
  tx: Tx,
  tenant: TenantInfo,
  input: StayRequest & {
    guest: GuestDetails | { guestId: string };
    paymentMethod: PaymentMethod;
    specialRequests?: string | null;
    arrivalTime?: string | null;
    source: Booking['source'];
    createdByUserId?: string | null;
  },
): Promise<{ booking: Booking; quote: Quote; instructions: Instructions | null }> {
  const isStaff = !!input.createdByUserId;
  const { quote, roomType, plan, property, coupon } = await priceStay(tx, tenant, input, { enforceLeadTime: !isStaff });
  if (input.couponCode && quote.couponError) throw badRequest(quote.couponError);
  const settings = await getSettings(tx, tenant.id);
  const allowed = isStaff ? (['pay_at_property', ...enabledMethods(tenant, settings, 'booking')] as PaymentMethod[]) : enabledMethods(tenant, settings, 'booking');
  if (!allowed.includes(input.paymentMethod)) throw badRequest('This payment method is not available', { allowed });

  const guest = 'guestId' in input.guest
    ? (await tx.select().from(guests).where(and(eq(guests.id, input.guest.guestId), eq(guests.tenantId, tenant.id))))[0]
    : await upsertGuest(tx, tenant.id, input.guest);
  if (!guest) throw notFound('Guest');

  await reserveInventory(tx, tenant.id, roomType.id, input.checkIn, input.checkOut);
  if (coupon) {
    const [ok] = await tx
      .update(coupons)
      .set({ redemptions: sql`${coupons.redemptions} + 1` })
      .where(and(eq(coupons.id, coupon.id), or(isNull(coupons.maxRedemptions), lt(coupons.redemptions, coupons.maxRedemptions))))
      .returning({ id: coupons.id });
    if (!ok) throw conflict('This code has just been fully redeemed');
  }

  const online = input.paymentMethod === 'upi_manual' || input.paymentMethod === 'upi_gateway';
  const [booking] = await tx.insert(bookings).values({
    tenantId: tenant.id, propertyId: property.id, guestId: guest.id, reference: reference('BK'),
    status: online ? 'pending_payment' : 'confirmed', paymentStatus: online ? 'awaiting_payment' : 'unpaid',
    checkIn: input.checkIn, checkOut: input.checkOut, adults: input.adults, children: input.children, source: input.source,
    currency: tenant.currency, subtotal: quote.subtotal, discount: quote.discount, taxTotal: quote.taxTotal, total: quote.total,
    couponId: coupon?.id ?? null, specialRequests: input.specialRequests, arrivalTime: input.arrivalTime, createdByUserId: input.createdByUserId ?? null,
  }).returning();
  const roomTax = quote.taxTotal - quote.addOns.reduce((s, a) => s + a.taxAmount, 0);
  await tx.insert(bookingItems).values([
    {
      tenantId: tenant.id, bookingId: booking!.id, kind: 'room', roomTypeId: roomType.id, ratePlanId: plan.id,
      description: `${roomType.name} — ${plan.name}`, quantity: quote.nights.length, amount: quote.roomSubtotal - quote.discount, taxAmount: roomTax, nightly: quote.nights,
    },
    ...quote.addOns.map((a) => ({ tenantId: tenant.id, bookingId: booking!.id, kind: 'addon' as const, addOnId: a.id, description: a.name, amount: a.amount, taxAmount: a.taxAmount })),
  ]);
  await tx.insert(stays).values({ tenantId: tenant.id, bookingId: booking!.id, guestId: guest.id, status: 'upcoming' });

  let instructions: Instructions | null = null;
  let final = booking!;
  if (online) {
    const r = await startPayment(tx, {
      tenant, settings, method: input.paymentMethod as 'upi_manual' | 'upi_gateway', targetType: 'booking', targetId: booking!.id, bookingId: booking!.id,
      guestId: guest.id, amount: quote.total, description: `Booking ${booking!.reference}`,
    });
    instructions = r.instructions;
    [final] = await tx.update(bookings).set({ holdExpiresAt: r.payment.expiresAt }).where(eq(bookings.id, booking!.id)).returning() as [Booking];
    await notify(tx, {
      tenantId: tenant.id, recipient: { type: 'guest', id: guest.id }, templateKey: 'booking.awaiting_payment', channels: ['email'],
      vars: { name: guest.firstName, reference: booking!.reference, total: formatMoney(quote.total, tenant.currency), holdUntil: r.payment.expiresAt?.toLocaleString('en-IN', { timeZone: tenant.timezone }), vpa: settings.upiVpa ?? '', link: `${await siteUrl(tx, tenant.id)}/book/pay/${booking!.id}?token=${payToken(booking!.id)}` },
      related: { type: 'booking', id: booking!.id },
    });
  } else {
    await onConfirmed(tx, tenant, final);
  }
  return { booking: final, quote, instructions };
}

async function onConfirmed(tx: Tx, tenant: Pick<TenantInfo, 'id' | 'slug' | 'name' | 'currency'>, b: Booking) {
  const [g] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  const [prop] = await tx.select().from(properties).where(eq(properties.id, b.propertyId));
  const token = await issueAccessLinkSilently(tx, tenant, g!, b);
  await notify(tx, {
    tenantId: tenant.id, recipient: { type: 'guest', id: b.guestId }, templateKey: 'booking.confirmed', channels: ['email', 'in_app'],
    vars: {
      name: g!.firstName, property: prop!.name, reference: b.reference, checkIn: formatDate(b.checkIn), checkOut: formatDate(b.checkOut),
      room: item?.description ?? '', total: formatMoney(b.total, b.currency), link: `${await siteUrl(tx, tenant.id)}/stay/access?token=${token}`,
    },
    related: { type: 'booking', id: b.id },
  });
}

/** A fresh access token for the confirmation email (the separate access-link email is not sent). */
async function issueAccessLinkSilently(tx: Tx, tenant: Pick<TenantInfo, 'id' | 'slug' | 'name'>, g: { id: string; firstName: string }, b: Booking) {
  const { createOneTimeToken } = await import('../auth/service.js');
  return createOneTimeToken(tx, { kind: 'guest_access', tenantId: tenant.id, guestId: g.id, bookingId: b.id, ttlMinutes: 60 * 24 * 14 });
}

async function tenantLite(tx: Tx, tenantId: string) {
  const { tenants } = await import('@hp/db');
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  return t!;
}

async function recomputePaid(tx: Tx, bookingId: string) {
  const rows = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, bookingId)));
  const paid = rows.filter((p) => ['captured', 'partially_refunded', 'refunded'].includes(p.status)).reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const refunded = rows.reduce((s, p) => s + p.refundedAmount, 0);
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  const status: Booking['paymentStatus'] =
    refunded > 0 && paid === 0 ? 'refunded' : refunded > 0 ? 'partially_refunded' : paid >= b!.total ? 'paid' : paid > 0 ? 'partially_paid' : b!.paymentStatus;
  await tx.update(bookings).set({ amountPaid: paid, paymentStatus: status }).where(eq(bookings.id, bookingId));
}

registerPaymentTarget('booking', {
  async onCaptured(tx, p) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.targetId)).for('update');
    if (!b) return;
    const t = await tenantLite(tx, b.tenantId);
    if (b.status === 'expired' || b.status === 'cancelled') {
      // Paid after the hold lapsed: try to re-take the inventory; otherwise leave for staff to refund.
      try {
        const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
        await reserveInventory(tx, b.tenantId, item!.roomTypeId!, b.checkIn, b.checkOut);
        await tx.update(stays).set({ status: 'upcoming' }).where(eq(stays.bookingId, b.id));
      } catch {
        // Room no longer available: keep the booking closed and flag the payment for a staff refund.
        await tx.update(payments).set({ metadata: { ...p.metadata, needsRefund: true, note: 'Paid after hold expired; room no longer available' } }).where(eq(payments.id, p.id));
        await recomputePaid(tx, b.id);
        return;
      }
    }
    const wasPending = b.status !== 'confirmed' && b.status !== 'checked_in';
    const [updated] = await tx.update(bookings).set({ status: wasPending ? 'confirmed' : b.status, holdExpiresAt: null, cancelledAt: null }).where(eq(bookings.id, b.id)).returning();
    await recomputePaid(tx, b.id);
    if (wasPending) await onConfirmed(tx, t, updated!);
  },
  async onSubmitted(tx, p) {
    const [b] = await tx.update(bookings).set({ paymentStatus: 'pending_verification', holdExpiresAt: p.expiresAt }).where(eq(bookings.id, p.targetId)).returning();
    const [g] = await tx.select().from(guests).where(eq(guests.id, b!.guestId));
    await notify(tx, { tenantId: b!.tenantId, recipient: { type: 'guest', id: b!.guestId }, templateKey: 'booking.payment_submitted', vars: { name: g!.firstName, reference: b!.reference, utr: p.utr }, related: { type: 'booking', id: b!.id } });
  },
  async onRejected(tx, p) {
    const [b] = await tx.update(bookings).set({ paymentStatus: 'awaiting_payment', holdExpiresAt: p.expiresAt }).where(eq(bookings.id, p.targetId)).returning();
    const t = await tenantLite(tx, b!.tenantId);
    const [g] = await tx.select().from(guests).where(eq(guests.id, b!.guestId));
    await notify(tx, {
      tenantId: b!.tenantId, recipient: { type: 'guest', id: b!.guestId }, templateKey: 'booking.payment_rejected',
      vars: { name: g!.firstName, reference: b!.reference, utr: p.utr, reason: p.rejectionReason, holdUntil: p.expiresAt?.toLocaleString('en-IN', { timeZone: t.timezone }), link: `${await siteUrl(tx, b!.tenantId)}/book/pay/${b!.id}?token=${payToken(b!.id)}` },
      related: { type: 'booking', id: b!.id },
    });
  },
  async onRefunded(tx, p) {
    await recomputePaid(tx, p.targetId);
  },
});

export async function cancelBooking(
  tx: Tx,
  tenant: TenantInfo,
  bookingId: string,
  opts: { by: 'guest' | 'staff' | 'system'; reason?: string; waiveFee?: boolean; guestId?: string },
) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b || (opts.guestId && b.guestId !== opts.guestId)) throw notFound('Booking');
  if (!['pending_payment', 'confirmed'].includes(b.status)) throw conflict(`A ${b.status.replace('_', ' ')} booking cannot be cancelled`);
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  const [plan] = item?.ratePlanId ? await tx.select().from(ratePlans).where(eq(ratePlans.id, item.ratePlanId)) : [];
  const [prop] = await tx.select().from(properties).where(eq(properties.id, b.propertyId));
  const arrival = zonedTime(b.checkIn, prop!.checkInTime.slice(0, 5), prop!.timezone);
  const fee = opts.waiveFee || b.status === 'pending_payment' || !plan
    ? 0
    : cancellationFee(plan.cancellationPolicy, plan.refundable, b.total, arrival, new Date());
  await releaseInventory(tx, item!.roomTypeId!, b.checkIn, b.checkOut);
  const [updated] = await tx
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: new Date(), cancellationReason: opts.reason ?? `Cancelled by ${opts.by}`, cancellationFee: fee, holdExpiresAt: null })
    .where(eq(bookings.id, b.id))
    .returning();
  await tx.update(stays).set({ status: 'cancelled' }).where(eq(stays.bookingId, b.id));
  await tx.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id), inArray(payments.status, ['awaiting_payment', 'pending_verification', 'rejected'])));
  const refundDue = Math.max(0, b.amountPaid - fee);
  const [g] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
  await notify(tx, {
    tenantId: tenant.id, recipient: { type: 'guest', id: b.guestId }, templateKey: 'booking.cancelled',
    vars: { name: g!.firstName, reference: b.reference, refundNote: refundDue > 0 ? `A refund of ${formatMoney(refundDue, b.currency)} will be processed to your original payment method.` : fee > 0 ? `A cancellation charge of ${formatMoney(fee, b.currency)} applies under the rate's policy.` : '' },
    related: { type: 'booking', id: b.id },
  });
  return { booking: updated!, fee, refundDue };
}

/** Release holds whose payment window lapsed. Runs across tenants from the worker. */
export async function expireHolds(tx: Tx, now = new Date()) {
  const due = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, 'pending_payment'), lt(bookings.holdExpiresAt, now)))
    .limit(200)
    .for('update', { skipLocked: true });
  for (const b of due) {
    const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
    if (item?.roomTypeId) await releaseInventory(tx, item.roomTypeId, b.checkIn, b.checkOut);
    await tx.update(bookings).set({ status: 'expired', holdExpiresAt: null }).where(eq(bookings.id, b.id));
    await tx.update(stays).set({ status: 'cancelled' }).where(eq(stays.bookingId, b.id));
    await tx.update(payments).set({ status: 'expired' }).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id), inArray(payments.status, ['awaiting_payment', 'pending_verification', 'rejected'])));
    if (b.couponId) await tx.update(coupons).set({ redemptions: sql`greatest(${coupons.redemptions} - 1, 0)` }).where(eq(coupons.id, b.couponId));
    const [g] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
    await notify(tx, { tenantId: b.tenantId, recipient: { type: 'guest', id: b.guestId }, templateKey: 'booking.expired', channels: ['email'], vars: { name: g?.firstName, reference: b.reference } });
  }
  return due.length;
}

export async function modifyBooking(
  tx: Tx,
  tenant: TenantInfo,
  bookingId: string,
  change: { checkIn: string; checkOut: string; adults: number; children: number; roomTypeId?: string; ratePlanId?: string },
) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  if (!['confirmed', 'pending_payment'].includes(b.status)) throw conflict('Only upcoming bookings can be modified');
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  const roomTypeId = change.roomTypeId ?? item!.roomTypeId!;
  const ratePlanId = change.ratePlanId ?? item!.ratePlanId!;
  // Release first so a date shift that overlaps the original nights can reuse them.
  await releaseInventory(tx, item!.roomTypeId!, b.checkIn, b.checkOut);
  const { quote, roomType, plan } = await priceStay(tx, tenant, { ...change, roomTypeId, ratePlanId }, { enforceLeadTime: false });
  await reserveInventory(tx, tenant.id, roomTypeId, change.checkIn, change.checkOut);
  const extras = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'addon')));
  const addOnAmount = extras.reduce((s, a) => s + a.amount, 0);
  const addOnTax = extras.reduce((s, a) => s + a.taxAmount, 0);
  const roomTax = quote.taxTotal - quote.addOns.reduce((s, a) => s + a.taxAmount, 0);
  const total = quote.roomSubtotal - quote.discount + roomTax + addOnAmount + addOnTax;
  await tx.update(bookingItems).set({ roomTypeId, ratePlanId, description: `${roomType.name} — ${plan.name}`, quantity: quote.nights.length, amount: quote.roomSubtotal - quote.discount, taxAmount: roomTax, nightly: quote.nights }).where(eq(bookingItems.id, item!.id));
  const [updated] = await tx.update(bookings).set({
    checkIn: change.checkIn, checkOut: change.checkOut, adults: change.adults, children: change.children,
    subtotal: quote.roomSubtotal + addOnAmount, discount: quote.discount, taxTotal: roomTax + addOnTax, total,
    paymentStatus: b.amountPaid >= total ? (b.amountPaid > 0 ? 'paid' : b.paymentStatus) : b.amountPaid > 0 ? 'partially_paid' : b.paymentStatus,
  }).where(eq(bookings.id, b.id)).returning();
  return { booking: updated!, previousTotal: b.total, balance: total - b.amountPaid };
}

/** Rooms of the right type that are free for the booking's dates and not out of service. */
export async function assignableRooms(tx: Tx, b: Booking, roomTypeId: string) {
  const busy = tx
    .select({ id: stays.roomId })
    .from(stays)
    .innerJoin(bookings, eq(bookings.id, stays.bookingId))
    .where(and(
      inArray(stays.status, ['upcoming', 'in_house']), ne(stays.bookingId, b.id), sql`${stays.roomId} is not null`,
      lt(bookings.checkIn, b.checkOut), gt(bookings.checkOut, b.checkIn), inArray(bookings.status, ['confirmed', 'checked_in']),
    ));
  return tx.select().from(rooms).where(and(eq(rooms.roomTypeId, roomTypeId), eq(rooms.status, 'active'), notInArray(rooms.id, busy))).orderBy(asc(rooms.number));
}

/** Serialise room assignment within a room type (two desks can't put different guests in one room). */
export async function lockRoomAssignments(tx: Tx, roomTypeId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`room-assign:${roomTypeId}`}))`);
}

export async function assignRoom(tx: Tx, tenant: TenantInfo, bookingId: string, roomId: string | null) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  await lockRoomAssignments(tx, item!.roomTypeId!);
  const free = await assignableRooms(tx, b, item!.roomTypeId!);
  const room = roomId ? free.find((r) => r.id === roomId) : free.find((r) => r.housekeepingStatus === 'inspected' || r.housekeepingStatus === 'clean') ?? free[0];
  if (!room) throw conflict(roomId ? 'That room is not available for these dates' : 'No room of this type is free for these dates');
  await tx.update(stays).set({ roomId: room.id }).where(eq(stays.bookingId, b.id));
  await tx.update(bookingItems).set({ roomId: room.id }).where(eq(bookingItems.id, item!.id));
  return room;
}

export async function checkIn(tx: Tx, tenant: TenantInfo, bookingId: string, roomId?: string | null) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  if (b.status !== 'confirmed') throw conflict(b.status === 'pending_payment' ? 'Payment has not been confirmed yet' : `Cannot check in a ${b.status.replace('_', ' ')} booking`);
  const [stay] = await tx.select().from(stays).where(eq(stays.bookingId, b.id));
  const room = roomId !== undefined || !stay?.roomId ? await assignRoom(tx, tenant, b.id, roomId ?? null) : { id: stay.roomId };
  await tx.update(stays).set({ status: 'in_house', checkedInAt: new Date(), roomId: room.id }).where(eq(stays.bookingId, b.id));
  const [updated] = await tx.update(bookings).set({ status: 'checked_in' }).where(eq(bookings.id, b.id)).returning();
  return updated!;
}

export async function checkOut(tx: Tx, tenant: TenantInfo, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  if (b.status !== 'checked_in') throw conflict('Only in-house bookings can be checked out');
  const [stay] = await tx.select().from(stays).where(eq(stays.bookingId, b.id));
  await tx.update(stays).set({ status: 'departed', checkedOutAt: new Date() }).where(eq(stays.id, stay!.id));
  const [updated] = await tx.update(bookings).set({ status: 'checked_out' }).where(eq(bookings.id, b.id)).returning();
  if (stay?.roomId) {
    const [room] = await tx.update(rooms).set({ housekeepingStatus: 'dirty' }).where(eq(rooms.id, stay.roomId)).returning();
    const [prop] = await tx.select().from(properties).where(eq(properties.id, b.propertyId));
    await tx.insert(housekeepingTasks).values({ tenantId: tenant.id, propertyId: b.propertyId, roomId: room!.id, kind: 'departure', priority: 'high', scheduledFor: todayIn(prop!.timezone) });
    // Free the unused nights if the guest left early.
    const today = todayIn(prop!.timezone);
    const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
    if (today < b.checkOut && item?.roomTypeId) await releaseInventory(tx, item.roomTypeId, today > b.checkIn ? today : b.checkIn, b.checkOut);
  }
  const invoice = await generateInvoice(tx, tenant, b.id, true);
  return { booking: updated!, invoice };
}

export async function markNoShow(tx: Tx, tenant: TenantInfo, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id))).for('update');
  if (!b) throw notFound('Booking');
  if (b.status !== 'confirmed') throw conflict('Only confirmed bookings can be marked as no-show');
  const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
  await releaseInventory(tx, item!.roomTypeId!, b.checkIn, b.checkOut);
  await tx.update(stays).set({ status: 'cancelled' }).where(eq(stays.bookingId, b.id));
  const [u] = await tx.update(bookings).set({ status: 'no_show' }).where(eq(bookings.id, b.id)).returning();
  return u!;
}

/**
 * Build (or refresh) the folio invoice: room + add-ons + everything charged to the room.
 * Each line carries its SAC code and GST rate. Issuing freezes supplier and buyer details and
 * assigns a gap-free number per financial year (PREFIX/2026-27/00001), as Indian tax invoices require.
 */
export async function generateInvoice(tx: Tx, tenant: TenantInfo, bookingId: string, issue = false) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenant.id)));
  if (!b) throw notFound('Booking');
  const billing = await getBilling(tx, tenant.id);
  const items = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id));
  const charges = await tx.select().from(folioCharges).where(and(eq(folioCharges.bookingId, b.id), isNull(folioCharges.voidedAt)));
  const rate = (amount: number, tax: number) => (amount > 0 ? Math.round((tax / amount) * 10_000) : 0);
  const lines: InvoiceLine[] = [
    ...items.map((i) => ({ description: i.description, quantity: i.quantity, amount: i.amount, taxAmount: i.taxAmount, source: i.kind, sac: i.kind === 'room' ? billing.sacRoom : billing.sacService, rateBps: rate(i.amount, i.taxAmount) })),
    ...charges.map((c) => ({
      description: c.description, date: c.createdAt.toISOString().slice(0, 10), quantity: 1, amount: c.amount, taxAmount: c.taxAmount, source: c.sourceType,
      sac: c.sourceType === 'order' ? billing.sacFood : billing.sacService, rateBps: rate(c.amount, c.taxAmount),
    })),
  ];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxTotal = lines.reduce((s, l) => s + l.taxAmount, 0);
  const total = subtotal + taxTotal;
  const paidRows = await tx.select().from(payments).where(and(eq(payments.bookingId, b.id), inArray(payments.status, ['captured', 'partially_refunded', 'refunded'])));
  const amountPaid = paidRows.reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const [guest] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
  const billTo: BillTo = { name: `${guest!.firstName} ${guest!.lastName}`.trim(), email: guest!.email, ...((b.billTo as Partial<BillTo> | null) ?? {}) };
  const [existing] = await tx.select().from(invoices).where(and(eq(invoices.bookingId, b.id), ne(invoices.status, 'void')));
  if (existing?.issuedAt) {
    // Issued invoices are immutable apart from settlement status.
    const [u] = await tx.update(invoices).set({ amountPaid, status: amountPaid >= existing.total ? 'paid' : 'issued' }).where(eq(invoices.id, existing.id)).returning();
    return u!;
  }
  const status = issue ? (amountPaid >= total ? 'paid' : 'issued') : 'draft';
  const frozen = issue ? { supplier: await supplierSnapshot(tx, tenant.id), billTo, issuedAt: new Date() } : { billTo };
  let number = existing?.number;
  if (!number || (issue && number.startsWith('DRAFT-'))) {
    if (issue) {
      // Gap-free per tenant and financial year, serialised by an advisory lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenant.id} || ':invoice'))`);
      const fy = financialYear(new Date(), tenant.timezone);
      const prefix = `${billing.invoicePrefix}/${fy}/`;
      const [{ n }] = (await tx.execute(sql`select count(*)::int + 1 as n from invoices where tenant_id = ${tenant.id} and number like ${`${prefix}%`}`)) as unknown as [{ n: number }];
      number = `${prefix}${String(n).padStart(5, '0')}`;
    } else {
      number = `DRAFT-${b.reference}`;
    }
  }
  if (existing) {
    const [u] = await tx.update(invoices).set({ number, lines, subtotal, taxTotal, total, amountPaid, status, ...frozen }).where(eq(invoices.id, existing.id)).returning();
    return u!;
  }
  const [inv] = await tx.insert(invoices).values({ tenantId: tenant.id, guestId: b.guestId, bookingId: b.id, number, status, lines, currency: b.currency, subtotal, taxTotal, total, amountPaid, ...frozen }).returning();
  return inv!;
}

export { AppError };
