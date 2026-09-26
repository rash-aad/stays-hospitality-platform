import { platformInvoices, platformPayments, properties, reportRuns, roles, tenantSubscriptions, tenants, userRoles, users, type BillTo } from '@hp/db';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { asSystem, type Tx } from '../../infra/db.js';
import { formatDate, todayIn } from '../../lib/dates.js';
import { formatMoney } from '../../lib/money.js';
import { purgeSite } from '../../lib/purge.js';
import { runtimeConfig } from '../../runtime.js';
import { financialYear, STATE_NAMES } from '../billing/gst.js';
import { notify } from '../notifications/notify.js';
import { invalidateTenant } from '../tenants/tenant-cache.js';
import { addDaysISO, coveredUntil, daysBetween, gstFor, nextPeriodStart, periodEnd, priceOptions, subscriptionState, type Cycle } from './model.js';
import { platformBilling, type PlatformBilling } from './settings.js';

type Sub = typeof tenantSubscriptions.$inferSelect;
type Invoice = typeof platformInvoices.$inferSelect;

export const UTR_RE = /^\d{12}$/;

/** Create the subscription row for a new property: a free trial counted from onboarding. */
export async function createSubscription(tx: Tx, tenantId: string, opts: { freeDays?: number; monthlyFee?: number | null; yearlyFee?: number | null; today?: string } = {}) {
  const s = await platformBilling(tx);
  const today = opts.today ?? todayIn('Asia/Kolkata');
  await tx.insert(tenantSubscriptions).values({
    tenantId, status: 'trial', startedAt: today, trialEndsAt: addDaysISO(today, opts.freeDays ?? s.trialDays),
    monthlyFee: opts.monthlyFee ?? null, yearlyFee: opts.yearlyFee ?? null,
  }).onConflictDoNothing();
}

export async function loadSub(tx: Tx, tenantId: string) {
  const [sub] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
  if (sub) return sub;
  await createSubscription(tx, tenantId);
  return (await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)))[0]!;
}

export const graceOf = (sub: Sub, s: PlatformBilling) => sub.graceDays ?? s.graceDays;

const STATE_CODE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

/** The property's GST state: from its GSTIN if given, else from the property's region. */
async function recipientState(tx: Tx, tenantId: string, billTo: BillTo | null) {
  if (billTo?.gstin) return billTo.gstin.slice(0, 2);
  const [p] = await tx.select({ region: properties.region }).from(properties).where(eq(properties.tenantId, tenantId)).limit(1);
  return p?.region ? (STATE_CODE_BY_NAME[p.region.trim().toLowerCase()] ?? null) : null;
}

async function defaultBillTo(tx: Tx, tenantId: string, saved: BillTo | null): Promise<BillTo> {
  if (saved?.name) return saved;
  const [t] = await tx.select({ name: tenants.name, email: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
  const [p] = await tx.select().from(properties).where(eq(properties.tenantId, tenantId)).limit(1);
  const stateCode = p?.region ? (STATE_CODE_BY_NAME[p.region.trim().toLowerCase()] ?? null) : null;
  return { name: t!.name, address: p ? [p.addressLine, p.city, p.region, p.postalCode].filter(Boolean).join(', ') : null, stateCode, email: t!.email };
}

export async function ownerIds(tx: Tx, tenantId: string) {
  const rows = await tx.select({ id: users.id }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.tenantId, tenantId), eq(roles.key, 'owner'), eq(users.status, 'active')));
  return rows.map((r) => r.id);
}

async function tellOwners(tx: Tx, tenantId: string, subject: string, message: string) {
  const link = `${runtimeConfig().WEB_PUBLIC_URL}/admin/settings/subscription`;
  for (const id of await ownerIds(tx, tenantId)) {
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, id));
    await notify(tx, { tenantId, recipient: { type: 'user', id }, templateKey: 'subscription.notice', channels: ['email', 'in_app'], vars: { name: u!.name.split(' ')[0], subject, message, link } });
  }
}

