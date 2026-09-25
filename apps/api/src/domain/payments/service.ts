import { paymentSettings, payments, refunds, rolePermissions, userRoles, users, type PaymentMethod } from '@hp/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { outer } from '../../lib/sql.js';
import QRCode from 'qrcode';
import type { TenantInfo } from '../../http/context.js';
import { AppError, badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { decryptSecret } from '../../lib/crypto.js';
import { reference } from '../../lib/ids.js';
import { formatMoney, toMajor } from '../../lib/money.js';
import { runtimeConfig } from '../../runtime.js';
import { notify } from '../notifications/notify.js';
import { GATEWAYS } from './gateways/index.js';
import type { GatewayCredentials, GatewayEvent } from './gateways/types.js';
import { targetHandler } from './targets.js';

type Payment = typeof payments.$inferSelect;
type Settings = typeof paymentSettings.$inferSelect;
export type Purpose = 'booking' | 'order' | 'experience';

export async function getSettings(tx: Tx, tenantId: string): Promise<Settings> {
  const [s] = await tx.select().from(paymentSettings).where(eq(paymentSettings.tenantId, tenantId));
  if (s) return s;
  const [created] = await tx.insert(paymentSettings).values({ tenantId, methodsEnabled: ['pay_at_property'] }).onConflictDoNothing().returning();
  return created ?? (await tx.select().from(paymentSettings).where(eq(paymentSettings.tenantId, tenantId)))[0]!;
}

export function gatewayConfigured(s: Settings) {
  return !!(s.gatewayProvider && s.gatewayKeyId && s.gatewaySecretEnc && s.gatewayWebhookSecretEnc);
}

export function gatewayCreds(s: Settings): GatewayCredentials {
  const key = runtimeConfig().SECRETS_MASTER_KEY;
  return { keyId: s.gatewayKeyId!, secret: decryptSecret(s.gatewaySecretEnc!, key), webhookSecret: decryptSecret(s.gatewayWebhookSecretEnc!, key) };
}

/**
 * Methods a guest may use right now. The tenant chooses which to offer; online methods also need the
 * Payments module and a complete configuration. Room charge needs an in-house stay.
 */
export function enabledMethods(tenant: TenantInfo, s: Settings, purpose: Purpose, opts: { inHouse?: boolean } = {}): PaymentMethod[] {
  const out: PaymentMethod[] = [];
  const online = tenant.modules.has('payments');
  if (online && s.methodsEnabled.includes('upi_manual') && s.upiVpa) out.push('upi_manual');
  if (online && s.methodsEnabled.includes('upi_gateway') && gatewayConfigured(s)) out.push('upi_gateway');
  if (purpose !== 'booking' && opts.inHouse && s.methodsEnabled.includes('room_charge')) out.push('room_charge');
  if (s.methodsEnabled.includes('pay_at_property') || (purpose === 'booking' && out.length === 0)) out.push('pay_at_property');
  return out;
}

export function upiUri(s: Settings, amount: number, ref: string, currency: string) {
  const params = new URLSearchParams({ pa: s.upiVpa!, pn: s.upiPayeeName ?? '', am: toMajor(amount), cu: currency, tn: ref, tr: ref });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

export type Instructions =
  | { kind: 'upi_manual'; vpa: string; payeeName: string | null; amount: number; currency: string; reference: string; upiUri: string; qrSvg: string; expiresAt: string | null; requireProof: boolean }
  | { kind: 'upi_gateway'; checkout: Record<string, unknown>; reference: string; expiresAt: string | null };

export async function instructionsFor(s: Settings, p: Payment): Promise<Instructions | null> {
  if (p.method === 'upi_manual' && s.upiVpa) {
    const uri = upiUri(s, p.amount, p.reference, p.currency);
    return {
      kind: 'upi_manual', vpa: s.upiVpa, payeeName: s.upiPayeeName, amount: p.amount, currency: p.currency, reference: p.reference, upiUri: uri,
      qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), expiresAt: p.expiresAt?.toISOString() ?? null,
      requireProof: s.requireProofUpload,
    };
  }
  if (p.method === 'upi_gateway') {
    return { kind: 'upi_gateway', checkout: (p.metadata.checkout as Record<string, unknown>) ?? {}, reference: p.reference, expiresAt: p.expiresAt?.toISOString() ?? null };
  }
  return null;
}

export async function startPayment(
  tx: Tx,
  input: {
    tenant: TenantInfo; settings: Settings; method: 'upi_manual' | 'upi_gateway';
    targetType: Payment['targetType']; targetId: string; bookingId?: string | null; guestId: string | null;
    amount: number; description: string;
  },
) {
  if (input.amount <= 0) throw badRequest('Nothing to pay');
  const ref = reference('PAY', 8);
  const now = Date.now();
  if (input.method === 'upi_manual') {
    const [p] = await tx.insert(payments).values({
      tenantId: input.tenant.id, guestId: input.guestId, targetType: input.targetType, targetId: input.targetId, bookingId: input.bookingId ?? null,
      method: 'upi_manual', status: 'awaiting_payment', amount: input.amount, currency: input.tenant.currency, reference: ref,
      expiresAt: new Date(now + input.settings.manualPayWindowMinutes * 60_000), metadata: { description: input.description },
    }).returning();
    return { payment: p!, instructions: await instructionsFor(input.settings, p!) };
  }
  const gw = GATEWAYS[input.settings.gatewayProvider!];
  const order = await gw.createOrder(gatewayCreds(input.settings), {
    amount: input.amount, currency: input.tenant.currency, receipt: ref, notes: { tenant: input.tenant.slug, reference: ref, target: `${input.targetType}:${input.targetId}` },
  });
  const [p] = await tx.insert(payments).values({
    tenantId: input.tenant.id, guestId: input.guestId, targetType: input.targetType, targetId: input.targetId, bookingId: input.bookingId ?? null,
    method: 'upi_gateway', provider: gw.name, status: 'awaiting_payment', amount: input.amount, currency: input.tenant.currency, reference: ref,
    providerOrderId: order.orderId, expiresAt: new Date(now + 30 * 60_000), metadata: { description: input.description, checkout: order.checkout },
  }).returning();
  return { payment: p!, instructions: await instructionsFor(input.settings, p!) };
}

/** Guests submit the UPI transaction reference (UTR) after paying the tenant's UPI ID. */
export async function submitUtr(
  tx: Tx,
  input: { tenant: TenantInfo; paymentId: string; guestId: string | null; utr: string; proofFileId?: string | null; payerVpa?: string | null },
) {
  const utr = input.utr.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{10,22}$/.test(utr)) throw badRequest('Enter the 12-digit UPI reference (UTR) shown in your UPI app');
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, input.tenant.id))).for('update');
  if (!p || (input.guestId && p.guestId !== input.guestId)) throw notFound('Payment');
  if (p.method !== 'upi_manual') throw badRequest('This payment is not a manual UPI payment');
  if (!['awaiting_payment', 'rejected'].includes(p.status)) throw conflict(`This payment is already ${p.status.replace('_', ' ')}`);
  if (p.expiresAt && p.expiresAt < new Date()) throw new AppError(410, 'expired', 'This payment window has closed');
  const settings = await getSettings(tx, input.tenant.id);
  if (settings.requireProofUpload && !input.proofFileId) throw badRequest('Please attach a screenshot of the payment');
  const dup = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.tenantId, input.tenant.id), eq(sql`upper(${payments.utr})`, utr), sql`${payments.status} <> 'rejected'`, sql`${payments.id} <> ${p.id}`));
  if (dup.length) throw conflict('This UTR has already been used for another payment');
  const [updated] = await tx
    .update(payments)
    .set({
      utr, proofFileId: input.proofFileId ?? null, payerVpa: input.payerVpa ?? null, status: 'pending_verification', submittedAt: new Date(),
      rejectionReason: null, expiresAt: new Date(Date.now() + settings.verificationWindowHours * 3_600_000),
    })
    .where(eq(payments.id, p.id))
    .returning();
  await targetHandler(p.targetType)?.onSubmitted?.(tx, updated!);
  await notifyVerifiers(tx, input.tenant, updated!);
  return updated!;
}

