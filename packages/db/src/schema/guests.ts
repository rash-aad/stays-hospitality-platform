import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts } from './_common.js';

export const guests = pgTable(
  'guests',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    phone: text('phone'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    country: text('country'),
    passwordHash: text('password_hash'),
    emailVerifiedAt: ts('email_verified_at'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, boolean>>().notNull().default({}),
    /** Set when personal data was erased on request (DPDP); financial records keep the pseudonymised row. */
    anonymizedAt: ts('anonymized_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('guests_tenant_email_uq').on(t.tenantId, sql`lower(${t.email})`),
    index('guests_tenant_name_idx').on(t.tenantId, t.lastName),
  ],
);

/** Loyalty points: earned on checked-out stays, spent against bookings, returned on cancellation. */
export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: id(),
    tenantId: tenantId(),
    guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id'),
    paymentId: uuid('payment_id'),
    kind: text('kind', { enum: ['earn', 'redeem', 'reverse', 'adjust'] }).notNull(),
    points: integer('points').notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('loyalty_ledger_guest_idx').on(t.tenantId, t.guestId),
    // A stay earns once.
    uniqueIndex('loyalty_ledger_earn_uq').on(t.bookingId).where(sql`${t.kind} = 'earn'`),
  ],
);

/** Email campaigns to guests who opted in to marketing. */
export const campaigns = pgTable('campaigns', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  segment: jsonb('segment').$type<{ stayedWithinDays?: number | null; minStays?: number | null; tags?: string[]; country?: string | null }>().notNull().default({}),
  status: text('status', { enum: ['draft', 'sending', 'sent'] }).notNull().default('draft'),
  recipients: integer('recipients').notNull().default(0),
  sentAt: ts('sent_at'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
});
