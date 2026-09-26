import { bookings, notifications, roles, rolePermissions } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { syncPermissions } from '../src/domain/tenants/provision.js';
import { asSystem } from '../src/infra/db.js';
import { addStaff, app, createTenant, inHouseGuest, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

useApp();

async function book(t: TestTenant, inDays: number, nights: number) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') },
    payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(inDays), checkOut: isoDate(inDays + nights), adults: 2, children: 0, guest: { email: `${uniq('g')}@example.com`, firstName: 'Late', lastName: 'Arrival', phone: '+919800000000' }, paymentMethod: 'pay_at_property' },
  });
  return r.json().data as { id: string; total: number };
}

describe('cash drawer shifts', () => {
  it('tracks float, cash payments, refunds and movements, and needs a note when the count is off', async () => {
    const t = await createTenant();
    const desk = await addStaff(t, 'front_desk');
    const g = await inHouseGuest(t);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/shifts/current/movements', headers: desk.auth, payload: { kind: 'paid_out', amount: 100, reason: 'Petty cash' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/shifts', headers: desk.auth, payload: { openingFloat: 500000 } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/shifts', headers: desk.auth, payload: { openingFloat: 1 } })).statusCode).toBe(409);

    const cash = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${g.booking.id}/payments`, headers: desk.auth, payload: { amount: 300000, tender: 'cash' } });
    expect(cash.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${g.booking.id}/payments`, headers: desk.auth, payload: { amount: 200000, tender: 'card' } });
    await app.inject({ method: 'POST', url: '/api/v1/admin/shifts/current/movements', headers: desk.auth, payload: { kind: 'paid_out', amount: 50000, reason: 'Flowers for lobby' } });
    await app.inject({ method: 'POST', url: '/api/v1/admin/shifts/current/movements', headers: desk.auth, payload: { kind: 'drop', amount: 400000, reason: 'Safe drop' } });
    // Owner refunds part of the cash payment — not from the desk's drawer (owner has no open shift).
    const refund = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${cash.json().data.id}/refund`, headers: t.auth, payload: { amount: 10000, reason: 'Overcharged' } });
    expect(refund.statusCode).toBe(200);

    const cur = (await app.inject({ method: 'GET', url: '/api/v1/admin/shifts/current', headers: desk.auth })).json().data;
    expect(cur.totals).toMatchObject({ openingFloat: 500000, cashTaken: 300000, otherTenders: 200000, paidOut: 50000, drops: 400000, cashRefunds: 0, expected: 350000 });

    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/shifts/current/close', headers: desk.auth, payload: { countedCash: 349000 } })).statusCode).toBe(400);
    const closed = await app.inject({ method: 'POST', url: '/api/v1/admin/shifts/current/close', headers: desk.auth, payload: { countedCash: 349000, notes: 'Short ₹10 — change error' } });
    expect(closed.json().data).toMatchObject({ status: 'closed', expectedCash: 350000, countedCash: 349000, variance: -1000 });
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/shifts', headers: t.auth })).json().data;
    expect(list[0]).toMatchObject({ variance: -1000, user: desk.user.name });
  });
});

describe('night audit', () => {
  it('lists what needs attention, refuses to close with unresolved departures, marks no-shows, and emails the report once', async () => {
    const t = await createTenant({ rooms: 3 });
    const late = await book(t, 0, 1); // due today, not arrived
    const g = await inHouseGuest(t); // today → +2
    const st = (await app.inject({ method: 'GET', url: '/api/v1/admin/night-audit', headers: t.auth })).json().data;
    expect(st.date).toBe(isoDate(0));
    expect(st.checks.arrivalsPending.map((a: { id: string }) => a.id)).toContain(late.id);
    expect(st.preview.rooms).toMatchObject({ available: 3, sold: 2 }); // the late arrival still holds a room

    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/night-audit/close', headers: t.auth, payload: { date: isoDate(1) } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/night-audit/close', headers: t.auth, payload: { date: isoDate(0) } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/admin/night-audit/close', headers: t.auth, payload: { date: isoDate(0), noShows: 'mark', notes: 'Quiet night' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.summary.rooms.sold).toBe(1); // …until marked a no-show at close
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, late.id)));
    expect(b!.status).toBe('no_show');
    // Today is closed; closing again is refused.
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/night-audit', headers: t.auth })).json().data.canClose).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/night-audit/close', headers: t.auth, payload: { date: isoDate(1), noShows: 'keep' } })).statusCode).toBe(409);

    const mails = await asSystem((tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, t.tenant.id), eq(notifications.templateKey, 'report.daily'))));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.body).toContain('Rooms: 1 of 3 sold (33%)');
    const days = (await app.inject({ method: 'GET', url: '/api/v1/admin/night-audit/days', headers: t.auth })).json().data;
    expect(days[0]).toMatchObject({ date: isoDate(0), notes: 'Quiet night' });
    expect(g.booking.id).toBeTruthy();
  });

  it('refuses when guests due out are still checked in', async () => {
    const t = await createTenant();
    const g = await inHouseGuest(t);
    await asSystem((tx) => tx.update(bookings).set({ checkIn: isoDate(-1), checkOut: isoDate(0) }).where(eq(bookings.id, g.booking.id)));
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/night-audit/close', headers: t.auth, payload: { date: isoDate(0), noShows: 'keep' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/Check out/);
  });
});

describe('permission catalog upgrades', () => {
  it('grants permissions new to the database to existing system roles, without re-adding removed ones', async () => {
    const t = await createTenant();
    const [desk] = await asSystem((tx) => tx.select().from(roles).where(and(eq(roles.tenantId, t.tenant.id), eq(roles.key, 'front_desk'))));
    // Simulate an older database: the key is unknown and the role lacks it; an owner removed another default.
    await asSystem(async (tx) => {
      await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, desk!.id), eq(rolePermissions.permissionKey, 'cash.handle')));
      await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, desk!.id), eq(rolePermissions.permissionKey, 'payments.verify')));
      const { permissions } = await import('@hp/db');
      await tx.delete(permissions).where(eq(permissions.key, 'cash.handle'));
    });
    const added = await asSystem((tx) => syncPermissions(tx));
    expect(added).toContain('cash.handle');
    const perms = (await asSystem((tx) => tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, desk!.id)))).map((p) => p.permissionKey);
    expect(perms).toContain('cash.handle');
    expect(perms).not.toContain('payments.verify');
  });
});