async function tellPlatform(tx: Tx, tenantId: string, subject: string, message: string) {
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.isPlatformAdmin, true), isNull(users.tenantId), eq(users.status, 'active')));
  const link = `${runtimeConfig().CONSOLE_PUBLIC_URL}/platform/payments`;
  for (const a of admins) await notify(tx, { tenantId, recipient: { type: 'user', id: a.id }, templateKey: 'platform.payment_review', channels: ['email'], vars: { subject, message, link } });
}

/** Everything the tenant's Subscription page shows. Must run with RLS bypassed or tenant-scoped. */
export async function subscriptionOverview(tx: Tx, tenantId: string, tenantStatus: string) {
  const s = await platformBilling(tx);
  const sub = await loadSub(tx, tenantId);
  const today = todayIn('Asia/Kolkata');
  const invoices = await tx.select().from(platformInvoices).where(eq(platformInvoices.tenantId, tenantId)).orderBy(desc(platformInvoices.issuedAt));
  const payments = await tx.select().from(platformPayments).where(eq(platformPayments.tenantId, tenantId)).orderBy(desc(platformPayments.submittedAt));
  const pending = payments.find((p) => p.status === 'pending_verification') ?? null;
  const open = invoices.find((i) => i.status === 'open' || i.status === 'pending_verification') ?? null;
  const st = subscriptionState(sub, today, graceOf(sub, s), tenantStatus === 'suspended');
  const lastRejected = !pending && open ? payments.find((p) => p.invoiceId === open.id && p.status === 'rejected') ?? null : null;
  return {
    ...st, status: sub.status, trialEndsAt: sub.trialEndsAt, paidUntil: sub.paidUntil, cycle: sub.cycle, pendingVerification: !!pending,
    options: priceOptions(sub, s.gstRateBps), gstRateBps: s.gstRateBps, verifyPromise: s.verifyPromise, billTo: sub.billTo,
    nextPeriodStart: nextPeriodStart(sub, today, graceOf(sub, s)),
    openInvoice: open ? { ...open, pay: open.status === 'open' ? await payInstructions(s, open) : null, rejection: lastRejected?.rejectionReason ?? null } : null,
    invoices: invoices.filter((i) => i.status !== 'void').map(({ supplier: _s, billTo: _b, ...i }) => i),
    payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, utr: p.utr, status: p.status, submittedAt: p.submittedAt, reviewedAt: p.reviewedAt, rejectionReason: p.rejectionReason })),
  };
}

async function payInstructions(s: PlatformBilling, inv: Invoice) {
  if (!s.vpa) return null;
  const uri = `upi://pay?pa=${encodeURIComponent(s.vpa)}&pn=${encodeURIComponent(s.payeeName)}&am=${(inv.total / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.number)}`;
  return { vpa: s.vpa, payeeName: s.payeeName, amount: inv.total, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
}

/**
 * Issue (or return) the invoice for the next period. One open invoice at a time: an open invoice for the
 * other cycle is voided (its number stays in the series); a payment under review blocks a new one.
 */
export async function issueInvoice(tx: Tx, tenantId: string, cycle: Cycle) {
  const s = await platformBilling(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sub:${tenantId}`}))`);
  const sub = await loadSub(tx, tenantId);
  if (sub.status === 'comp') throw conflict('This property is on a complimentary plan — nothing to pay');
  if (sub.status === 'cancelled') throw conflict('This subscription was cancelled — contact bookEZ');
  const fee = cycle === 'monthly' ? sub.monthlyFee : sub.yearlyFee;
  if (!fee) throw badRequest(`A ${cycle} plan isn’t offered for this property`);
  const current = await tx.select().from(platformInvoices).where(and(eq(platformInvoices.tenantId, tenantId), inArray(platformInvoices.status, ['open', 'pending_verification'])));
  if (current.some((i) => i.status === 'pending_verification')) throw conflict('A payment is being verified — we’ll confirm it shortly');
  const same = current.find((i) => i.cycle === cycle);
  if (same) return same;
  for (const i of current) await tx.update(platformInvoices).set({ status: 'void', voidedAt: new Date() }).where(eq(platformInvoices.id, i.id));

  const today = todayIn('Asia/Kolkata');
  const start = nextPeriodStart(sub, today, graceOf(sub, s));
  const billTo = await defaultBillTo(tx, tenantId, sub.billTo);
  const g = gstFor(fee, s.gstRateBps, s.stateCode, await recipientState(tx, tenantId, sub.billTo));
  // Gap-free numbering per financial year: serialised, counted including void invoices.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform-invoice-number'))`);
  const fy = financialYear(new Date());
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(platformInvoices).where(eq(platformInvoices.financialYear, fy))) as [{ n: number }];
  const [inv] = await tx.insert(platformInvoices).values({
    tenantId, number: `${s.invoicePrefix}/${fy}/${String(n + 1).padStart(5, '0')}`, financialYear: fy, cycle, periodStart: start, periodEnd: periodEnd(start, cycle),
    amount: fee, cgst: g.cgst, sgst: g.sgst, igst: g.igst, total: g.total, gstRateBps: s.gstRateBps, sac: s.sac,
    supplier: { legalName: s.legalName, tradeName: 'bookEZ', gstin: s.gstin, address: s.address, stateCode: s.stateCode, stateName: s.stateCode ? (STATE_NAMES[s.stateCode] ?? null) : null, phone: null, email: s.email },
    billTo,
  }).returning();
  return inv!;
}

