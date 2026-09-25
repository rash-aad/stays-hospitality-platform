import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { users } from './core.js';
import { guests } from './guests.js';
import { coupons, properties, ratePlans, rooms, roomTypes } from './property.js';

export const BOOKING_STATUSES = [
  'pending_payment', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired',
] as const;
export const PAYMENT_STATUSES = [
  'unpaid', 'awaiting_payment', 'pending_verification', 'partially_paid', 'paid', 'partially_refunded', 'refunded',
] as const;

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    guestId: uuid('guest_id').notNull().references(() => guests.id),
    reference: text('reference').notNull(),
    status: text('status', { enum: BOOKING_STATUSES }).notNull(),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUSES }).notNull().default('unpaid'),
    checkIn: date('check_in').notNull(),
    checkOut: date('check_out').notNull(),
    adults: integer('adults').notNull(),
    children: integer('children').notNull().default(0),
    source: text('source', { enum: ['direct', 'admin', 'phone', 'walk_in', 'ota', 'agent'] }).notNull().default('direct'),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    discount: integer('discount').notNull().default(0),
    taxTotal: integer('tax_total').notNull(),
    total: integer('total').notNull(),
    amountPaid: integer('amount_paid').notNull().default(0),
    couponId: uuid('coupon_id').references(() => coupons.id),
    specialRequests: text('special_requests'),
    arrivalTime: text('arrival_time'),
    holdExpiresAt: ts('hold_expires_at'),
    cancelledAt: ts('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    cancellationFee: integer('cancellation_fee'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bookings_tenant_ref_uq').on(t.tenantId, t.reference),
    index('bookings_tenant_dates_idx').on(t.tenantId, t.checkIn, t.checkOut),
    index('bookings_guest_idx').on(t.guestId),
    index('bookings_hold_idx').on(t.holdExpiresAt).where(sql`${t.status} = 'pending_payment'`),
    check('bookings_dates_ck', sql`${t.checkOut} > ${t.checkIn}`),
    check('bookings_guests_ck', sql`${t.adults} >= 1 and ${t.children} >= 0`),
  ],
);

export type NightlyRate = { date: string; price: number };

export const bookingItems = pgTable(
  'booking_items',
  {
    id: id(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['room', 'addon'] }).notNull(),
    roomTypeId: uuid('room_type_id').references(() => roomTypes.id),
    ratePlanId: uuid('rate_plan_id').references(() => ratePlans.id),
    roomId: uuid('room_id').references(() => rooms.id),
    addOnId: uuid('add_on_id'),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    amount: integer('amount').notNull(),
    taxAmount: integer('tax_amount').notNull().default(0),
    nightly: jsonb('nightly').$type<NightlyRate[]>().notNull().default([]),
  },
  (t) => [index('booking_items_booking_idx').on(t.bookingId)],
);

/** A guest's occupancy of a room for a booking. The guest portal resolves context from here. */
export const stays = pgTable(
  'stays',
  {
    id: id(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').notNull().references(() => guests.id),
    roomId: uuid('room_id').references(() => rooms.id),
    status: text('status', { enum: ['upcoming', 'in_house', 'departed', 'cancelled'] }).notNull().default('upcoming'),
    checkedInAt: ts('checked_in_at'),
    checkedOutAt: ts('checked_out_at'),
    createdAt: createdAt(),
  },
  (t) => [index('stays_guest_idx').on(t.guestId, t.status), index('stays_booking_idx').on(t.bookingId)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: tenantId(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idempotency_keys_pk').on(t.tenantId, t.scope, t.key)],
);
