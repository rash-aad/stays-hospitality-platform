import type { ModuleKey } from '@hp/contracts';
import { properties, rooms, roomTypes, ratePlans, userRoles, users, roles } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/domain/auth/service.js';
import { initTokens, signAccess } from '../src/domain/auth/tokens.js';
import { provisionTenant } from '../src/domain/tenants/provision.js';
import { asSystem, closeDb, initDb } from '../src/infra/db.js';
import { closeRedis, initRedis, redis } from '../src/infra/redis.js';

export let app: App;

export function useApp() {
  beforeAll(async () => {
    const config = loadConfig();
    initDb(config.APP_DATABASE_URL, 10);
    initRedis(config.REDIS_URL);
    initTokens(config.JWT_SECRET);
    await redis().flushdb();
    app = await buildApp(config);
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await closeRedis();
    await closeDb();
  });
}

let counter = 0;
export const uniq = (p = 't') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export type TestTenant = Awaited<ReturnType<typeof createTenant>>;

/** A provisioned tenant with an owner, one property, a room type with N rooms and a rate plan. */
export async function createTenant(opts: { modules?: ModuleKey[]; rooms?: number } = {}) {
  const slug = uniq('ten');
  const password = 'Password12345';
  const pw = await hashPassword(password);
  const r = await asSystem(async (tx) => {
    const { tenant, ownerId, roleIds } = await provisionTenant(tx, {
      name: `Test ${slug}`, slug, rootDomain: 'localhost',
      modules: opts.modules ?? ['room_booking', 'payments', 'guest_portal', 'restaurant', 'restaurant.reservations', 'restaurant.ordering', 'room_service', 'housekeeping', 'maintenance', 'concierge', 'experiences', 'spa', 'transport', 'website_builder', 'reports', 'offers', 'notifications', 'events', 'integrations'],
      owner: { name: 'Owner', email: `${slug}@example.com`, passwordHash: pw },
    });
    const [prop] = await tx.insert(properties).values({ tenantId: tenant.id, name: `Hotel ${slug}`, slug: 'main' }).returning();
    const [rt] = await tx.insert(roomTypes).values({ tenantId: tenant.id, propertyId: prop!.id, name: 'Deluxe', slug: 'deluxe', baseOccupancy: 2, maxOccupancy: 3, maxAdults: 3, maxChildren: 1 }).returning();
    const roomRows = [];
    for (let i = 0; i < (opts.rooms ?? 2); i++) {
      const [room] = await tx.insert(rooms).values({ tenantId: tenant.id, propertyId: prop!.id, roomTypeId: rt!.id, number: String(101 + i) }).returning();
      roomRows.push(room!);
    }
    const [rp] = await tx.insert(ratePlans).values({ tenantId: tenant.id, roomTypeId: rt!.id, name: 'Best available', code: 'BAR', basePrice: 800000, extraAdultPrice: 150000 }).returning();
    return { tenant, ownerId: ownerId!, roleIds, property: prop!, roomType: rt!, rooms: roomRows, ratePlan: rp! };
  });
  const token = await signAccess({ typ: 'staff', sub: r.ownerId, tid: r.tenant.id });
  return { ...r, slug, ownerEmail: `${slug}@example.com`, password, token, auth: { authorization: `Bearer ${token}` }, host: { 'x-tenant-host': `${slug}.localhost` } };
}

/** Add a staff user with a given system role to a tenant; returns auth headers. */
export async function addStaff(t: TestTenant, roleKey: string) {
  const u = await asSystem(async (tx) => {
    const [u] = await tx.insert(users).values({ tenantId: t.tenant.id, name: `Staff ${roleKey}`, email: `${uniq(roleKey)}@example.com`, status: 'active' }).returning();
    const [role] = await tx.select().from(roles).where(and(eq(roles.tenantId, t.tenant.id), eq(roles.key, roleKey)));
    await tx.insert(userRoles).values({ tenantId: t.tenant.id, userId: u!.id, roleId: role!.id });
    return u!;
  });
  const token = await signAccess({ typ: 'staff', sub: u.id, tid: t.tenant.id });
  return { user: u, auth: { authorization: `Bearer ${token}` } };
}

export async function platformAdmin() {
  const u = await asSystem(async (tx) => {
    const [u] = await tx.insert(users).values({ tenantId: null, name: 'Platform', email: `${uniq('root')}@example.com`, isPlatformAdmin: true, passwordHash: await hashPassword('Password12345') }).returning();
    return u!;
  });
  const token = await signAccess({ typ: 'platform', sub: u.id });
  return { user: u, auth: { authorization: `Bearer ${token}` } };
}