export async function voidOpenInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  const [inv] = await tx.update(platformInvoices).set({ status: 'void', voidedAt: new Date() }).where(and(eq(platformInvoices.id, invoiceId), eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.status, 'open'))).returning();
  if (!inv) throw conflict('Only an unpaid invoice that isn’t being verified can be cancelled');
  return inv;
}

/** The tenant reports a UPI payment for an open invoice. */
export async function submitPayment(tx: Tx, tenantId: string, invoiceId: string, input: { utr: string; proofFileId?: string | null; userId: string }) {
  const utr = input.utr.trim();
  if (!UTR_RE.test(utr)) throw badRequest('Enter the 12-digit UPI reference (UTR) from your payment app');
  const [inv] = await tx.select().from(platformInvoices).where(and(eq(platformInvoices.id, invoiceId), eq(platformInvoices.tenantId, tenantId))).for('update');
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'open') throw conflict(inv.status === 'pending_verification' ? 'We’re already verifying a payment for this invoice' : 'This invoice isn’t open for payment');
  const [dup] = await tx.execute<{ id: string }>(sql`select id from platform_payments where upper(utr) = upper(${utr}) and status <> 'rejected' limit 1`);
  if (dup) throw conflict('This UPI reference has already been submitted');
  const [p] = await tx.insert(platformPayments).values({ tenantId, invoiceId: inv.id, amount: inv.total, utr, proofFileId: input.proofFileId ?? null, submittedByUserId: input.userId }).returning();
  await tx.update(platformInvoices).set({ status: 'pending_verification' }).where(eq(platformInvoices.id, inv.id));
  const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  await tellPlatform(tx, tenantId, `Payment to verify — ${t!.name} ${formatMoney(inv.total, 'INR')}`, `${t!.name} says they paid ${formatMoney(inv.total, 'INR')} for invoice ${inv.number} (${inv.cycle}). UTR ${utr}. Please verify within 12 hours.`);
  return p!;
}

