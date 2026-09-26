import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { tenants, users } from './core.js';
import { guests } from './guests.js';
import { bookings } from './bookings.js';

export const PAYMENT_METHODS = ['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentSettings = pgTable('payment_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  methodsEnabled: text('methods_enabled').array().notNull().default(sql`'{}'::text[]`),
  upiVpa: text('upi_vpa'),
  upiPayeeName: text('upi_payee_name'),
  gatewayProvider: text('gateway_provider', { enum: ['razorpay', 'mock'] }),
  gatewayKeyId: text('gateway_key_id'),
  gatewaySecretEnc: text('gateway_secret_enc'),
  gatewayWebhookSecretEnc: text('gateway_webhook_secret_enc'),
  /** Minutes the guest has to pay and submit a UTR before the hold lapses. */
  manualPayWindowMinutes: integer('manual_pay_window_minutes').notNull().default(30),
  /** Hours staff have to verify a submitted UTR before the hold lapses. */
  verificationWindowHours: integer('verification_window_hours').notNull().default(24),
  requireProofUpload: boolean('require_proof_upload').notNull().default(false),
  updatedAt: updatedAt(),
});

export const PAYMENT_TXN_STATUSES = [
  'awaiting_payment', 'pending_verification', 'captured', 'rejected', 'failed', 'expired', 'cancelled',
  'refunded', 'partially_refunded',
] as const;

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    guestId: uuid('guest_id').references(() => guests.id),
    /** What is being paid for. Exactly one target is set. */
    targetType: text('target_type', { enum: ['booking', 'order', 'experience_booking', 'invoice'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    provider: text('provider', { enum: ['razorpay', 'mock'] }),
    status: text('status', { enum: PAYMENT_TXN_STATUSES }).notNull(),
    amount: integer('amount').notNull(),
    refundedAmount: integer('refunded_amount').notNull().default(0),
    currency: text('currency').notNull(),
    reference: text('reference').notNull(),
    /** UPI Transaction Reference submitted by the guest (manual UPI). */
    utr: text('utr'),
    proofFileId: uuid('proof_file_id'),
    payerVpa: text('payer_vpa'),
    providerOrderId: text('provider_order_id'),
    providerPaymentId: text('provider_payment_id'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: ts('verified_at'),
    rejectionReason: text('rejection_reason'),
    submittedAt: ts('submitted_at'),
    expiresAt: ts('expires_at'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** How money taken at the desk was tendered; cash counts toward the open drawer shift. */
    tender: text('tender', { enum: ['cash', 'card', 'upi', 'bank_transfer', 'other'] }),
    shiftId: uuid('shift_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_tenant_ref_uq').on(t.tenantId, t.reference),
    uniqueIndex('payments_tenant_utr_uq').on(t.tenantId, sql`upper(${t.utr})`).where(sql`${t.utr} is not null and ${t.status} <> 'rejected'`),
    uniqueIndex('payments_provider_payment_uq').on(t.provider, t.providerPaymentId).where(sql`${t.providerPaymentId} is not null`),
    index('payments_target_idx').on(t.targetType, t.targetId),
    index('payments_tenant_status_idx').on(t.tenantId, t.status),
    check('payments_amount_ck', sql`${t.amount} > 0 and ${t.refundedAmount} >= 0 and ${t.refundedAmount} <= ${t.amount}`),
  ],
);

export const refunds = pgTable('refunds', {
  id: id(),
  tenantId: tenantId(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  amount: integer('amount').notNull(),
  reason: text('reason'),
  status: text('status', { enum: ['pending', 'processed', 'failed', 'recorded'] }).notNull(),
  providerRefundId: text('provider_refund_id'),
  note: text('note'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  /** Cash handed back from a drawer shift. */
  shiftId: uuid('shift_id'),
  createdAt: createdAt(),
});

/** A cashier's drawer from opening float to count-up. */
export const cashShifts = pgTable(
  'cash_shifts',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    openingFloat: integer('opening_float').notNull(),
    openedAt: createdAt(),
    closedAt: ts('closed_at'),
    expectedCash: integer('expected_cash'),
    countedCash: integer('counted_cash'),
    variance: integer('variance'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('cash_shifts_one_open_uq').on(t.tenantId, t.userId).where(sql`${t.status} = 'open'`), index('cash_shifts_tenant_idx').on(t.tenantId, t.openedAt)],
);

/** Cash in or out of a drawer that isn't a guest payment (petty cash, a safe drop, change top-up). */
export const cashMovements = pgTable('cash_movements', {
  id: id(),
  tenantId: tenantId(),
  shiftId: uuid('shift_id').notNull().references(() => cashShifts.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['paid_out', 'paid_in', 'drop'] }).notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
});

/** A closed business day (night audit) with the day's figures frozen. */
export const businessDays = pgTable(
  'business_days',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull(),
    date: date('date').notNull(),
    closedAt: createdAt(),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('business_days_uq').on(t.tenantId, t.propertyId, t.date)],
);

/** Idempotency for scheduled reports (one daily report per tenant per date). */
export const reportRuns = pgTable(
  'report_runs',
  { tenantId: tenantId(), kind: text('kind').notNull(), date: date('date').notNull(), createdAt: createdAt() },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind, t.date] })],
);

export type InvoiceLine = { description: string; date?: string; quantity: number; amount: number; taxAmount: number; source?: string; sac?: string; rateBps?: number };
/** Buyer details for a GST tax invoice (B2B guests can claim input credit with their GSTIN). */
export type BillTo = { name: string; company?: string | null; gstin?: string | null; address?: string | null; stateCode?: string | null; email?: string | null };
/** Supplier details frozen onto the invoice when it is issued (issued invoices never change). */
export type Supplier = { legalName: string; tradeName: string; gstin: string | null; address: string; stateCode: string | null; stateName: string | null; phone: string | null; email: string | null };

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    guestId: uuid('guest_id').notNull().references(() => guests.id),
    bookingId: uuid('booking_id').references(() => bookings.id),
    number: text('number').notNull(),
    status: text('status', { enum: ['draft', 'issued', 'paid', 'void'] }).notNull().default('draft'),
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull().default([]),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    taxTotal: integer('tax_total').notNull(),
    total: integer('total').notNull(),
    amountPaid: integer('amount_paid').notNull().default(0),
    billTo: jsonb('bill_to').$type<BillTo | null>(),
    supplier: jsonb('supplier').$type<Supplier | null>(),
    issuedAt: ts('issued_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invoices_tenant_number_uq').on(t.tenantId, t.number)],
);

/** Charges posted to a stay's folio (room-charged orders, experiences, minibar...). */
export const folioCharges = pgTable(
  'folio_charges',
  {
    id: id(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
    sourceType: text('source_type', { enum: ['order', 'experience_booking', 'service', 'manual'] }).notNull(),
    sourceId: uuid('source_id'),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    taxAmount: integer('tax_amount').notNull().default(0),
    voidedAt: ts('voided_at'),
    createdAt: createdAt(),
  },
  (t) => [index('folio_booking_idx').on(t.bookingId)],
);
