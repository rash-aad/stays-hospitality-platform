import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
  createdAt: createdAt(),
});

export type InvoiceLine = { description: string; date?: string; quantity: number; amount: number; taxAmount: number; source?: string };

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