/** Approve: invoice paid, cover extended by one period from the current end, tenant reactivated if billing had suspended it. */
export async function approvePayment(tx: Tx, paymentId: string, adminId: string) {
  const [p] = await tx.select().from(platformPayments).where(eq(platformPayments.id, paymentId)).for('update');
  if (!p) throw notFound('Payment');
  if (p.status !== 'pending_verification') throw conflict('This payment was already reviewed');
  const [inv] = await tx.select().from(platformInvoices).where(eq(platformInvoices.id, p.invoiceId)).for('update');
  const sub = await loadSub(tx, p.tenantId);
  const s = await platformBilling(tx);
  const today = todayIn('Asia/Kolkata');
  // One period from the current end — or from the later invoice start (e.g. after a goodwill extension).
  // If cover had lapsed past the grace period, the period starts today: no charge for days offline.
  const cover = coveredUntil(sub);
  const afterCover = addDaysISO(cover, 1);
  const start = daysBetween(cover, today) > graceOf(sub, s) ? today : inv!.periodStart > afterCover ? inv!.periodStart : afterCover;
  const paidUntil = periodEnd(start, inv!.cycle);
  await tx.update(platformPayments).set({ status: 'verified', reviewedAt: new Date(), reviewedByUserId: adminId }).where(eq(platformPayments.id, p.id));
  await tx.update(platformInvoices).set({ status: 'paid', paidAt: new Date() }).where(eq(platformInvoices.id, inv!.id));
  await tx.update(tenantSubscriptions).set({ status: 'active', paidUntil, cycle: inv!.cycle, suspendedReason: null }).where(eq(tenantSubscriptions.tenantId, p.tenantId));
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, p.tenantId));
  const reactivated = t!.status === 'suspended' && sub.suspendedReason === 'non_payment';
  if (reactivated) await tx.update(tenants).set({ status: 'active' }).where(eq(tenants.id, p.tenantId));
  await tellOwners(tx, p.tenantId, 'Payment confirmed — thank you', `We've received ${formatMoney(p.amount, 'INR')} for invoice ${inv!.number}. Your bookEZ subscription is active until ${formatDate(paidUntil)}.${reactivated ? ' Your workspace and website are back online.' : ''} Your GST invoice is on the Subscription page.`);
  return { paidUntil, reactivated, tenantId: p.tenantId };
}

export async function rejectPayment(tx: Tx, paymentId: string, adminId: string, reason: string) {
  const [p] = await tx.select().from(platformPayments).where(eq(platformPayments.id, paymentId)).for('update');
  if (!p) throw notFound('Payment');
  if (p.status !== 'pending_verification') throw conflict('This payment was already reviewed');
  await tx.update(platformPayments).set({ status: 'rejected', reviewedAt: new Date(), reviewedByUserId: adminId, rejectionReason: reason }).where(eq(platformPayments.id, p.id));
  await tx.update(platformInvoices).set({ status: 'open' }).where(eq(platformInvoices.id, p.invoiceId));
  await tellOwners(tx, p.tenantId, 'We couldn’t confirm your payment', `We couldn't match UPI reference ${p.utr}: ${reason}. Please check it and submit again on the Subscription page.`);
  return p;
}

async function suspendForNonPayment(tx: Tx, tenantId: string) {
  await tx.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId));
  await tx.update(tenantSubscriptions).set({ suspendedReason: 'non_payment' }).where(eq(tenantSubscriptions.tenantId, tenantId));
}

async function once(tx: Tx, tenantId: string, kind: string, date: string) {
  const [r] = await tx.insert(reportRuns).values({ tenantId, kind, date }).onConflictDoNothing().returning();
  return !!r;
}

/**
 * Hourly: reminders (7 and 1 days before the end, on the due date, every 2 days while overdue), suspension
 * after cover + grace with no verified payment (never while a payment is under review), and a nudge to the
 * platform admins for payments waiting over 12 hours. Idempotent.
 */
