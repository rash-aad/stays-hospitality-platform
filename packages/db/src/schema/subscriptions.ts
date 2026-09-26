import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { users } from './core.js';
import type { BillTo, Supplier } from './payments.js';

/** bookEZ's own billing settings (UPI ID, GSTIN, invoice prefix…) and other platform-wide values. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
});

/**
 * What a property pays bookEZ. Prices are per tenant (excluding GST, in paise). `trialEndsAt` and
 * `paidUntil` are the last covered day (inclusive). Due/overdue are derived from the dates.
 */
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  tenantId: tenantId().primaryKey(),
  status: text('status', { enum: ['trial', 'active', 'comp', 'cancelled'] }).notNull().default('trial'),
  startedAt: date('started_at').notNull(),
  trialEndsAt: date('trial_ends_at').notNull(),
  paidUntil: date('paid_until'),
  monthlyFee: integer('monthly_fee'),
  yearlyFee: integer('yearly_fee'),
  /** Preferred cycle (the last one paid for). */
  cycle: text('cycle', { enum: ['monthly', 'yearly'] }),
  /** Per-tenant override of the platform grace period. */
  graceDays: integer('grace_days'),
  /** Set when bookEZ suspended the tenant for non-payment, so a verified payment knows to reactivate. */
  suspendedReason: text('suspended_reason', { enum: ['non_payment'] }),
  billTo: jsonb('bill_to').$type<BillTo | null>(),
  cancelledAt: ts('cancelled_at'),
  updatedAt: updatedAt(),
});

/** bookEZ's tax invoice to a property. Numbered per financial year when issued; never changed afterwards. */
export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    financialYear: text('financial_year').notNull(),
    status: text('status', { enum: ['open', 'pending_verification', 'paid', 'void'] }).notNull().default('open'),
    cycle: text('cycle', { enum: ['monthly', 'yearly'] }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amount: integer('amount').notNull(),
    cgst: integer('cgst').notNull().default(0),
    sgst: integer('sgst').notNull().default(0),
    igst: integer('igst').notNull().default(0),
    total: integer('total').notNull(),
    gstRateBps: integer('gst_rate_bps').notNull(),
    sac: text('sac').notNull(),
    supplier: jsonb('supplier').$type<Supplier>().notNull(),
    billTo: jsonb('bill_to').$type<BillTo>().notNull(),
    issuedAt: createdAt(),
    paidAt: ts('paid_at'),
    voidedAt: ts('voided_at'),
  },
  (t) => [uniqueIndex('platform_invoices_number_uq').on(t.number), index('platform_invoices_tenant_idx').on(t.tenantId, t.issuedAt)],
);

/** A UPI payment a property says it made against an invoice; a platform admin verifies or rejects it. */
export const platformPayments = pgTable(
  'platform_payments',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').notNull().references(() => platformInvoices.id),
    amount: integer('amount').notNull(),
    utr: text('utr').notNull(),
    proofFileId: uuid('proof_file_id'),
    status: text('status', { enum: ['pending_verification', 'verified', 'rejected'] }).notNull().default('pending_verification'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    /** When the platform admins were reminded that this has waited over 12 hours. */
    staleNotifiedAt: ts('stale_notified_at'),
  },
  (t) => [
    // A UTR can only be claimed once across the whole platform (a rejected claim frees it).
    uniqueIndex('platform_payments_utr_uq').on(sql`upper(${t.utr})`).where(sql`${t.status} <> 'rejected'`),
    index('platform_payments_status_idx').on(t.status, t.submittedAt),
  ],
);
