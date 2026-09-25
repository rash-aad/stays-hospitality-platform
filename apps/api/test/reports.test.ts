import { describe, expect, it } from 'vitest';
import { addStaff, app, createTenant, inHouseGuest, useApp } from './helpers.js';

useApp();

describe('reports', () => {
  it('computes occupancy, ADR and dashboard counts', async () => {
    const t = await createTenant({ rooms: 2 });
    await inHouseGuest(t);
    const today = new Date().toISOString().slice(0, 10);
    const r = await app.inject({ method: 'GET', url: `/api/v1/admin/reports/summary?from=${today}&to=${today}`, headers: t.auth });
    expect(r.statusCode).toBe(200);
    const rooms = r.json().data.rooms;
    expect(rooms.roomNightsSold).toBe(1);
    expect(rooms.roomNightsAvailable).toBe(2);
    expect(rooms.occupancy).toBe(0.5);
    expect(rooms.adr).toBe(800000);
    const dash = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers: t.auth })).json().data;
    expect(dash.inHouse).toBe(1);
  });

  it('exports CSV with formula injection neutralised', async () => {
    const t = await createTenant();
    await app.inject({ method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': 'csv-test-1' }, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), checkOut: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10), adults: 1, guest: { email: 'csv@example.com', firstName: '=HYPERLINK("x")', lastName: 'Test', phone: '+911234567890' }, paymentMethod: 'pay_at_property' } });
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/reports/export?type=bookings', headers: t.auth });
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.body).toContain(`"'=HYPERLINK(""x"") Test"`);
  });

  it('is permission- and module-gated', async () => {
    const t = await createTenant();
    const k = await addStaff(t, 'kitchen');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/reports/summary', headers: k.auth })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/reports', headers: t.auth, payload: { enabled: false } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/reports/summary', headers: t.auth })).json().error.code).toBe('module_disabled');
  });
});