export async function subscriptionSweep(now = new Date()) {
  const today = todayIn('Asia/Kolkata', now);
  const out = { reminders: 0, suspended: 0, stale: 0 };
  const touched: string[] = [];
  await asSystem(async (tx) => {
    const s = await platformBilling(tx);
    const rows = await tx.select({ sub: tenantSubscriptions, tenantStatus: tenants.status, name: tenants.name }).from(tenantSubscriptions).innerJoin(tenants, eq(tenants.id, tenantSubscriptions.tenantId))
      .where(inArray(tenantSubscriptions.status, ['trial', 'active']));
    for (const { sub, tenantStatus } of rows) {
      const grace = graceOf(sub, s);
      const st = subscriptionState(sub, today, grace, tenantStatus === 'suspended');
      const [pending] = await tx.select({ id: platformPayments.id }).from(platformPayments).where(and(eq(platformPayments.tenantId, sub.tenantId), eq(platformPayments.status, 'pending_verification'))).limit(1);
      if (pending || tenantStatus === 'suspended') continue;
      const trial = !sub.paidUntil;
      const end = formatDate(st.coveredUntil);
      const note = async (kind: string, date: string, subject: string, message: string) => { if (await once(tx, sub.tenantId, kind, date)) { await tellOwners(tx, sub.tenantId, subject, message); out.reminders++; } };
      if (st.daysLeft === 7) await note('sub_t7', st.coveredUntil, trial ? 'Your free trial ends in 7 days' : 'Your subscription renews in 7 days', `${trial ? 'Your bookEZ free trial' : 'Your bookEZ subscription'} runs until ${end}. Renew any time from the Subscription page — paying early never loses days.`);
      if (st.daysLeft === 1) await note('sub_t1', st.coveredUntil, trial ? 'Your free trial ends tomorrow' : 'Your subscription ends tomorrow', `Your cover ends on ${end}. Pay by UPI on the Subscription page to keep everything running.`);
      if (st.daysLeft === 0) await note('sub_t0', st.coveredUntil, 'Your bookEZ payment is due today', `Your cover ends today (${end}). Pay by UPI on the Subscription page.`);
      if (st.daysLeft < 0 && st.graceLeft >= 0 && (-st.daysLeft) % 2 === 0) await note('sub_overdue', today, 'Your bookEZ payment is overdue', `Your cover ended on ${end}. Your workspace and website will be suspended in ${st.graceLeft} day${st.graceLeft === 1 ? '' : 's'} unless payment is received.`);
      // Suspend only when there's a price to pay (a tenant without pricing can't be overdue).
      if (st.state === 'lapsed' && (sub.monthlyFee || sub.yearlyFee)) {
        await suspendForNonPayment(tx, sub.tenantId);
        touched.push(sub.tenantId);
        out.suspended++;
        await tellOwners(tx, sub.tenantId, 'Your bookEZ workspace is suspended', `We haven't received payment for the period after ${end}, so your website and admin are paused. Pay on the Subscription page — everything comes back as soon as the payment is verified.`);
      }
    }
    const stale = await tx.select().from(platformPayments).where(and(eq(platformPayments.status, 'pending_verification'), isNull(platformPayments.staleNotifiedAt), lt(platformPayments.submittedAt, new Date(now.getTime() - 12 * 3600_000))));
    for (const p of stale) {
      const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, p.tenantId));
      await tellPlatform(tx, p.tenantId, `Still waiting over 12 hours — ${t!.name}`, `The payment from ${t!.name} (UTR ${p.utr}, ${formatMoney(p.amount, 'INR')}) has waited more than 12 hours for verification.`);
      await tx.update(platformPayments).set({ staleNotifiedAt: new Date() }).where(eq(platformPayments.id, p.id));
      out.stale++;
    }
  });
  for (const id of touched) { await invalidateTenant(id); purgeSite(id); }
  return out;
}

/** Tax-invoice view (same shape the hotel invoices use), IGST included. */
export function presentInvoice(inv: Invoice) {
  const tax = inv.cgst + inv.sgst + inv.igst;
  const cycle = inv.cycle === 'monthly' ? 'Monthly' : 'Yearly';
  return {
    id: inv.id, number: inv.number, status: inv.status === 'paid' ? 'paid' : 'issued', currency: 'INR', subtotal: inv.amount, taxTotal: tax, total: inv.total,
    amountPaid: inv.status === 'paid' ? inv.total : 0, issuedAt: inv.issuedAt.toISOString(), createdAt: inv.issuedAt.toISOString(),
    lines: [{ description: `bookEZ subscription — ${cycle} (${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)})`, quantity: 1, amount: inv.amount, taxAmount: tax, sac: inv.sac, rateBps: inv.gstRateBps }],
    supplier: inv.supplier, billTo: inv.billTo,
    taxSummary: [{ rateBps: inv.gstRateBps, taxable: inv.amount, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst }],
    booking: null, footerNote: inv.status === 'paid' ? `Paid by UPI. Thank you for choosing bookEZ.` : 'Pay by UPI from the Subscription page in your bookEZ admin.',
  };
}