async function notifyVerifiers(tx: Tx, tenant: TenantInfo, p: Payment) {
  const verifiers = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.tenantId, tenant.id), eq(users.status, 'active'), or(eq(rolePermissions.permissionKey, 'payments.verify'), sql`exists (select 1 from roles r where r.id = ${outer(userRoles.roleId)} and r.key = 'owner')`)));
  for (const v of verifiers) {
    await notify(tx, {
      tenantId: tenant.id, recipient: { type: 'user', id: v.id }, templateKey: 'staff.payment_to_verify', channels: ['in_app'],
      vars: { reference: p.reference, utr: p.utr, amount: formatMoney(p.amount, p.currency), guest: 'A guest' }, related: { type: 'payment', id: p.id },
    });
  }
}

export async function capture(tx: Tx, p: Payment, patch: Partial<Payment> = {}) {
  if (p.status === 'captured') return p;
  const [updated] = await tx.update(payments).set({ ...patch, status: 'captured' }).where(eq(payments.id, p.id)).returning();
  await targetHandler(p.targetType)?.onCaptured(tx, updated!);
  return updated!;
}

/** Staff decision on a manual UPI payment after checking their bank/UPI app statement. */
export async function verifyManual(
  tx: Tx,
  input: { tenant: TenantInfo; paymentId: string; userId: string; approve: boolean; reason?: string },
) {
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, input.tenant.id))).for('update');
  if (!p) throw notFound('Payment');
  if (p.method !== 'upi_manual') throw badRequest('Only manual UPI payments are verified by staff');
  if (p.status !== 'pending_verification') throw conflict(`Payment is ${p.status.replace('_', ' ')}, not awaiting verification`);
  if (input.approve) return capture(tx, p, { verifiedByUserId: input.userId, verifiedAt: new Date() });
  if (!input.reason?.trim()) throw badRequest('Tell the guest why the payment could not be verified');
  const [rejected] = await tx
    .update(payments)
    .set({ status: 'rejected', rejectionReason: input.reason.trim(), verifiedByUserId: input.userId, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 2 * 3_600_000) })
    .where(eq(payments.id, p.id))
    .returning();
  await targetHandler(p.targetType)?.onRejected?.(tx, rejected!);
  return rejected!;
}

