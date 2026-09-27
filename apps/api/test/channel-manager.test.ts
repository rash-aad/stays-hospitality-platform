import { bookings, channelConnections } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channexAdapter, mockState } from '../src/domain/channel-manager/adapters.js';
import { asSystem } from '../src/infra/db.js';
import { app, createTenant, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

useApp();

async function connect(t: TestTenant) {
  expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/channel-manager', headers: t.auth, payload: { provider: 'mock', externalPropertyId: 'PROP-1', horizonDays: 60 } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/channel-manager/mappings', headers: t.auth, payload: { mappings: [{ ratePlanId: t.ratePlan.id, externalRoomTypeId: 'RT-DLX', externalRatePlanId: 'RP-DLX-BAR' }] } })).statusCode).toBe(200);
  const [c] = await asSystem((tx) => tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.tenant.id)));
  return c!;
}
const sync = (t: TestTenant, full = false) => app.inject({ method: 'POST', url: '/api/v1/admin/channel-manager/sync', headers: t.auth, payload: { full } });
const simulate = (t: TestTenant, body: object) => app.inject({ method: 'POST', url: '/api/v1/admin/channel-manager/simulate', headers: t.auth, payload: body });
const byRef = async (t: TestTenant, ref: string) => (await asSystem((tx) => tx.select().from(bookings).where(and(eq(bookings.tenantId, t.tenant.id), eq(bookings.channelRef, ref)))))[0];

