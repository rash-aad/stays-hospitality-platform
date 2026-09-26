import { auditLogs, platformPayments, tenantSubscriptions, tenants } from '@hp/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, beforeAll } from 'vitest';
import { addMonthsISO, gstFor, nextPeriodStart, periodEnd, priceOptions, subscriptionState } from '../src/domain/subscriptions/model.js';
import { subscriptionSweep } from '../src/domain/subscriptions/service.js';
import { invalidateTenant } from '../src/domain/tenants/tenant-cache.js';
import { asSystem } from '../src/infra/db.js';
import { app, createTenant, isoDate, platformAdmin, useApp, type TestTenant } from './helpers.js';

describe('subscription maths (pure)', () => {
  it('computes month and year periods with month-end clamping', () => {
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
    expect(periodEnd('2026-10-15', 'monthly')).toBe('2026-11-14');
    expect(periodEnd('2026-10-15', 'yearly')).toBe('2027-10-14');
    expect(periodEnd('2028-02-29', 'yearly')).toBe('2029-02-27');
  });
  it('starts the next period after current cover, or today if cover lapsed past grace', () => {
    const s = { status: 'active' as const, trialEndsAt: '2026-10-01', paidUntil: '2026-12-31', suspendedReason: null };
    expect(nextPeriodStart(s, '2026-11-20', 7)).toBe('2027-01-01'); // early renewal keeps every day
    expect(nextPeriodStart(s, '2027-01-05', 7)).toBe('2027-01-01'); // inside grace
    expect(nextPeriodStart(s, '2027-01-20', 7)).toBe('2027-01-20'); // lapsed: no charge for days offline
  });
  it('derives trial / active / due / overdue / lapsed', () => {
    const trial = { status: 'trial' as const, trialEndsAt: '2026-10-30', paidUntil: null, suspendedReason: null };
    expect(subscriptionState(trial, '2026-10-01', 7, false)).toMatchObject({ state: 'trial', daysLeft: 29 });
    expect(subscriptionState(trial, '2026-11-03', 7, false)).toMatchObject({ state: 'overdue', graceLeft: 3 });
    expect(subscriptionState(trial, '2026-11-08', 7, false).state).toBe('lapsed');
    const paid = { ...trial, status: 'active' as const, paidUntil: '2026-12-31' };
    expect(subscriptionState(paid, '2026-12-01', 7, false).state).toBe('active');
    expect(subscriptionState(paid, '2026-12-28', 7, false).state).toBe('due');
  });
  it('splits GST into CGST+SGST in-state and IGST across states; yearly saving', () => {
    expect(gstFor(299900, 1800, '29', '29')).toEqual({ cgst: 26991, sgst: 26991, igst: 0, tax: 53982, total: 353882 });
    expect(gstFor(299900, 1800, '29', '32')).toEqual({ cgst: 0, sgst: 0, igst: 53982, tax: 53982, total: 353882 });
    expect(priceOptions({ monthlyFee: 299900, yearlyFee: 2999000 }, 1800)[1]).toMatchObject({ cycle: 'yearly', total: 3538820, saving: 599800 });
  });
});

useApp();

let pa: Awaited<ReturnType<typeof platformAdmin>>;
beforeAll(async () => {
  pa = await platformAdmin();
  const r = await app.inject({ method: 'PUT', url: '/api/v1/platform/billing-settings', headers: pa.auth, payload: {
    vpa: 'bookez@okhdfcbank', payeeName: 'bookEZ', legalName: 'bookEZ Technologies Pvt Ltd', gstin: '29AAPFU0939F1ZR', address: 'Bengaluru, Karnataka', stateCode: null,
    invoicePrefix: 'BKZ', gstRateBps: 1800, sac: '998315', verifyPromise: 'We confirm payments within 12 hours.', graceDays: 7, trialDays: 30, email: null,
  } });
  if (r.statusCode !== 200) throw new Error(r.body);
});

