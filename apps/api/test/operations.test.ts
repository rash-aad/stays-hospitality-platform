import { folioCharges, housekeepingTasks, maintenanceTickets, serviceRequestTypes, tenantModules } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asSystem } from '../src/infra/db.js';
import { invalidateTenant } from '../src/domain/tenants/tenant-cache.js';
import { addStaff, app, createRestaurant, createTenant, inHouseGuest, uniq, useApp } from './helpers.js';

useApp();

const tomorrowAt = (h: number, m = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(h - 5, m - 30, 0, 0); // IST → UTC
  return d.toISOString();
};

describe('restaurant reservations', () => {
  it('allocates best-fit tables and refuses overlapping bookings', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const book = (party: number, at = tomorrowAt(20)) => app.inject({ method: 'POST', url: `/api/v1/public/restaurants/${r.restaurant.id}/reservations`, headers: t.host, payload: { startsAt: at, partySize: party, guestName: 'Ravi', guestEmail: 'ravi@example.com', guestPhone: '+919822222222' } });
    const a = await book(2);
    expect(a.statusCode).toBe(201);
    const b = await book(2);
    expect(b.statusCode).toBe(201); // falls through to the 4-top
    const c = await book(2);
    expect(c.statusCode).toBe(409); // both tables taken for the 90-minute window
    expect(c.json().error.details.alternatives.length).toBeGreaterThan(0);
    const later = await book(2, tomorrowAt(21, 30));
    expect(later.statusCode).toBe(201); // after the first seating ends
  });

  it('concurrent requests for the last table produce exactly one reservation', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const all = await Promise.all(Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: `/api/v1/public/restaurants/${r.restaurant.id}/reservations`, headers: t.host, payload: { startsAt: tomorrowAt(13), partySize: 4, guestName: 'Group', guestEmail: 'g@example.com', guestPhone: '+919833333333' } })));
    expect(all.filter((x) => x.statusCode === 201)).toHaveLength(1);
  });

  it('waitlists when full, promotes on cancellation, tracks no-shows', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const mk = (extra = {}) => app.inject({ method: 'POST', url: '/api/v1/admin/reservations', headers: t.auth, payload: { restaurantId: r.restaurant.id, startsAt: tomorrowAt(19), partySize: 4, guestName: 'Walk-in', ...extra } });
    const first = (await mk()).json().data;
    const wait = (await mk({ joinWaitlist: true })).json().data;
    expect(wait.status).toBe('waitlisted');
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/reservations/${wait.id}/status`, headers: t.auth, payload: { status: 'confirmed' } })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/api/v1/admin/reservations/${first.id}/status`, headers: t.auth, payload: { status: 'cancelled' } });
    const promoted = await app.inject({ method: 'POST', url: `/api/v1/admin/reservations/${wait.id}/status`, headers: t.auth, payload: { status: 'confirmed' } });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().data.tableId).toBe(r.tables.t4.id);
    const ns = await app.inject({ method: 'POST', url: `/api/v1/admin/reservations/${wait.id}/status`, headers: t.auth, payload: { status: 'no_show' } });
    expect(ns.json().data.status).toBe('no_show');
  });
});

