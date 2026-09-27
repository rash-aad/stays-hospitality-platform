import { bookingItems, bookings, guests, notifications } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadTenant } from '../src/domain/tenants/tenant-cache.js';
import { earnForStay, tierFor, DEFAULT_LOYALTY } from '../src/domain/loyalty/service.js';
import { sendCampaign, unsubscribeToken } from '../src/domain/marketing/campaigns.js';
import { asSystem, withTenant } from '../src/infra/db.js';
import { app, createTenant, inHouseGuest, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

useApp();

const enableLoyalty = (t: TestTenant) => app.inject({ method: 'PUT', url: '/api/v1/admin/loyalty-settings', headers: t.auth, payload: { ...DEFAULT_LOYALTY, enabled: true } });

async function book(t: TestTenant, email: string, inDays: number, extra: object = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') }, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(inDays), checkOut: isoDate(inDays + 2), adults: 2, children: 0, guest: { email, firstName: 'Riya', lastName: 'Sen', phone: '+919800000000', ...extra }, paymentMethod: 'pay_at_property' } });
  expect(r.statusCode).toBe(201);
  return r.json().data as { id: string; total: number };
}

describe('loyalty points', () => {
  it('tiers by nights in the last year', () => {
    expect(tierFor(DEFAULT_LOYALTY, 0).current.name).toBe('Member');
    expect(tierFor(DEFAULT_LOYALTY, 6)).toMatchObject({ current: { name: 'Silver' }, next: { name: 'Gold' }, nightsToNext: 9 });
    expect(tierFor(DEFAULT_LOYALTY, 20).next).toBeNull();
  });

  it('earns on check-out, spends against a booking as a payment, and returns points if that booking is cancelled', async () => {
    const t = await createTenant({ rooms: 3 });
    expect((await enableLoyalty(t)).statusCode).toBe(200);
    const g = await inHouseGuest(t); // 2 nights × ₹8,000
    await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${g.booking.id}/check-out`, headers: t.auth, payload: {} });
    const [room] = await asSystem((tx) => tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, g.booking.id), eq(bookingItems.kind, 'room'))));
    const earned = Math.floor((room!.amount / 10_000) * 10);
    let me = (await app.inject({ method: 'GET', url: '/api/v1/portal/loyalty', headers: g.auth })).json().data;
    expect(me).toMatchObject({ enabled: true, balance: earned, tier: { current: { name: 'Member' } } });
    // Checking out twice never earns twice.
    const tenant = (await loadTenant(t.tenant.id))!;
    expect(await withTenant(t.tenant.id, (tx) => earnForStay(tx, tenant, g.booking.id))).toBe(0);

    const next = await book(t, g.guest.email, 10);
    const redeem = (points: number) => app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${next.id}/redeem-points`, headers: g.auth, payload: { points } });
    expect((await redeem(100)).statusCode).toBe(400); // below the minimum
    expect((await redeem(earned + 1)).statusCode).toBe(400); // more than the balance
    const ok = await redeem(earned);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ points: earned, value: earned * 25, balance: 0 });
    const [paid] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, next.id)));
    expect(paid!.amountPaid).toBe(earned * 25);

    const cancel = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${next.id}/cancel`, headers: g.auth, payload: {} });
    expect(cancel.statusCode).toBe(200);
    me = (await app.inject({ method: 'GET', url: '/api/v1/portal/loyalty', headers: g.auth })).json().data;
    expect(me.balance).toBe(earned);
    expect(me.ledger.map((l: { kind: string }) => l.kind)).toEqual(expect.arrayContaining(['earn', 'redeem', 'reverse']));

    // Staff adjustment, never below zero.
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/guests/${g.guest.id}/loyalty/adjust`, headers: t.auth, payload: { points: -(earned + 5), note: 'Correction' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/guests/${g.guest.id}/loyalty/adjust`, headers: t.auth, payload: { points: 50, note: 'Birthday bonus' } })).json().data.balance).toBe(earned + 50);
  });
});

describe('email campaigns', () => {
  it('reach only opted-in guests in the segment, carry a one-click unsubscribe, and honour it', async () => {
    const t = await createTenant();
    const optIn = `${uniq('a')}@example.com`;
    await book(t, optIn, 5, { marketingOptIn: true });
    await book(t, `${uniq('b')}@example.com`, 6); // no consent
    const vip = `${uniq('c')}@example.com`;
    await book(t, vip, 7, { marketingOptIn: true });
    await asSystem((tx) => tx.update(guests).set({ tags: ['VIP'] }).where(and(eq(guests.tenantId, t.tenant.id), eq(guests.email, vip))));

    const all = (await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns/audience', headers: t.auth, payload: { segment: {} } })).json().data;
    expect(all.count).toBe(2);
    const vips = (await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns/audience', headers: t.auth, payload: { segment: { tags: ['VIP'] } } })).json().data;
    expect(vips.count).toBe(1);

    const c = (await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns', headers: t.auth, payload: { name: 'Monsoon', subject: '{{firstName}}, monsoon rates are here', body: 'Hello {{firstName}}, stay three nights and pay for two this July.', segment: {} } })).json().data;
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${c.id}/test`, headers: t.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${c.id}/send`, headers: t.auth })).json().data.status).toBe('sending');
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/campaigns/${c.id}/send`, headers: t.auth })).statusCode).toBe(409);
    expect(await withTenant(t.tenant.id, (tx) => sendCampaign(tx, t.tenant.id, c.id))).toBe(2); // what the worker runs
    const mails = await asSystem((tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, t.tenant.id), eq(notifications.templateKey, 'marketing.campaign'))));
    expect(mails).toHaveLength(2);
    expect(mails[0]!.subject).toBe('Riya, monsoon rates are here');
    expect(mails[0]!.body).toMatch(/\/unsubscribe\?token=[0-9a-f-]{36}\.[\w-]+/);

    const [guest] = await asSystem((tx) => tx.select().from(guests).where(and(eq(guests.tenantId, t.tenant.id), eq(guests.email, optIn))));
    expect((await app.inject({ method: 'POST', url: '/api/v1/public/unsubscribe', headers: t.host, payload: { token: `${guest!.id}.forged` } })).statusCode).toBe(400);
    const other = await createTenant();
    expect((await app.inject({ method: 'POST', url: '/api/v1/public/unsubscribe', headers: other.host, payload: { token: unsubscribeToken(t.tenant.id, guest!.id) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/public/unsubscribe', headers: t.host, payload: { token: unsubscribeToken(t.tenant.id, guest!.id) } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/campaigns/audience', headers: t.auth, payload: { segment: {} } })).json().data.count).toBe(1);
  });
});

describe('review requests', () => {
  it('invites happy guests to post a public review, once', async () => {
    const t = await createTenant();
    await app.inject({ method: 'PUT', url: '/api/v1/admin/review-settings', headers: t.auth, payload: { googleUrl: 'https://g.page/r/seabreeze/review', tripadvisorUrl: null } });
    const g = await inHouseGuest(t);
    const fb = (payload: object) => app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/feedback`, headers: g.auth, payload });
    expect((await fb({ overall: 3 })).json().data.reviewLinks).toBeNull();
    expect((await fb({ overall: 5 })).json().data.reviewLinks).toMatchObject({ googleUrl: 'https://g.page/r/seabreeze/review' });
    await fb({ overall: 5, comment: 'Still lovely' });
    const mails = await asSystem((tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, t.tenant.id), eq(notifications.templateKey, 'review.request'))));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.body).toContain('https://g.page/r/seabreeze/review');
  });
});