const price = (t: TestTenant, body: Partial<{ freeDays: number; monthlyFee: number | null; yearlyFee: number | null; graceDays: number | null }>) =>
  app.inject({ method: 'PUT', url: `/api/v1/platform/tenants/${t.tenant.id}/subscription`, headers: pa.auth, payload: { freeDays: 30, monthlyFee: 299900, yearlyFee: 2999000, graceDays: null, ...body } });
const overview = async (t: TestTenant) => (await app.inject({ method: 'GET', url: '/api/v1/admin/subscription', headers: t.auth })).json().data;
const invoice = (t: TestTenant, cycle: 'monthly' | 'yearly') => app.inject({ method: 'POST', url: '/api/v1/admin/subscription/invoice', headers: t.auth, payload: { cycle } });
const pay = (t: TestTenant, id: string, utr: string) => app.inject({ method: 'POST', url: `/api/v1/admin/subscription/invoice/${id}/payment`, headers: t.auth, payload: { utr } });
let utrSeq = 100000000000 + Math.floor(Math.random() * 1e9);
const utr = () => String(++utrSeq);
async function queueItem(tenantId: string) {
  const q = (await app.inject({ method: 'GET', url: '/api/v1/platform/payments', headers: pa.auth })).json().data;
  return q.find((p: { tenantId: string }) => p.tenantId === tenantId);
}
const setDates = (t: TestTenant, patch: Partial<typeof tenantSubscriptions.$inferInsert>) => asSystem((tx) => tx.update(tenantSubscriptions).set(patch).where(eq(tenantSubscriptions.tenantId, t.tenant.id)));