export function isoDate(daysFromToday: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Book, verify the guest, check in, and return a guest token bound to that in-house stay. */
export async function inHouseGuest(t: TestTenant) {
  const { guests } = await import('@hp/db');
  const email = `${uniq('g')}@example.com`;
  const created = await app.inject({
    method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') },
    payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(0), checkOut: isoDate(2), adults: 2, children: 0, guest: { email, firstName: 'Meera', lastName: 'Iyer', phone: '+919811111111' }, paymentMethod: 'pay_at_property' },
  });
  const booking = created.json().data;
  const ci = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${booking.id}/check-in`, headers: t.auth, payload: {} });
  if (ci.statusCode !== 200) throw new Error(`check-in failed: ${ci.body}`);
  const [g] = await asSystem(async (tx) => tx.update(guests).set({ emailVerifiedAt: new Date() }).where(and(eq(guests.tenantId, t.tenant.id), eq(guests.email, email))).returning());
  const token = await signAccess({ typ: 'guest', sub: g!.id, tid: t.tenant.id });
  return { guest: g!, booking, auth: { authorization: `Bearer ${token}` } };
}

/** A restaurant open 06:00–23:30 daily with two tables, a menu and order types. */
export async function createRestaurant(t: TestTenant) {
  const db = await import('@hp/db');
  return asSystem(async (tx) => {
    const [r] = await tx.insert(db.restaurants).values({ tenantId: t.tenant.id, propertyId: t.property.id, name: 'Coast Kitchen', slug: uniq('r'), settings: { slotMinutes: 30, defaultDurationMinutes: 90, reservationWindowDays: 30, minLeadMinutes: 0, maxPartySize: 8, maxCoversPerSlot: null, autoConfirm: true } }).returning();
    for (let d = 0; d < 7; d++) await tx.insert(db.restaurantHours).values({ tenantId: t.tenant.id, restaurantId: r!.id, dayOfWeek: d, service: 'All day', opens: '06:00', closes: '23:30' });
    const [t2] = await tx.insert(db.restaurantTables).values({ tenantId: t.tenant.id, restaurantId: r!.id, label: 'T2', capacity: 2 }).returning();
    const [t4] = await tx.insert(db.restaurantTables).values({ tenantId: t.tenant.id, restaurantId: r!.id, label: 'T4', capacity: 4, minCapacity: 2 }).returning();
    const [menu] = await tx.insert(db.menus).values({ tenantId: t.tenant.id, restaurantId: r!.id, name: 'All day' }).returning();
    const [cat] = await tx.insert(db.menuCategories).values({ tenantId: t.tenant.id, menuId: menu!.id, name: 'Mains' }).returning();
    const [curry] = await tx.insert(db.menuItems).values({ tenantId: t.tenant.id, restaurantId: r!.id, categoryId: cat!.id, name: 'Meen curry', price: 65000, prepMinutes: 20 }).returning();
    const [half] = await tx.insert(db.menuItemVariants).values({ tenantId: t.tenant.id, menuItemId: curry!.id, kind: 'variant', groupName: 'Portion', name: 'Regular', isDefault: true }).returning();
    const [full] = await tx.insert(db.menuItemVariants).values({ tenantId: t.tenant.id, menuItemId: curry!.id, kind: 'variant', groupName: 'Portion', name: 'Large', priceDelta: 20000 }).returning();
    const [appam] = await tx.insert(db.menuItemVariants).values({ tenantId: t.tenant.id, menuItemId: curry!.id, kind: 'addon', groupName: 'Sides', name: 'Appam (2)', priceDelta: 12000 }).returning();
    const [inRoom] = await tx.insert(db.orderTypes).values({ tenantId: t.tenant.id, restaurantId: r!.id, key: 'in_room', name: 'In-room dining', locationMode: 'room', requiresStay: true, paymentModes: ['room_charge', 'upi_manual', 'pay_at_property'], moduleKey: 'room_service' }).returning();
    const [pool] = await tx.insert(db.orderTypes).values({ tenantId: t.tenant.id, restaurantId: r!.id, key: 'poolside', name: 'Poolside', locationMode: 'area', areas: ['Pool deck', 'Cabana 1'], paymentModes: ['room_charge', 'pay_at_property'] }).returning();
    await tx.insert(db.taxes).values({ tenantId: t.tenant.id, name: 'GST 5%', appliesTo: 'food', rateBps: 500 });
    return { restaurant: r!, tables: { t2: t2!, t4: t4! }, curry: curry!, options: { half: half!, full: full!, appam: appam! }, orderTypes: { inRoom: inRoom!, pool: pool! } };
  });
}
