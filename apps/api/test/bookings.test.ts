import { availability, bookings, paymentSettings, payments } from '@hp/db';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { expireHolds } from '../src/domain/bookings/service.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { asSystem } from '../src/infra/db.js';
import { app, createTenant, isoDate, useApp, type TestTenant } from './helpers.js';

useApp();

const guest = (n: number) => ({ email: `guest${n}-${Date.now()}@example.com`, firstName: 'Asha', lastName: `Rao${n}`, phone: '+919800000000' });

function bookBody(t: TestTenant, n: number, extra: Record<string, unknown> = {}) {
  return { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(10), checkOut: isoDate(12), adults: 2, children: 0, guest: guest(n), paymentMethod: 'pay_at_property', ...extra };
}

async function enableUpi(t: TestTenant, methods = ['upi_manual', 'upi_gateway', 'pay_at_property']) {
  const key = process.env.SECRETS_MASTER_KEY!;
  await asSystem((tx) => tx.update(paymentSettings).set({
    methodsEnabled: methods, upiVpa: 'seabreeze@okhdfcbank', upiPayeeName: 'Seabreeze Resort',
    gatewayProvider: 'mock', gatewayKeyId: 'key_mock', gatewaySecretEnc: encryptSecret('mock_secret_123', key), gatewayWebhookSecretEnc: encryptSecret('mock_webhook_123', key),
  }).where(eq(paymentSettings.tenantId, t.tenant.id)));
}

const post = (t: TestTenant, url: string, payload: unknown, key?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { ...t.host, 'idempotency-key': key ?? `k-${Math.random()}` } });