/** Apply a verified gateway event. Idempotent: repeated webhooks for the same payment are no-ops. */
export async function applyGatewayEvent(tx: Tx, tenantId: string, ev: GatewayEvent) {
  const [p] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.providerOrderId, ev.orderId))).for('update');
  if (!p) return null;
  if (ev.status === 'captured') {
    if (ev.amount != null && ev.amount !== p.amount) {
      await tx.update(payments).set({ metadata: { ...p.metadata, amountMismatch: ev.amount } }).where(eq(payments.id, p.id));
      return p; // never auto-confirm a mismatched amount; staff will see it flagged
    }
    return capture(tx, p, { providerPaymentId: ev.paymentId, payerVpa: ev.payerVpa ?? null });
  }
  if (ev.status === 'failed' && p.status === 'awaiting_payment') {
    await tx.update(payments).set({ metadata: { ...p.metadata, lastFailure: ev.paymentId } }).where(eq(payments.id, p.id));
  }
  return p;
}

export async function refundPayment(
  tx: Tx,
  input: { tenant: TenantInfo; paymentId: string; amount: number; reason?: string; note?: string; userId: string | null },
) {
  const [p] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, input.tenant.id))).for('update');
  if (!p) throw notFound('Payment');
  if (!['captured', 'partially_refunded'].includes(p.status)) throw conflict('Only captured payments can be refunded');
  const remaining = p.amount - p.refundedAmount;
  if (input.amount <= 0 || input.amount > remaining) throw badRequest(`Refund must be between 1 and ${remaining}`);
  let status: 'processed' | 'recorded' = 'recorded';
  let providerRefundId: string | null = null;
  if (p.method === 'upi_gateway' && p.provider && p.providerPaymentId) {
    const settings = await getSettings(tx, input.tenant.id);
    const r = await GATEWAYS[p.provider].refund(gatewayCreds(settings), { paymentId: p.providerPaymentId, amount: input.amount });
    providerRefundId = r.refundId;
    status = 'processed';
  }
  // Manual UPI refunds are paid back by the property outside the platform and recorded here.
  const [refund] = await tx
    .insert(refunds)
    .values({ tenantId: input.tenant.id, paymentId: p.id, amount: input.amount, reason: input.reason, note: input.note, status, providerRefundId, createdByUserId: input.userId })
    .returning();
  const refunded = p.refundedAmount + input.amount;
  const [updated] = await tx
    .update(payments)
    .set({ refundedAmount: refunded, status: refunded >= p.amount ? 'refunded' : 'partially_refunded' })
    .where(eq(payments.id, p.id))
    .returning();
  await targetHandler(p.targetType)?.onRefunded?.(tx, updated!, input.amount);
  return refund!;
}

export async function paymentsForTarget(tx: Tx, targetType: Payment['targetType'], targetIds: string[]) {
  if (!targetIds.length) return [];
  return tx.select().from(payments).where(and(eq(payments.targetType, targetType), inArray(payments.targetId, targetIds)));
}
