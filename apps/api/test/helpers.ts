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