describe('tenant subscriptions', () => {
  it('uses per-tenant fees and free days; early yearly renewal extends from the trial end, not today', async () => {
    const t = await createTenant();
    expect((await price(t, { freeDays: 45 })).statusCode).toBe(200);
    const o = await overview(t);
    expect(o).toMatchObject({ state: 'trial', trialEndsAt: isoDate(45) });
    expect(o.options.map((x: { cycle: string; total: number }) => [x.cycle, x.total])).toEqual([['monthly', 353882], ['yearly', 3538820]]);

    const inv = (await invoice(t, 'yearly')).json().data;
    expect(inv).toMatchObject({ cycle: 'yearly', periodStart: isoDate(46), amount: 2999000, total: 3538820 });
    expect(inv.number).toMatch(/^BKZ\/\d{4}-\d{2}\/\d{5}$/);
    const withQr = await overview(t);
    expect(withQr.openInvoice.pay.uri).toContain(`am=35388.20`);
    expect(withQr.openInvoice.pay.uri).toContain(`tn=${encodeURIComponent(inv.number)}`);
    expect(withQr.openInvoice.pay.qr).toMatch(/^data:image\/png/);

    expect((await pay(t, inv.id, '12345')).statusCode).toBe(400);
    const u = utr();
    expect((await pay(t, inv.id, u)).statusCode).toBe(201);
    expect((await overview(t)).pendingVerification).toBe(true);
    expect((await invoice(t, 'monthly')).statusCode).toBe(409); // one open/pending invoice at a time
    const item = await queueItem(t.tenant.id);
    expect(item).toMatchObject({ utr: u, amount: 3538820, invoiceNumber: inv.number, overdue: false });
    expect((await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${item.id}/approve`, headers: pa.auth })).json().data.paidUntil).toBe(periodEnd(isoDate(46), 'yearly'));
    const after = await overview(t);
    expect(after).toMatchObject({ state: 'active', paidUntil: periodEnd(isoDate(46), 'yearly'), pendingVerification: false });
    const doc = (await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/invoices/${inv.id}`, headers: t.auth })).json().data;
    expect(doc).toMatchObject({ number: inv.number, total: 3538820, amountPaid: 3538820 });
  });

  it('charges IGST for another state and CGST+SGST for the same state; numbers invoices in sequence; voiding keeps the series', async () => {
    const a = await createTenant();
    await price(a, {});
    const inv1 = (await invoice(a, 'monthly')).json().data; // no GSTIN/region → treated as inter-state
    expect(inv1).toMatchObject({ igst: 53982, cgst: 0, sgst: 0 });
    await app.inject({ method: 'PUT', url: '/api/v1/admin/subscription/bill-to', headers: a.auth, payload: { name: 'Acme Hotels Pvt Ltd', gstin: '29AAPFU0939F1ZR' } });
    // Switching cycle voids the open invoice (number kept) and issues the next number.
    const inv2 = (await invoice(a, 'yearly')).json().data;
    expect(Number(inv2.number.split('/')[2])).toBe(Number(inv1.number.split('/')[2]) + 1);
    expect(inv2).toMatchObject({ cgst: 269910, sgst: 269910, igst: 0 });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/subscription/bill-to', headers: a.auth, payload: { name: 'X Co', gstin: '29AAPFU0939F1ZX' } })).statusCode).toBe(400);
  });

  it('refuses a UTR already claimed anywhere on the platform, unless that claim was rejected', async () => {
    const a = await createTenant(); const b = await createTenant();
    await price(a, {}); await price(b, {});
    const ia = (await invoice(a, 'monthly')).json().data;
    const ib = (await invoice(b, 'monthly')).json().data;
    const u = utr();
    expect((await pay(a, ia.id, u)).statusCode).toBe(201);
    expect((await pay(b, ib.id, u)).statusCode).toBe(409);
    const item = await queueItem(a.tenant.id);
    expect((await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${item.id}/reject`, headers: pa.auth, payload: { reason: 'No such credit in our bank statement' } })).statusCode).toBe(200);
    const oa = await overview(a);
    expect(oa.openInvoice).toMatchObject({ status: 'open', rejection: 'No such credit in our bank statement' });
    expect((await pay(b, ib.id, u)).statusCode).toBe(201); // freed by the rejection
    expect((await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${item.id}/approve`, headers: pa.auth })).statusCode).toBe(409);
  });

  it('applies a price change from the next invoice only', async () => {
    const t = await createTenant();
    await price(t, { monthlyFee: 299900 });
    const inv = (await invoice(t, 'monthly')).json().data;
    await price(t, { monthlyFee: 399900 });
    expect((await invoice(t, 'monthly')).json().data).toMatchObject({ id: inv.id, amount: 299900 }); // issued invoice unchanged
    await pay(t, inv.id, utr());
    await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${(await queueItem(t.tenant.id)).id}/approve`, headers: pa.auth });
    const next = (await invoice(t, 'monthly')).json().data;
    expect(next).toMatchObject({ amount: 399900, periodStart: periodEnd(inv.periodStart, 'monthly') > '' ? next.periodStart : '' });
    expect(next.periodStart).toBe(new Date(Date.parse(`${periodEnd(inv.periodStart, 'monthly')}T00:00:00Z`) + 86400000).toISOString().slice(0, 10));
  });

  it('suspends after cover + grace (never while a payment is under review), locks the admin to the Subscription page, and reactivates on approval', async () => {
    const t = await createTenant();
    await price(t, {});
    // Trial ended 10 days ago; grace 7 → lapsed.
    await setDates(t, { startedAt: isoDate(-40), trialEndsAt: isoDate(-10) });
    const inv = (await invoice(t, 'monthly')).json().data;
    expect(inv.periodStart).toBe(isoDate(0)); // lapsed → starts today, no charge for days offline
    await pay(t, inv.id, utr());
    await subscriptionSweep();
    const [still] = await asSystem((tx) => tx.select().from(tenants).where(eq(tenants.id, t.tenant.id)));
    expect(still!.status).toBe('active'); // under review → no suspension

    // Reject → nothing pending → suspended by the next sweep.
    const item = await queueItem(t.tenant.id);
    await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${item.id}/reject`, headers: pa.auth, payload: { reason: 'Amount did not match' } });
    const r = await subscriptionSweep();
    expect(r.suspended).toBeGreaterThanOrEqual(1);
    await invalidateTenant(t.tenant.id);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/site', headers: t.host })).statusCode).toBe(404);
    const blocked = await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: t.auth });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().error.code).toBe('subscription_suspended');
    const o = await overview(t);
    expect(o.state).toBe('suspended');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: t.ownerEmail, password: t.password } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: t.auth })).json().tenant.billingLocked).toBe(true);

    // Pay again → approve → back online straight away.
    await pay(t, inv.id, utr());
    const again = await queueItem(t.tenant.id);
    const ok = (await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${again.id}/approve`, headers: pa.auth })).json().data;
    expect(ok).toMatchObject({ reactivated: true, paidUntil: periodEnd(isoDate(0), 'monthly') });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: t.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/site', headers: t.host })).statusCode).toBe(200);
  });

  it('keeps each property to its own invoices and lets only platform admins price or verify', async () => {
    const a = await createTenant(); const b = await createTenant();
    await price(a, {});
    const ia = (await invoice(a, 'monthly')).json().data;
    expect((await app.inject({ method: 'GET', url: `/api/v1/admin/subscription/invoices/${ia.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/subscription/invoice/${ia.id}`, headers: b.auth })).statusCode).toBe(409);
    expect((await pay(b, ia.id, utr())).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/platform/tenants/${a.tenant.id}/subscription`, headers: a.auth, payload: { freeDays: 999, monthlyFee: 100, yearlyFee: null, graceDays: null } })).statusCode).toBe(401);
    const [p] = await asSystem((tx) => tx.select().from(platformPayments).limit(1));
    if (p) expect((await app.inject({ method: 'POST', url: `/api/v1/platform/payments/${p.id}/approve`, headers: a.auth })).statusCode).toBe(401);
  });

  it('extends goodwill days, supports complimentary and cancelled accounts, and audits changes', async () => {
    const t = await createTenant();
    await price(t, {});
    const before = (await overview(t)).trialEndsAt;
    const ext = await app.inject({ method: 'POST', url: `/api/v1/platform/tenants/${t.tenant.id}/subscription/extend`, headers: pa.auth, payload: { days: 10, note: 'Onboarding delay' } });
    expect(ext.json().data.trialEndsAt).toBe(new Date(Date.parse(`${before}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10));
    expect((await app.inject({ method: 'PUT', url: `/api/v1/platform/tenants/${t.tenant.id}/subscription/status`, headers: pa.auth, payload: { status: 'comp' } })).json().data.state).toBe('comp');
    expect((await invoice(t, 'monthly')).statusCode).toBe(409);
    expect((await price(t, { freeDays: 0, monthlyFee: null, yearlyFee: null })).statusCode).toBe(200); // comp: no fee needed
    await app.inject({ method: 'PUT', url: `/api/v1/platform/tenants/${t.tenant.id}/subscription/status`, headers: pa.auth, payload: { status: 'billing' } });
    await setDates(t, { startedAt: isoDate(-40) });
    expect((await price(t, { freeDays: 30, monthlyFee: null, yearlyFee: null })).statusCode).toBe(400); // trial over, no price
    const logs = await asSystem((tx) => tx.select().from(auditLogs).where(eq(auditLogs.tenantId, t.tenant.id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['platform.subscription.update', 'platform.subscription.extend', 'platform.subscription.comp']));
    const list = (await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: pa.auth })).json().data;
    expect(list.find((x: { id: string }) => x.id === t.tenant.id).subscription).toBeTruthy();
    const rev = (await app.inject({ method: 'GET', url: '/api/v1/platform/revenue', headers: pa.auth })).json().data;
    expect(rev).toHaveProperty('collectedThisFy');
  });
});