describe('channel manager', () => {
  it('pushes the whole calendar once, then only what changed, with pricing rules applied', async () => {
    const t = await createTenant({ rooms: 2 });
    const c = await connect(t);
    const first = (await sync(t)).json().data;
    expect(first).toMatchObject({ availability: 1, restrictions: expect.any(Number) });
    const s = mockState(c.id);
    expect(s.availability[0]).toMatchObject({ externalRoomTypeId: 'RT-DLX', dateFrom: isoDate(0), dateTo: isoDate(59), availability: 2 });
    expect(s.restrictions.every((r) => r.externalRatePlanId === 'RP-DLX-BAR' && r.rate === 800000 && !r.stopSell)).toBe(true);

    expect((await sync(t)).json().data).toMatchObject({ availability: 0, restrictions: 0 }); // nothing changed

    await app.inject({ method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') }, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(10), checkOut: isoDate(12), adults: 2, children: 0, guest: { email: `${uniq('g')}@example.com`, firstName: 'A', lastName: 'B', phone: '+919800000000' }, paymentMethod: 'pay_at_property' } });
    await app.inject({ method: 'POST', url: '/api/v1/admin/pricing-rules', headers: t.auth, payload: { name: 'Half full', roomTypeId: null, kind: 'occupancy', params: { minOccupancyPct: 50 }, adjustPct: 20 } });
    const before = s.availability.length;
    expect((await sync(t)).json().data.availability).toBe(1);
    expect(s.availability.slice(before)).toEqual([{ externalRoomTypeId: 'RT-DLX', dateFrom: isoDate(10), dateTo: isoDate(11), availability: 1 }]);
    expect(s.restrictions.at(-1)).toMatchObject({ dateFrom: isoDate(10), dateTo: isoDate(11), rate: 960000 });
  });

  it('receives new, modified and cancelled OTA bookings exactly once', async () => {
    const t = await createTenant({ rooms: 2 });
    await connect(t);
    await simulate(t, { externalRatePlanId: 'RP-DLX-BAR', checkIn: isoDate(20), checkOut: isoDate(22), externalId: 'BDC-111', guestName: 'Priya Nair', total: 1750000 });
    await sync(t);
    const b = await byRef(t, 'BDC-111');
    expect(b).toMatchObject({ source: 'ota', channelName: 'Booking.com', channelTotal: 1750000, status: 'confirmed', checkIn: isoDate(20), channelIssue: null });
    await sync(t); // acknowledged: not created twice
    expect((await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.channelRef, 'BDC-111')))).length).toBe(1);

    await simulate(t, { externalRatePlanId: 'RP-DLX-BAR', checkIn: isoDate(21), checkOut: isoDate(24), externalId: 'BDC-111', status: 'modified' });
    await sync(t);
    expect(await byRef(t, 'BDC-111')).toMatchObject({ checkIn: isoDate(21), checkOut: isoDate(24) });
    await simulate(t, { externalRatePlanId: 'RP-DLX-BAR', checkIn: isoDate(21), checkOut: isoDate(24), externalId: 'BDC-111', status: 'cancelled' });
    await sync(t);
    expect((await byRef(t, 'BDC-111'))!.status).toBe('cancelled');
  });

  it('records an OTA booking even when we are full, flags it, and lets the desk resolve it', async () => {
    const t = await createTenant({ rooms: 1 });
    await connect(t);
    await app.inject({ method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') }, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(15), checkOut: isoDate(16), adults: 2, children: 0, guest: { email: `${uniq('g')}@example.com`, firstName: 'A', lastName: 'B', phone: '+919800000000' }, paymentMethod: 'pay_at_property' } });
    await simulate(t, { externalRatePlanId: 'RP-DLX-BAR', checkIn: isoDate(15), checkOut: isoDate(16), externalId: 'AIR-9' });
    await sync(t);
    const b = await byRef(t, 'AIR-9');
    expect(b).toMatchObject({ status: 'confirmed', channelIssue: 'overbooked' });
    const view = (await app.inject({ method: 'GET', url: '/api/v1/admin/channel-manager', headers: t.auth })).json().data;
    expect(view.issues.map((i: { reference: string }) => i.reference)).toContain(b!.reference);
    expect(view.log.some((l: { summary: string; ok: boolean }) => l.summary.startsWith('OVERBOOKED') && !l.ok)).toBe(true);
    await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${b!.id}/channel-issue/resolve`, headers: t.auth });
    expect((await byRef(t, 'AIR-9'))!.channelIssue).toBeNull();
  });

  it('keeps a booking for an unmapped rate plan waiting (not acknowledged) until it is mapped', async () => {
    const t = await createTenant({ rooms: 2 });
    const c = await connect(t);
    await simulate(t, { externalRatePlanId: 'RP-UNKNOWN', checkIn: isoDate(30), checkOut: isoDate(31), externalId: 'EXP-5' });
    await sync(t);
    expect(await byRef(t, 'EXP-5')).toBeUndefined();
    expect(mockState(c.id).acked).toHaveLength(0);
    await app.inject({ method: 'PUT', url: '/api/v1/admin/channel-manager/mappings', headers: t.auth, payload: { mappings: [{ ratePlanId: t.ratePlan.id, externalRoomTypeId: 'RT-DLX', externalRatePlanId: 'RP-UNKNOWN' }] } });
    await sync(t);
    expect(await byRef(t, 'EXP-5')).toBeTruthy();
  });
});

describe('Channex connector', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends ARI in Channex format and maps booking revisions', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/booking_revisions/feed')) {
        return new Response(JSON.stringify({ data: [{ id: 'rev-1', attributes: { booking_id: 'b-1', ota_reservation_code: 'BDC-777', status: 'new', ota_name: 'Booking.com', arrival_date: '2027-01-10', departure_date: '2027-01-12', amount: '17500.00', customer: { name: 'Priya', surname: 'Nair', mail: 'p@guest.booking.com' }, rooms: [{ rate_plan_id: 'rp-1', occupancy: { adults: 2, children: 1 } }] } }] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    const conn = { id: 'c', externalPropertyId: 'prop-uuid', environment: 'staging' as const, apiKey: 'secret-key-123' };
    await channexAdapter.pushAvailability(conn, [{ externalRoomTypeId: 'rt-1', dateFrom: '2027-01-01', dateTo: '2027-01-05', availability: 3 }]);
    await channexAdapter.pushRestrictions(conn, [{ externalRatePlanId: 'rp-1', dateFrom: '2027-01-01', dateTo: '2027-01-05', rate: 850050, stopSell: false, minStay: 2 }]);
    expect(calls[0]!.url).toBe('https://staging.channex.io/api/v1/availability');
    expect((calls[0]!.init.headers as Record<string, string>)['user-api-key']).toBe('secret-key-123');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ values: [{ property_id: 'prop-uuid', room_type_id: 'rt-1', date_from: '2027-01-01', date_to: '2027-01-05', availability: 3 }] });
    expect(JSON.parse(String(calls[1]!.init.body)).values[0]).toMatchObject({ rate_plan_id: 'rp-1', rate: '8500.50', stop_sell: false, min_stay_arrival: 2 });
    const [rev] = await channexAdapter.fetchBookings(conn);
    expect(rev).toMatchObject({ revisionId: 'rev-1', externalId: 'BDC-777', status: 'new', channel: 'Booking.com', externalRatePlanId: 'rp-1', adults: 2, children: 1, total: 1750000, guest: { firstName: 'Priya', email: 'p@guest.booking.com' } });
    await channexAdapter.ack(conn, 'rev-1');
    expect(calls.at(-1)!.url).toBe('https://staging.channex.io/api/v1/booking_revisions/rev-1/ack');
  });
});