describe('booking engine', () => {
  it('searches availability and quotes with taxes', async () => {
    const t = await createTenant();
    const r = await app.inject({ method: 'GET', url: `/api/v1/public/stay-search?checkIn=${isoDate(10)}&checkOut=${isoDate(12)}&adults=2`, headers: t.host });
    expect(r.statusCode).toBe(200);
    const res = r.json().data.results[0];
    expect(res.available).toBe(true);
    expect(res.rates[0].quote.nights).toHaveLength(2);
  });

  it('never oversells the last room under concurrent bookings', async () => {
    const t = await createTenant({ rooms: 1 });
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => post(t, '/api/v1/public/bookings', bookBody(t, i))));
    const ok = attempts.filter((r) => r.statusCode === 201);
    const rejected = attempts.filter((r) => r.statusCode === 409);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    const ledger = await asSystem((tx) => tx.select().from(availability).where(eq(availability.roomTypeId, t.roomType.id)));
    expect(ledger.every((l) => l.booked <= l.total)).toBe(true);
    expect(ledger.every((l) => l.booked === 1)).toBe(true);
  });

  it('replays an idempotent booking instead of creating a duplicate', async () => {
    const t = await createTenant();
    const body = bookBody(t, 1);
    const a = await post(t, '/api/v1/public/bookings', body, 'same-key-123');
    const b = await post(t, '/api/v1/public/bookings', body, 'same-key-123');
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json().data.id).toBe(a.json().data.id);
    const count = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.tenantId, t.tenant.id)));
    expect(count).toHaveLength(1);
    const reused = await post(t, '/api/v1/public/bookings', { ...body, adults: 1 }, 'same-key-123');
    expect(reused.statusCode).toBe(422);
  });

  it('rejects bookings when the module is disabled', async () => {
    const t = await createTenant({ modules: ['guest_portal'] });
    const r = await post(t, '/api/v1/public/bookings', bookBody(t, 1));
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('module_disabled');
  });

  it('cancels with policy fee and releases inventory', async () => {
    const t = await createTenant({ rooms: 1 });
    const created = (await post(t, '/api/v1/public/bookings', bookBody(t, 1))).json().data;
    const c = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${created.id}/cancel`, headers: t.auth, payload: { reason: 'Change of plans' } });
    expect(c.statusCode).toBe(200);
    expect(c.json().data.fee).toBe(0);
    const again = await post(t, '/api/v1/public/bookings', bookBody(t, 2));
    expect(again.statusCode).toBe(201);
  });

  it('checks in, assigns a room, checks out and issues an invoice', async () => {
    const t = await createTenant({ rooms: 2 });
    const created = (await post(t, '/api/v1/public/bookings', bookBody(t, 1))).json().data;
    const ci = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${created.id}/check-in`, headers: t.auth, payload: {} });
    expect(ci.statusCode).toBe(200);
    const co = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${created.id}/check-out`, headers: t.auth, payload: {} });
    expect(co.statusCode).toBe(200);
    expect(co.json().data.invoice.number).toMatch(/^INV-\d{4}-00001$/);
  });
});

describe('UPI payments', () => {
  it('manual UPI: hold → UTR → staff approval confirms the booking', async () => {
    const t = await createTenant({ rooms: 1 });
    await enableUpi(t);
    const created = await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_manual' }));
    expect(created.statusCode).toBe(201);
    const data = created.json().data;
    expect(data.status).toBe('pending_payment');
    expect(data.instructions.kind).toBe('upi_manual');
    expect(data.instructions.upiUri).toContain('pa=seabreeze%40okhdfcbank');
    expect(data.instructions.qrSvg).toContain('<svg');

    // Wrong token cannot see or pay.
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/bookings/${data.id}/payment?token=nope`, headers: t.host })).statusCode).toBe(403);

    const utr = await app.inject({ method: 'POST', url: `/api/v1/public/bookings/${data.id}/utr`, headers: t.host, payload: { token: data.payToken, utr: '412345678901' } });
    expect(utr.statusCode).toBe(200);
    expect(utr.json().data.status).toBe('pending_verification');

    const queue = (await app.inject({ method: 'GET', url: '/api/v1/admin/payments?status=pending_verification', headers: t.auth })).json();
    expect(queue.meta.pendingVerification).toBe(1);
    const paymentId = queue.data[0].id;

    const reject = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${paymentId}/verify`, headers: t.auth, payload: { decision: 'reject' } });
    expect(reject.statusCode).toBe(400); // reason is required
    const approve = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${paymentId}/verify`, headers: t.auth, payload: { decision: 'approve' } });
    expect(approve.statusCode).toBe(200);
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, data.id)));
    expect(b!.status).toBe('confirmed');
    expect(b!.paymentStatus).toBe('paid');
    expect(b!.amountPaid).toBe(b!.total);
  });

  it('manual UPI: rejection lets the guest resubmit; duplicate UTRs are refused', async () => {
    const t = await createTenant({ rooms: 3 });
    await enableUpi(t);
    const a = (await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_manual' }))).json().data;
    const b = (await post(t, '/api/v1/public/bookings', bookBody(t, 2, { paymentMethod: 'upi_manual' }))).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/public/bookings/${a.id}/utr`, headers: t.host, payload: { token: a.payToken, utr: '500000000001' } });
    const dup = await app.inject({ method: 'POST', url: `/api/v1/public/bookings/${b.id}/utr`, headers: t.host, payload: { token: b.payToken, utr: '500000000001' } });
    expect(dup.statusCode).toBe(409);

    const [p] = await asSystem((tx) => tx.select().from(payments).where(and(eq(payments.targetId, a.id))));
    const rej = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${p!.id}/verify`, headers: t.auth, payload: { decision: 'reject', reason: 'No credit found for this UTR' } });
    expect(rej.statusCode).toBe(200);
    const page = (await app.inject({ method: 'GET', url: `/api/v1/public/bookings/${a.id}/payment?token=${a.payToken}`, headers: t.host })).json().data;
    expect(page.payment.status).toBe('rejected');
    expect(page.payment.rejectionReason).toMatch(/No credit/);
    const retry = await app.inject({ method: 'POST', url: `/api/v1/public/bookings/${a.id}/utr`, headers: t.host, payload: { token: a.payToken, utr: '500000000002' } });
    expect(retry.statusCode).toBe(200);
  });

  it('staff without payments.verify cannot approve', async () => {
    const t = await createTenant();
    await enableUpi(t);
    const { addStaff } = await import('./helpers.js');
    const kitchen = await addStaff(t, 'kitchen');
    const a = (await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_manual' }))).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/public/bookings/${a.id}/utr`, headers: t.host, payload: { token: a.payToken, utr: '600000000001' } });
    const [p] = await asSystem((tx) => tx.select().from(payments).where(eq(payments.targetId, a.id)));
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${p!.id}/verify`, headers: kitchen.auth, payload: { decision: 'approve' } });
    expect(r.statusCode).toBe(403);
  });

  it('UPI gateway: signed webhook confirms; bad signatures and replays are harmless', async () => {
    const t = await createTenant();
    await enableUpi(t);
    const created = (await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_gateway' }))).json().data;
    expect(created.instructions.kind).toBe('upi_gateway');
    const orderId = created.instructions.checkout.orderId;

    const forged = await app.inject({ method: 'POST', url: `/api/v1/public/payments/webhook/${t.slug}/mock`, headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' }, payload: JSON.stringify({ event: 'payment.captured', orderId, paymentId: 'pay_x' }) });
    expect(forged.statusCode).toBe(401);

    const [p] = await asSystem((tx) => tx.select().from(payments).where(eq(payments.targetId, created.id)));
    const sim = await app.inject({ method: 'POST', url: `/api/v1/public/payments/mock/${p!.id}/simulate`, payload: { success: true } });
    expect(sim.json().data.webhookStatus).toBe(200);
    const sim2 = await app.inject({ method: 'POST', url: `/api/v1/public/payments/mock/${p!.id}/simulate`, payload: { success: true } });
    expect(sim2.json().data.webhookStatus).toBe(200);
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, created.id)));
    expect(b!.status).toBe('confirmed');
    expect(b!.amountPaid).toBe(b!.total);
  });

  it('only offers the methods the tenant enabled', async () => {
    const t = await createTenant();
    await enableUpi(t, ['upi_manual']);
    const r = await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_gateway' }));
    expect(r.statusCode).toBe(400);
    const s = (await app.inject({ method: 'GET', url: `/api/v1/public/stay-search?checkIn=${isoDate(10)}&checkOut=${isoDate(12)}`, headers: t.host })).json();
    expect(s.data.paymentMethods).toEqual(['upi_manual']);
  });

  it('expired holds release inventory', async () => {
    const t = await createTenant({ rooms: 1 });
    await enableUpi(t);
    const created = (await post(t, '/api/v1/public/bookings', bookBody(t, 1, { paymentMethod: 'upi_manual' }))).json().data;
    expect((await post(t, '/api/v1/public/bookings', bookBody(t, 2))).statusCode).toBe(409);
    await asSystem((tx) => tx.update(bookings).set({ holdExpiresAt: sql`now() - interval '1 minute'` }).where(eq(bookings.id, created.id)));
    await asSystem((tx) => expireHolds(tx));
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, created.id)));
    expect(b!.status).toBe('expired');
    expect((await post(t, '/api/v1/public/bookings', bookBody(t, 3))).statusCode).toBe(201);
  });

  it('refunds a captured payment and updates the booking', async () => {
    const t = await createTenant();
    const created = (await post(t, '/api/v1/public/bookings', bookBody(t, 1))).json().data;
    const pay = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${created.id}/payments`, headers: t.auth, payload: { amount: created.total } });
    expect(pay.statusCode).toBe(201);
    const refund = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${pay.json().data.id}/refund`, headers: t.auth, payload: { amount: 1000, reason: 'Goodwill' } });
    expect(refund.statusCode).toBe(200);
    expect(refund.json().data.status).toBe('recorded');
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, created.id)));
    expect(b!.paymentStatus).toBe('partially_refunded');
    const over = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${pay.json().data.id}/refund`, headers: t.auth, payload: { amount: created.total } });
    expect(over.statusCode).toBe(400);
  });
});
