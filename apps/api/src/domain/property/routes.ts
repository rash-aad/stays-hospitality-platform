import {
  addOns, availability, coupons, promotions, properties, ratePlans, rateSeasons, rooms, roomTypes, taxes,
} from '@hp/db';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { crud, hhmm, imageRef, isoDate, money } from '../../http/crud.js';
import { badRequest, notFound } from '../../http/errors.js';
import { requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, nightsBetween } from '../../lib/dates.js';
import { ensureLedger, resyncTotals } from '../bookings/inventory.js';
import { eachNight, nightlyBase } from '../bookings/pricing.js';

const slug = z.string().regex(/^[a-z0-9-]{2,60}$/);

async function assertOwned(tx: Tx, table: typeof properties | typeof roomTypes | typeof ratePlans, id: string, tenantId: string, what: string) {
  const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  if (!row) throw badRequest(`Unknown ${what}`);
}

export const propertyRoutes: Routes = async (app) => {
  // ----- Property profile -----
  app.get('/admin/properties', { preHandler: requireStaff(), schema: { tags: ['property'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tx.select().from(properties).where(eq(properties.tenantId, t.id)).orderBy(properties.name) }));
  });

  app.patch('/admin/properties/:id', {
    preHandler: requireStaff('property.manage'),
    schema: {
      tags: ['property'], params: z.object({ id: z.string().uuid() }),
      body: z.object({
        name: z.string().min(2).max(120), tagline: z.string().max(200).nullable(), description: z.string().max(5000).nullable(),
        addressLine: z.string().max(200).nullable(), city: z.string().max(80).nullable(), region: z.string().max(80).nullable(), country: z.string().length(2),
        postalCode: z.string().max(20).nullable(), phone: z.string().max(30).nullable(), email: z.string().email().nullable(), timezone: z.string(),
        checkInTime: hhmm, checkOutTime: hhmm, latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
        starRating: z.number().int().min(1).max(7).nullable(), images: z.array(imageRef).max(30), amenities: z.array(z.string().max(60)).max(60),
      }).partial(),
    },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.update(properties).set(req.body).where(and(eq(properties.id, req.params.id), eq(properties.tenantId, t.id))).returning();
      if (!p) throw notFound('Property');
      await audit(tx, req, { action: 'property.update', entityType: 'property', entityId: p.id, changes: req.body });
      return { data: p };
    });
  });

  // ----- Room types -----
  crud(app, {
    path: '/admin/room-types', entity: 'room_type', table: roomTypes, permission: 'property.manage', readPermission: 'bookings.read', tag: 'property', orderBy: roomTypes.sort,
    body: z.object({
      propertyId: z.string().uuid(), name: z.string().min(2).max(80), slug, description: z.string().max(3000).nullable().optional(),
      baseOccupancy: z.number().int().min(1).max(12), maxOccupancy: z.number().int().min(1).max(16), maxAdults: z.number().int().min(1).max(16),
      maxChildren: z.number().int().min(0).max(10), bedConfig: z.string().max(80).nullable().optional(), sizeSqm: z.number().int().min(5).max(2000).nullable().optional(),
      view: z.string().max(80).nullable().optional(), amenities: z.array(z.string().max(60)).max(40).default([]), images: z.array(imageRef).max(20).default([]),
      sort: z.number().int().default(0), active: z.boolean().default(true),
    }),
    validate: async (tx, tenantId, body) => { if (body.propertyId) await assertOwned(tx, properties, body.propertyId as string, tenantId, 'property'); },
  });

  // ----- Rooms -----
  crud(app, {
    path: '/admin/rooms', entity: 'room', table: rooms, permission: 'property.manage', readPermission: 'bookings.read', tag: 'property', orderBy: rooms.number,
    body: z.object({
      propertyId: z.string().uuid(), roomTypeId: z.string().uuid(), number: z.string().min(1).max(10), floor: z.string().max(10).nullable().optional(),
      status: z.enum(['active', 'out_of_service']).default('active'), notes: z.string().max(500).nullable().optional(),
    }),
    filter: (q) => (q.roomTypeId ? eq(rooms.roomTypeId, q.roomTypeId) : undefined),
    validate: async (tx, tenantId, body) => {
      if (body.propertyId) await assertOwned(tx, properties, body.propertyId as string, tenantId, 'property');
      if (body.roomTypeId) await assertOwned(tx, roomTypes, body.roomTypeId as string, tenantId, 'room type');
    },
    afterWrite: async (tx, _tenantId, row) => resyncTotals(tx, row.roomTypeId as string),
  });

  // ----- Rate plans & seasons -----
  const policy = z.object({ freeUntilHours: z.number().int().min(0).max(24 * 60), penaltyPercent: z.number().int().min(0).max(100), label: z.string().max(200) });
  crud(app, {
    path: '/admin/rate-plans', entity: 'rate_plan', table: ratePlans, permission: 'property.manage', readPermission: 'bookings.read', tag: 'rates', orderBy: ratePlans.basePrice,
    body: z.object({
      roomTypeId: z.string().uuid(), name: z.string().min(2).max(80), code: z.string().regex(/^[A-Z0-9_-]{2,20}$/), description: z.string().max(1000).nullable().optional(),
      mealPlan: z.enum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive']).default('room_only'),
      basePrice: money, weekendPrice: money.nullable().optional(), extraAdultPrice: money.default(0), extraChildPrice: money.default(0),
      refundable: z.boolean().default(true), cancellationPolicy: policy.optional(), minStay: z.number().int().min(1).max(30).default(1),
      maxStay: z.number().int().min(1).max(365).default(30), active: z.boolean().default(true),
    }),
    filter: (q) => (q.roomTypeId ? eq(ratePlans.roomTypeId, q.roomTypeId) : undefined),
    validate: async (tx, tenantId, body) => { if (body.roomTypeId) await assertOwned(tx, roomTypes, body.roomTypeId as string, tenantId, 'room type'); },
  });

  crud(app, {
    path: '/admin/rate-seasons', entity: 'rate_season', table: rateSeasons, permission: 'property.manage', readPermission: 'bookings.read', tag: 'rates', orderBy: rateSeasons.startDate,
    body: z.object({ ratePlanId: z.string().uuid(), name: z.string().min(2).max(80), startDate: isoDate, endDate: isoDate, price: money, minStay: z.number().int().min(1).max(30).nullable().optional() }),
    filter: (q) => (q.ratePlanId ? eq(rateSeasons.ratePlanId, q.ratePlanId) : undefined),
    validate: async (tx, tenantId, body) => {
      if (body.ratePlanId) await assertOwned(tx, ratePlans, body.ratePlanId as string, tenantId, 'rate plan');
      if (body.startDate && body.endDate && (body.endDate as string) < (body.startDate as string)) throw badRequest('Season ends before it starts');
    },
  });

  // ----- Taxes, coupons, promotions, add-ons -----
  crud(app, {
    path: '/admin/taxes', entity: 'tax', table: taxes, permission: 'property.manage', readPermission: 'bookings.read', tag: 'rates', orderBy: taxes.name,
    body: z.object({
      name: z.string().min(2).max(60), appliesTo: z.enum(['room', 'food', 'service', 'experience']), rateBps: z.number().int().min(0).max(5000),
      minAmount: money.nullable().optional(), maxAmount: money.nullable().optional(), inclusive: z.boolean().default(false), active: z.boolean().default(true),
    }),
  });
  crud(app, {
    path: '/admin/coupons', entity: 'coupon', table: coupons, permission: 'property.manage', readPermission: 'bookings.read', tag: 'offers', orderBy: coupons.code,
    body: z.object({
      code: z.string().regex(/^[A-Za-z0-9_-]{3,30}$/).transform((s) => s.toUpperCase()), description: z.string().max(300).nullable().optional(),
      discountType: z.enum(['percent', 'fixed']), value: z.number().int().min(1), minNights: z.number().int().min(1).default(1),
      validFrom: isoDate.nullable().optional(), validTo: isoDate.nullable().optional(), maxRedemptions: z.number().int().min(1).nullable().optional(), active: z.boolean().default(true),
    }),
    validate: async (_tx, _tenantId, body) => {
      if (body.discountType === 'percent' && typeof body.value === 'number' && body.value > 100) throw badRequest('Percent discounts cannot exceed 100');
    },
  });
  crud(app, {
    path: '/admin/promotions', entity: 'promotion', table: promotions, permission: 'content.manage', tag: 'offers', modules: ['offers'], orderBy: promotions.sort,
    body: z.object({
      title: z.string().min(2).max(120), summary: z.string().max(300).nullable().optional(), body: z.string().max(3000).nullable().optional(),
      image: imageRef.nullable().optional(), couponId: z.string().uuid().nullable().optional(), startsAt: z.coerce.date().nullable().optional(),
      endsAt: z.coerce.date().nullable().optional(), showInPortal: z.boolean().default(true), active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
  });
  crud(app, {
    path: '/admin/add-ons', entity: 'add_on', table: addOns, permission: 'property.manage', readPermission: 'bookings.read', tag: 'rates', orderBy: addOns.name,
    body: z.object({
      propertyId: z.string().uuid(), name: z.string().min(2).max(80), description: z.string().max(500).nullable().optional(), price: money,
      per: z.enum(['stay', 'night', 'guest', 'guest_night']).default('stay'), active: z.boolean().default(true),
    }),
    validate: async (tx, tenantId, body) => { if (body.propertyId) await assertOwned(tx, properties, body.propertyId as string, tenantId, 'property'); },
  });

  // ----- Availability calendar -----
  app.get('/admin/availability', {
    preHandler: requireStaff('bookings.read'),
    schema: { tags: ['rates'], querystring: z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(62).default(14) }) },
  }, async (req) => {
    const t = tenantOf(req);
    const to = addDays(req.query.from, req.query.days);
    return withTenant(t.id, async (tx) => {
      const types = await tx.select().from(roomTypes).where(and(eq(roomTypes.tenantId, t.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sort));
      const dates = eachNight(req.query.from, to);
      for (const rt of types) await ensureLedger(tx, t.id, rt.id, dates);
      const ledger = await tx.select().from(availability).where(and(eq(availability.tenantId, t.id), gte(availability.date, req.query.from), lt(availability.date, to)));
      const plans = await tx.select().from(ratePlans).where(and(eq(ratePlans.tenantId, t.id), eq(ratePlans.active, true)));
      const seasons = plans.length ? await tx.select().from(rateSeasons).where(inArray(rateSeasons.ratePlanId, plans.map((p) => p.id))) : [];
      return {
        data: {
          dates,
          roomTypes: types.map((rt) => {
            const plan = plans.filter((p) => p.roomTypeId === rt.id).sort((a, b) => a.basePrice - b.basePrice)[0];
            return {
              id: rt.id, name: rt.name,
              days: dates.map((d) => {
                const l = ledger.find((x) => x.roomTypeId === rt.id && x.date === d);
                return {
                  date: d, total: l?.total ?? 0, booked: l?.booked ?? 0, closed: l?.closed ?? false, closedToArrival: l?.closedToArrival ?? false, minStay: l?.minStay ?? null,
                  price: plan ? nightlyBase(d, plan, seasons.filter((s) => s.ratePlanId === plan.id)) : null,
                };
              }),
            };
          }),
        },
      };
    });
  });

  app.patch('/admin/availability', {
    preHandler: requireStaff('property.manage'),
    schema: {
      tags: ['rates'],
      body: z.object({
        roomTypeId: z.string().uuid(), from: isoDate, to: isoDate,
        closed: z.boolean().optional(), closedToArrival: z.boolean().optional(), minStay: z.number().int().min(1).max(30).nullable().optional(),
        total: z.number().int().min(0).max(1000).optional(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    const { roomTypeId, from, to, ...patch } = req.body;
    if (to < from || nightsBetween(from, to) > 366) throw badRequest('Invalid date range');
    return withTenant(t.id, async (tx) => {
      await assertOwned(tx, roomTypes, roomTypeId, t.id, 'room type');
      const dates = eachNight(from, addDays(to, 1));
      await ensureLedger(tx, t.id, roomTypeId, dates);
      // Never allow total below what is already sold.
      const set: Record<string, unknown> = { ...patch };
      if (patch.total !== undefined) set.total = sql`greatest(${patch.total}, ${availability.booked})`;
      await tx.update(availability).set(set).where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates)));
      await audit(tx, req, { action: 'availability.update', entityType: 'room_type', entityId: roomTypeId, changes: req.body });
      return { ok: true };
    });
  });
};
