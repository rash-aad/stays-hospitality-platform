import {
  diningAreas, entityEvents, guests, menuCategories, menuItems, menuItemVariants, menus, orderItems, orders, orderTypes,
  restaurantHours, restaurantReservations, restaurants, restaurantSpecialHours, restaurantTables, rooms, users,
} from '@hp/db';
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { crud, hhmm, imageRef, isoDate, money } from '../../http/crud.js';
import { badRequest, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, resolvePublicTenant, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayIn, zonedTime } from '../../lib/dates.js';
import { loadMenu, transitionOrder, type OrderStatus } from '../orders/service.js';
import { createReservation, slotsFor, transitionReservation, updateReservation } from './reservations.js';

const slug = z.string().regex(/^[a-z0-9-]{2,60}$/);
const idParam = z.object({ id: z.string().uuid() });

async function owned(tx: Tx, table: typeof restaurants | typeof menus | typeof menuCategories | typeof menuItems | typeof diningAreas, id: unknown, tenantId: string, what: string) {
  if (typeof id !== 'string') return;
  const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  if (!row) throw badRequest(`Unknown ${what}`);
}

const settingsSchema = z.object({
  slotMinutes: z.number().int().min(10).max(120), defaultDurationMinutes: z.number().int().min(30).max(360), reservationWindowDays: z.number().int().min(1).max(365),
  minLeadMinutes: z.number().int().min(0).max(24 * 60), maxPartySize: z.number().int().min(1).max(100), maxCoversPerSlot: z.number().int().min(1).nullable(), autoConfirm: z.boolean(),
});