describe('ordering', () => {
  it('prices server-side, derives the room from the stay, and runs the kitchen lifecycle', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const g = await inHouseGuest(t);
    const res = await app.inject({
      method: 'POST', url: '/api/v1/portal/orders', headers: { ...g.auth, 'idempotency-key': uniq('o') },
      payload: { restaurantId: r.restaurant.id, orderTypeId: r.orderTypes.inRoom.id, paymentMode: 'room_charge', customLocation: 'Room 999', lines: [{ menuItemId: r.curry.id, quantity: 2, optionIds: [r.options.full.id, r.options.appam.id] }] },
    });
    expect(res.statusCode).toBe(201);
    const order = res.json().data.order;
    expect(order.subtotal).toBe(2 * (65000 + 20000 + 12000));
    expect(order.taxTotal).toBe(Math.round(order.subtotal * 0.05));
    expect(order.locationLabel).toMatch(/^Room 10[12]$/); // from the verified stay, not the body
    expect(order.paymentStatus).toBe('charged_to_room');
    const folio = await asSystem((tx) => tx.select().from(folioCharges).where(eq(folioCharges.sourceId, order.id)));
    expect(folio).toHaveLength(1);

    for (const s of ['accepted', 'preparing', 'ready', 'delivered', 'completed']) {
      const step = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${order.id}/status`, headers: t.auth, payload: { status: s } });
      expect(step.statusCode).toBe(200);
    }
    const bad = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${order.id}/status`, headers: t.auth, payload: { status: 'preparing' } });
    expect(bad.statusCode).toBe(409);
  });

  it('guests can cancel only before the kitchen accepts; cancellation voids the room charge', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const g = await inHouseGuest(t);
    const place = async () => (await app.inject({ method: 'POST', url: '/api/v1/portal/orders', headers: { ...g.auth, 'idempotency-key': uniq('o') }, payload: { restaurantId: r.restaurant.id, orderTypeId: r.orderTypes.pool.id, paymentMode: 'room_charge', area: 'Cabana 1', lines: [{ menuItemId: r.curry.id, quantity: 1 }] } })).json().data.order;
    const o1 = await place();
    expect(o1.locationLabel).toBe('Cabana 1');
    const c = await app.inject({ method: 'POST', url: `/api/v1/portal/orders/${o1.id}/cancel`, headers: g.auth });
    expect(c.statusCode).toBe(200);
    const [charge] = await asSystem((tx) => tx.select().from(folioCharges).where(eq(folioCharges.sourceId, o1.id)));
    expect(charge!.voidedAt).not.toBeNull();
    const o2 = await place();
    await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${o2.id}/status`, headers: t.auth, payload: { status: 'accepted' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/portal/orders/${o2.id}/cancel`, headers: g.auth })).statusCode).toBe(409);
  });

  it('rejects sold-out items and unknown pool areas', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const g = await inHouseGuest(t);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/portal/orders', headers: { ...g.auth, 'idempotency-key': uniq('o') }, payload: { restaurantId: r.restaurant.id, orderTypeId: r.orderTypes.pool.id, paymentMode: 'room_charge', area: 'Rooftop', lines: [{ menuItemId: r.curry.id, quantity: 1 }] } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: `/api/v1/admin/menu-items/${r.curry.id}/availability`, headers: t.auth, payload: { available: false } });
    const sold = await app.inject({ method: 'POST', url: '/api/v1/portal/orders', headers: { ...g.auth, 'idempotency-key': uniq('o') }, payload: { restaurantId: r.restaurant.id, orderTypeId: r.orderTypes.pool.id, paymentMode: 'room_charge', area: 'Pool deck', lines: [{ menuItemId: r.curry.id, quantity: 1 }] } });
    expect(sold.statusCode).toBe(409);
  });

  it('module toggles are enforced server-side (room service off → in-room ordering rejected)', async () => {
    const t = await createTenant();
    const r = await createRestaurant(t);
    const g = await inHouseGuest(t);
    const off = await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/room_service', headers: t.auth, payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/portal/orders', headers: { ...g.auth, 'idempotency-key': uniq('o') }, payload: { restaurantId: r.restaurant.id, orderTypeId: r.orderTypes.inRoom.id, paymentMode: 'room_charge', lines: [{ menuItemId: r.curry.id, quantity: 1 }] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('module_disabled');
    // Disabling Restaurant cascades to its dependents and shuts the kitchen queue.
    await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/restaurant', headers: t.auth, payload: { enabled: false } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/orders', headers: t.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/restaurants`, headers: t.host })).statusCode).toBe(403);
    const mods = await asSystem((tx) => tx.select().from(tenantModules).where(and(eq(tenantModules.tenantId, t.tenant.id), eq(tenantModules.moduleKey, 'restaurant.ordering'))));
    expect(mods[0]!.enabled).toBe(false);
    // Re-enabling a dependent without its prerequisite is refused.
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/restaurant.ordering', headers: t.auth, payload: { enabled: true } })).statusCode).toBe(400);
  });
});

describe('guest service requests', () => {
  async function types(t: Awaited<ReturnType<typeof createTenant>>) {
    return asSystem(async (tx) => {
      const [towels] = await tx.insert(serviceRequestTypes).values({ tenantId: t.tenant.id, key: 'towels', name: 'Extra towels', category: 'housekeeping', moduleKey: 'housekeeping', routesTo: 'housekeeping_task', slaMinutes: 20 }).returning();
      const [ac] = await tx.insert(serviceRequestTypes).values({ tenantId: t.tenant.id, key: 'ac', name: 'AC not cooling', category: 'maintenance', moduleKey: 'maintenance', routesTo: 'maintenance_ticket', defaultPriority: 'high', formSchema: [{ key: 'category', label: 'Category', type: 'select', options: ['hvac', 'electrical', 'plumbing'], required: true }] }).returning();
      const [cab] = await tx.insert(serviceRequestTypes).values({ tenantId: t.tenant.id, key: 'airport', name: 'Airport transfer', category: 'transport', moduleKey: 'transport', requiresStay: false, formSchema: [{ key: 'flight', label: 'Flight number', type: 'text', required: true }, { key: 'pickup', label: 'Pickup time', type: 'datetime', required: true }] }).returning();
      return { towels: towels!, ac: ac!, cab: cab! };
    });
  }

  it('routes requests to housekeeping and maintenance, and closes the loop', async () => {
    const t = await createTenant();
    const ty = await types(t);
    const g = await inHouseGuest(t);
    const towel = await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: g.auth, payload: { typeId: ty.towels.id, description: 'Two bath towels please' } });
    expect(towel.statusCode).toBe(201);
    const [task] = await asSystem((tx) => tx.select().from(housekeepingTasks).where(eq(housekeepingTasks.serviceRequestId, towel.json().data.id)));
    expect(task).toBeTruthy();
    for (const s of ['in_progress', 'done']) {
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/housekeeping/tasks/${task!.id}/status`, headers: t.auth, payload: { status: s } })).statusCode).toBe(200);
    }
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/portal/requests/${towel.json().data.id}`, headers: g.auth })).json().data;
    expect(detail.status).toBe('resolved');
    expect(detail.statusLabel).toBe('Done');

    const missing = await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: g.auth, payload: { typeId: ty.ac.id } });
    expect(missing.statusCode).toBe(400); // required form field
    const ac = await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: g.auth, payload: { typeId: ty.ac.id, description: 'AC blowing warm air', details: { category: 'hvac' } } });
    expect(ac.statusCode).toBe(201);
    const [ticket] = await asSystem((tx) => tx.select().from(maintenanceTickets).where(eq(maintenanceTickets.serviceRequestId, ac.json().data.id)));
    expect(ticket!.category).toBe('hvac');
    expect(ticket!.priority).toBe('high');
    expect(ticket!.locationLabel).toMatch(/^Room /);
  });

  it('requires an in-house stay for room requests but not for transfers', async () => {
    const t = await createTenant();
    const ty = await types(t);
    const g = await inHouseGuest(t);
    const { signAccess } = await import('../src/domain/auth/tokens.js');
    const { guests } = await import('@hp/db');
    const [other] = await asSystem((tx) => tx.insert(guests).values({ tenantId: t.tenant.id, email: `${uniq('x')}@example.com`, firstName: 'No', lastName: 'Stay', emailVerifiedAt: new Date() }).returning());
    const noStay = { authorization: `Bearer ${await signAccess({ typ: 'guest', sub: other!.id, tid: t.tenant.id })}` };
    expect((await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: noStay, payload: { typeId: ty.towels.id } })).json().error.code).toBe('no_active_stay');
    const cab = await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: noStay, payload: { typeId: ty.cab.id, details: { flight: '6E 512', pickup: new Date(Date.now() + 86400000).toISOString() } } });
    expect(cab.statusCode).toBe(201);
    // A guest can never read another guest's request.
    expect((await app.inject({ method: 'GET', url: `/api/v1/portal/requests/${cab.json().data.id}`, headers: g.auth })).statusCode).toBe(404);
  });

  it('staff workflow: assignment, notes visible to guest, invalid transitions refused', async () => {
    const t = await createTenant();
    const ty = await types(t);
    const g = await inHouseGuest(t);
    const hk = await addStaff(t, 'housekeeping');
    const id = (await app.inject({ method: 'POST', url: '/api/v1/portal/requests', headers: g.auth, payload: { typeId: ty.towels.id } })).json().data.id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/requests/${id}/assign`, headers: t.auth, payload: { userId: hk.user.id } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: `/api/v1/admin/requests/${id}/notes`, headers: hk.auth, payload: { body: 'On the way in 5 minutes', visibility: 'guest' } });
    await app.inject({ method: 'POST', url: `/api/v1/admin/requests/${id}/notes`, headers: hk.auth, payload: { body: 'Linen room low on stock', visibility: 'internal' } });
    const timeline = (await app.inject({ method: 'GET', url: `/api/v1/portal/requests/${id}`, headers: g.auth })).json().data.timeline;
    expect(timeline.some((e: { body: string }) => e.body === 'On the way in 5 minutes')).toBe(true);
    expect(timeline.some((e: { body: string }) => e.body === 'Linen room low on stock')).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/requests/${id}/status`, headers: t.auth, payload: { status: 'bogus' } })).statusCode).toBe(409);
  });
});

describe('experiences', () => {
  it('respects slot capacity and posts room charges', async () => {
    const t = await createTenant();
    const g = await inHouseGuest(t);
    const { paymentSettings } = await import('@hp/db');
    await asSystem((tx) => tx.update(paymentSettings).set({ methodsEnabled: ['room_charge', 'pay_at_property'] }).where(eq(paymentSettings.tenantId, t.tenant.id)));
    const exp = (await app.inject({ method: 'POST', url: '/api/v1/admin/experiences', headers: t.auth, payload: { propertyId: t.property.id, kind: 'activity', name: 'Sunrise kayak', slug: 'kayak', durationMinutes: 90, price: 150000, maxParticipants: 4 } })).json().data;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await app.inject({ method: 'POST', url: `/api/v1/admin/experiences/${exp.id}/slots`, headers: t.auth, payload: { from: tomorrow, to: tomorrow, times: ['07:00'], capacity: 3 } });
    const slots = (await app.inject({ method: 'GET', url: `/api/v1/public/experiences/${exp.id}/slots`, headers: t.host })).json().data;
    const book = (n: number) => app.inject({ method: 'POST', url: '/api/v1/portal/experience-bookings', headers: { ...g.auth, 'idempotency-key': uniq('e') }, payload: { slotId: slots[0].id, participants: n, paymentMode: 'room_charge' } });
    const ok = await book(2);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.booking.total).toBe(300000);
    expect((await book(2)).statusCode).toBe(409);
  });
});