export const restaurantRoutes: Routes = async (app) => {
  // ================= Admin configuration (Restaurant module) =================
  const cfg = { permission: 'restaurant.manage' as const, readPermission: 'restaurant.reservations' as const, modules: ['restaurant' as const], tag: 'restaurant' };
  crud(app, {
    ...cfg, path: '/admin/restaurants', entity: 'restaurant', table: restaurants, orderBy: restaurants.sort,
    body: z.object({
      propertyId: z.string().uuid(), name: z.string().min(2).max(80), slug, kind: z.enum(['restaurant', 'cafe', 'bar', 'pool_bar', 'in_room_dining']).default('restaurant'),
      description: z.string().max(3000).nullable().optional(), cuisine: z.string().max(120).nullable().optional(), dietaryInfo: z.string().max(500).nullable().optional(),
      location: z.string().max(200).nullable().optional(), phone: z.string().max(30).nullable().optional(), email: z.string().email().nullable().optional(),
      images: z.array(imageRef).max(20).default([]), acceptsReservations: z.boolean().default(true), acceptsOrders: z.boolean().default(true),
      settings: settingsSchema.optional(), active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
  });
  crud(app, {
    ...cfg, path: '/admin/restaurant-hours', entity: 'restaurant_hours', table: restaurantHours, orderBy: restaurantHours.dayOfWeek,
    body: z.object({ restaurantId: z.string().uuid(), dayOfWeek: z.number().int().min(0).max(6), service: z.string().min(2).max(40), opens: hhmm, closes: hhmm }),
    filter: (q) => (q.restaurantId ? eq(restaurantHours.restaurantId, q.restaurantId) : undefined),
    validate: (tx, t, b) => owned(tx, restaurants, b.restaurantId, t, 'restaurant'),
  });
  crud(app, {
    ...cfg, path: '/admin/restaurant-special-hours', entity: 'restaurant_special_hours', table: restaurantSpecialHours, orderBy: restaurantSpecialHours.date,
    body: z.object({ restaurantId: z.string().uuid(), date: isoDate, closed: z.boolean().default(false), opens: hhmm.nullable().optional(), closes: hhmm.nullable().optional(), note: z.string().max(200).nullable().optional() }),
    filter: (q) => (q.restaurantId ? eq(restaurantSpecialHours.restaurantId, q.restaurantId) : undefined),
    validate: (tx, t, b) => owned(tx, restaurants, b.restaurantId, t, 'restaurant'),
  });
  crud(app, {
    ...cfg, path: '/admin/dining-areas', entity: 'dining_area', table: diningAreas, orderBy: diningAreas.sort,
    body: z.object({ restaurantId: z.string().uuid(), name: z.string().min(2).max(60), description: z.string().max(300).nullable().optional(), sort: z.number().int().default(0) }),
    filter: (q) => (q.restaurantId ? eq(diningAreas.restaurantId, q.restaurantId) : undefined),
    validate: (tx, t, b) => owned(tx, restaurants, b.restaurantId, t, 'restaurant'),
  });
  crud(app, {
    ...cfg, path: '/admin/restaurant-tables', entity: 'restaurant_table', table: restaurantTables, orderBy: restaurantTables.sort,
    body: z.object({
      restaurantId: z.string().uuid(), diningAreaId: z.string().uuid().nullable().optional(), label: z.string().min(1).max(20),
      minCapacity: z.number().int().min(1).max(50).default(1), capacity: z.number().int().min(1).max(50), status: z.enum(['available', 'occupied', 'out_of_service']).default('available'), sort: z.number().int().default(0),
    }),
    filter: (q) => (q.restaurantId ? eq(restaurantTables.restaurantId, q.restaurantId) : undefined),
    validate: async (tx, t, b) => { await owned(tx, restaurants, b.restaurantId, t, 'restaurant'); await owned(tx, diningAreas, b.diningAreaId, t, 'dining area'); },
  });
  crud(app, {
    ...cfg, path: '/admin/menus', entity: 'menu', table: menus, orderBy: menus.sort,
    body: z.object({ restaurantId: z.string().uuid(), name: z.string().min(2).max(80), description: z.string().max(500).nullable().optional(), availableFrom: hhmm.nullable().optional(), availableTo: hhmm.nullable().optional(), active: z.boolean().default(true), sort: z.number().int().default(0) }),
    filter: (q) => (q.restaurantId ? eq(menus.restaurantId, q.restaurantId) : undefined),
    validate: (tx, t, b) => owned(tx, restaurants, b.restaurantId, t, 'restaurant'),
  });
  crud(app, {
    ...cfg, path: '/admin/menu-categories', entity: 'menu_category', table: menuCategories, orderBy: menuCategories.sort,
    body: z.object({ menuId: z.string().uuid(), name: z.string().min(2).max(80), description: z.string().max(300).nullable().optional(), sort: z.number().int().default(0) }),
    filter: (q) => (q.menuId ? eq(menuCategories.menuId, q.menuId) : undefined),
    validate: (tx, t, b) => owned(tx, menus, b.menuId, t, 'menu'),
  });
  crud(app, {
    ...cfg, path: '/admin/menu-items', entity: 'menu_item', table: menuItems, orderBy: menuItems.sort,
    body: z.object({
      restaurantId: z.string().uuid(), categoryId: z.string().uuid(), name: z.string().min(2).max(100), description: z.string().max(500).nullable().optional(), price: money,
      image: imageRef.nullable().optional(), dietary: z.array(z.enum(['veg', 'non_veg', 'vegan', 'egg', 'gluten_free', 'jain', 'dairy_free'])).default([]),
      allergens: z.array(z.enum(['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'molluscs'])).default([]),
      spiceLevel: z.number().int().min(0).max(3).nullable().optional(), prepMinutes: z.number().int().min(1).max(240).default(15), available: z.boolean().default(true), active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
    filter: (q) => (q.restaurantId ? eq(menuItems.restaurantId, q.restaurantId) : q.categoryId ? eq(menuItems.categoryId, q.categoryId) : undefined),
    validate: async (tx, t, b) => { await owned(tx, restaurants, b.restaurantId, t, 'restaurant'); await owned(tx, menuCategories, b.categoryId, t, 'category'); },
  });
  crud(app, {
    ...cfg, path: '/admin/menu-item-options', entity: 'menu_item_option', table: menuItemVariants, orderBy: menuItemVariants.sort,
    body: z.object({ menuItemId: z.string().uuid(), kind: z.enum(['variant', 'addon']), groupName: z.string().min(2).max(40), name: z.string().min(1).max(60), priceDelta: z.number().int().min(-10_000_00).max(10_000_00).default(0), isDefault: z.boolean().default(false), maxSelect: z.number().int().min(1).nullable().optional(), available: z.boolean().default(true), sort: z.number().int().default(0) }),
    filter: (q) => (q.menuItemId ? eq(menuItemVariants.menuItemId, q.menuItemId) : undefined),
    validate: (tx, t, b) => owned(tx, menuItems, b.menuItemId, t, 'menu item'),
  });
  crud(app, {
    ...cfg, path: '/admin/order-types', entity: 'order_type', table: orderTypes, orderBy: orderTypes.sort,
    body: z.object({
      restaurantId: z.string().uuid(), key: z.string().regex(/^[a-z_]{2,30}$/), name: z.string().min(2).max(60), description: z.string().max(300).nullable().optional(),
      locationMode: z.enum(['room', 'area', 'table', 'pickup', 'custom']), areas: z.array(z.string().max(60)).max(30).default([]), requiresStay: z.boolean().default(false),
      paymentModes: z.array(z.enum(['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property'])).min(1), allowScheduling: z.boolean().default(false),
      cancelWindowMinutes: z.number().int().min(0).max(120).default(5), moduleKey: z.enum(['restaurant.ordering', 'room_service']).default('restaurant.ordering'), active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
    filter: (q) => (q.restaurantId ? eq(orderTypes.restaurantId, q.restaurantId) : undefined),
    validate: (tx, t, b) => owned(tx, restaurants, b.restaurantId, t, 'restaurant'),
  });

  // Quick sold-out toggle for the pass.
  app.put('/admin/menu-items/:id/availability', {
    preHandler: [requireStaff('orders.manage'), requireModule('restaurant')],
    schema: { tags: ['restaurant'], params: idParam, body: z.object({ available: z.boolean() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [i] = await tx.update(menuItems).set({ available: req.body.available }).where(and(eq(menuItems.id, req.params.id), eq(menuItems.tenantId, t.id))).returning();
      if (!i) throw notFound('Menu item');
      await audit(tx, req, { action: req.body.available ? 'menu_item.back_in_stock' : 'menu_item.sold_out', entityType: 'menu_item', entityId: i.id });
      return { data: i };
    });
  });

  app.get('/admin/restaurants/:id/menu', { preHandler: [requireStaff(), requireModule('restaurant')], schema: { tags: ['restaurant'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await loadMenu(tx, t.id, req.params.id) }));
  });

  // ================= Reservations (admin) =================
  const resMod = [requireModule('restaurant.reservations')];
  app.get('/admin/reservations', {
    preHandler: [requireStaff('restaurant.reservations'), ...resMod],
    schema: { tags: ['restaurant'], querystring: z.object({ restaurantId: z.string().uuid().optional(), date: isoDate.optional(), status: z.string().optional(), q: z.string().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const date = req.query.date ?? todayIn(t.timezone);
    const from = zonedTime(date, '00:00', t.timezone);
    const to = zonedTime(addDays(date, 1), '04:00', t.timezone);
    return withTenant(t.id, async (tx) => {
      const statuses = req.query.status?.split(',').filter(Boolean);
      const rows = await tx
        .select({ r: restaurantReservations, tableLabel: restaurantTables.label, restaurantName: restaurants.name, areaName: diningAreas.name, roomNumber: rooms.number })
        .from(restaurantReservations)
        .innerJoin(restaurants, eq(restaurants.id, restaurantReservations.restaurantId))
        .leftJoin(restaurantTables, eq(restaurantTables.id, restaurantReservations.tableId))
        .leftJoin(diningAreas, eq(diningAreas.id, restaurantTables.diningAreaId))
        .leftJoin(sql`stays`, sql`stays.id = ${restaurantReservations.stayId}`)
        .leftJoin(rooms, sql`${rooms.id} = stays.room_id`)
        .where(and(
          eq(restaurantReservations.tenantId, t.id), gte(restaurantReservations.startsAt, from), lt(restaurantReservations.startsAt, to),
          req.query.restaurantId ? eq(restaurantReservations.restaurantId, req.query.restaurantId) : undefined,
          statuses?.length ? inArray(restaurantReservations.status, statuses as never[]) : undefined,
          req.query.q ? or(ilike(restaurantReservations.guestName, `%${req.query.q}%`), ilike(restaurantReservations.reference, `%${req.query.q}%`), ilike(restaurantReservations.guestPhone, `%${req.query.q}%`)) : undefined,
        ))
        .orderBy(asc(restaurantReservations.startsAt));
      const tables = req.query.restaurantId ? await tx.select().from(restaurantTables).where(eq(restaurantTables.restaurantId, req.query.restaurantId)).orderBy(restaurantTables.sort) : [];
      const active = rows.filter((x) => ['confirmed', 'seated', 'completed'].includes(x.r.status));
      return {
        data: rows.map((x) => ({ ...x.r, tableLabel: x.tableLabel, restaurantName: x.restaurantName, areaName: x.areaName, roomNumber: x.roomNumber })),
        tables,
        summary: { date, covers: active.reduce((n, x) => n + x.r.partySize, 0), reservations: active.length, waitlist: rows.filter((x) => x.r.status === 'waitlisted').length, noShows: rows.filter((x) => x.r.status === 'no_show').length },
      };
    });
  });

  app.post('/admin/reservations', {
    preHandler: [requireStaff('restaurant.reservations'), ...resMod],
    schema: {
      tags: ['restaurant'],
      body: z.object({
        restaurantId: z.string().uuid(), startsAt: z.coerce.date(), partySize: z.number().int().min(1).max(100), guestName: z.string().min(2).max(120),
        guestEmail: z.string().email().nullable().optional(), guestPhone: z.string().max(30).nullable().optional(), guestId: z.string().uuid().nullable().optional(),
        tableId: z.string().uuid().nullable().optional(), areaPreferenceId: z.string().uuid().nullable().optional(), specialRequests: z.string().max(500).nullable().optional(),
        occasion: z.string().max(60).nullable().optional(), source: z.enum(['admin', 'phone', 'walk_in']).default('phone'), joinWaitlist: z.boolean().default(false),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const r = await withTenant(t.id, async (tx) => {
      if (req.body.guestId) {
        const [g] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.id, req.body.guestId), eq(guests.tenantId, t.id)));
        if (!g) throw badRequest('Unknown guest');
      }
      const res = await createReservation(tx, t, { ...req.body, createdByUserId: actor.userId });
      await audit(tx, req, { action: 'reservation.create', entityType: 'restaurant_reservation', entityId: res.id });
      return res;
    });
    return reply.status(201).send({ data: r });
  });

  app.patch('/admin/reservations/:id', {
    preHandler: [requireStaff('restaurant.reservations'), ...resMod],
    schema: { tags: ['restaurant'], params: idParam, body: z.object({ startsAt: z.coerce.date().optional(), partySize: z.number().int().min(1).max(100).optional(), tableId: z.string().uuid().nullable().optional(), internalNotes: z.string().max(1000).nullable().optional(), specialRequests: z.string().max(500).nullable().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const r = await updateReservation(tx, t, req.params.id, req.body);
      await audit(tx, req, { action: 'reservation.update', entityType: 'restaurant_reservation', entityId: r.id, changes: req.body });
      return { data: r };
    });
  });

  app.post('/admin/reservations/:id/status', {
    preHandler: [requireStaff('restaurant.reservations'), ...resMod],
    schema: { tags: ['restaurant'], params: idParam, body: z.object({ status: z.enum(['confirmed', 'seated', 'completed', 'cancelled', 'no_show']), tableId: z.string().uuid().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const r = await transitionReservation(tx, t, req.params.id, req.body.status, { tableId: req.body.tableId });
      await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'restaurant_reservation', entityId: r.id, kind: 'status', toValue: req.body.status, actorType: 'user', actorId: staffActor(req).userId });
      await audit(tx, req, { action: `reservation.${req.body.status}`, entityType: 'restaurant_reservation', entityId: r.id });
      return { data: r };
    });
  });

  // ================= Kitchen / order queue =================
  const ordMod = [requireModule('restaurant.ordering')];
  app.get('/admin/orders', {
    preHandler: [requireStaff('orders.manage'), ...ordMod],
    schema: { tags: ['orders'], querystring: z.object({ restaurantId: z.string().uuid().optional(), status: z.string().optional(), date: isoDate.optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const statuses = (req.query.status ?? 'new,accepted,preparing,ready').split(',').filter(Boolean) as OrderStatus[];
      const date = req.query.date;
      const rows = await tx
        .select({ o: orders, typeName: orderTypes.name, restaurantName: restaurants.name, guestName: sql<string | null>`${guests.firstName} || ' ' || ${guests.lastName}`, assignee: users.name })
        .from(orders)
        .innerJoin(orderTypes, eq(orderTypes.id, orders.orderTypeId))
        .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
        .leftJoin(guests, eq(guests.id, orders.guestId))
        .leftJoin(users, eq(users.id, orders.assignedUserId))
        .where(and(
          eq(orders.tenantId, t.id), inArray(orders.status, statuses),
          req.query.restaurantId ? eq(orders.restaurantId, req.query.restaurantId) : undefined,
          date ? and(gte(orders.createdAt, zonedTime(date, '00:00', t.timezone)), lt(orders.createdAt, zonedTime(addDays(date, 1), '00:00', t.timezone))) : undefined,
        ))
        .orderBy(desc(sql`case ${orders.priority} when 'rush' then 2 when 'high' then 1 else 0 end`), asc(sql`coalesce(${orders.scheduledFor}, ${orders.createdAt})`));
      const items = rows.length ? await tx.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.o.id))) : [];
      return { data: rows.map((r) => ({ ...r.o, typeName: r.typeName, restaurantName: r.restaurantName, guestName: r.guestName, assignee: r.assignee, items: items.filter((i) => i.orderId === r.o.id) })) };
    });
  });

  app.get('/admin/orders/:id', { preHandler: [requireStaff('orders.manage'), ...ordMod], schema: { tags: ['orders'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, req.params.id), eq(orders.tenantId, t.id)));
      if (!o) throw notFound('Order');
      return { data: { ...o, items: await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id)), history: await tx.select().from(entityEvents).where(and(eq(entityEvents.entityType, 'order'), eq(entityEvents.entityId, o.id))).orderBy(asc(entityEvents.createdAt)) } };
    });
  });

  app.post('/admin/orders/:id/status', {
    preHandler: [requireStaff('orders.manage'), ...ordMod],
    schema: { tags: ['orders'], params: idParam, body: z.object({ status: z.enum(['accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled']), note: z.string().max(300).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const o = await transitionOrder(tx, t, req.params.id, req.body.status, { type: 'user', id: staffActor(req).userId }, req.body.note);
      await audit(tx, req, { action: `order.${req.body.status}`, entityType: 'order', entityId: o.id });
      return { data: o };
    });
  });

  app.patch('/admin/orders/:id', {
    preHandler: [requireStaff('orders.manage'), ...ordMod],
    schema: { tags: ['orders'], params: idParam, body: z.object({ priority: z.enum(['normal', 'high', 'rush']).optional(), assignedUserId: z.string().uuid().nullable().optional(), kitchenNotes: z.string().max(500).nullable().optional(), estimatedReadyAt: z.coerce.date().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      if (req.body.assignedUserId) {
        const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, req.body.assignedUserId), eq(users.tenantId, t.id)));
        if (!u) throw badRequest('Unknown staff member');
      }
      const [o] = await tx.update(orders).set(req.body).where(and(eq(orders.id, req.params.id), eq(orders.tenantId, t.id))).returning();
      if (!o) throw notFound('Order');
      const kind = req.body.priority ? 'priority' : req.body.assignedUserId !== undefined ? 'assignment' : 'note';
      await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'order', entityId: o.id, kind, body: req.body.kitchenNotes ?? req.body.priority ?? null, actorType: 'user', actorId: staffActor(req).userId });
      return { data: o };
    });
  });

  // ================= Public (website) =================
  const pub = [resolvePublicTenant, requireModule('restaurant')];
  app.get('/public/restaurants', { preHandler: pub, schema: { tags: ['restaurant'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const rs = await tx.select().from(restaurants).where(and(eq(restaurants.tenantId, t.id), eq(restaurants.active, true))).orderBy(restaurants.sort);
      const hours = rs.length ? await tx.select().from(restaurantHours).where(inArray(restaurantHours.restaurantId, rs.map((r) => r.id))).orderBy(restaurantHours.dayOfWeek, restaurantHours.opens) : [];
      const areas = rs.length ? await tx.select().from(diningAreas).where(inArray(diningAreas.restaurantId, rs.map((r) => r.id))).orderBy(diningAreas.sort) : [];
      return {
        data: rs.map((r) => ({
          id: r.id, name: r.name, slug: r.slug, kind: r.kind, description: r.description, cuisine: r.cuisine, dietaryInfo: r.dietaryInfo, location: r.location, phone: r.phone, images: r.images,
          acceptsReservations: r.acceptsReservations && t.modules.has('restaurant.reservations'), maxPartySize: r.settings.maxPartySize,
          hours: hours.filter((h) => h.restaurantId === r.id), areas: areas.filter((a) => a.restaurantId === r.id).map((a) => ({ id: a.id, name: a.name })),
        })),
      };
    });
  });

  app.get('/public/restaurants/:id/menu', { preHandler: pub, schema: { tags: ['restaurant'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await loadMenu(tx, t.id, req.params.id) }));
  });

  app.get('/public/restaurants/:id/slots', {
    preHandler: [resolvePublicTenant, requireModule('restaurant.reservations')],
    schema: { tags: ['restaurant'], params: idParam, querystring: z.object({ date: isoDate, partySize: z.coerce.number().int().min(1).max(50) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [r] = await tx.select().from(restaurants).where(and(eq(restaurants.id, req.params.id), eq(restaurants.tenantId, t.id), eq(restaurants.active, true)));
      if (!r) throw notFound('Restaurant');
      return { data: await slotsFor(tx, t, r, req.query.date, req.query.partySize) };
    });
  });

  app.post('/public/restaurants/:id/reservations', {
    preHandler: [resolvePublicTenant, requireModule('restaurant.reservations')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['restaurant'], params: idParam,
      body: z.object({
        startsAt: z.coerce.date(), partySize: z.number().int().min(1).max(50), guestName: z.string().min(2).max(120), guestEmail: z.string().email(), guestPhone: z.string().min(6).max(30),
        areaPreferenceId: z.string().uuid().nullable().optional(), occasion: z.string().max(60).optional(), specialRequests: z.string().max(500).optional(), joinWaitlist: z.boolean().default(false),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const guestId = req.actor.type === 'guest' ? req.actor.guestId : null;
    const r = await withTenant(t.id, (tx) => createReservation(tx, t, { ...req.body, restaurantId: req.params.id, guestId, source: 'website' }));
    return reply.status(201).send({ data: { id: r.id, reference: r.reference, status: r.status, startsAt: r.startsAt, partySize: r.partySize } });
  });
};
