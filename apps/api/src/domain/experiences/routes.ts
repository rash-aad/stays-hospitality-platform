import { experienceBookings, experiences, experienceSlots, guests } from '@hp/db';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { crud, imageRef, isoDate, money } from '../../http/crud.js';
import { badRequest, notFound } from '../../http/errors.js';
import { requireAnyModule, requireStaff, resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayIn, zonedTime } from '../../lib/dates.js';
import { cancelExperienceBooking, moduleForKind } from './service.js';

const anyExp = requireAnyModule('experiences', 'spa', 'transport');

export const experienceRoutes: Routes = async (app) => {
  crud(app, {
    path: '/admin/experiences', entity: 'experience', table: experiences, permission: 'experiences.manage', tag: 'experiences', orderBy: experiences.sort, anyModules: ['experiences', 'spa', 'transport'],
    body: z.object({
      propertyId: z.string().uuid(), kind: z.enum(['activity', 'tour', 'spa', 'transfer', 'dining', 'class']), name: z.string().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
      summary: z.string().max(300).nullable().optional(), description: z.string().max(4000).nullable().optional(), images: z.array(imageRef).max(12).default([]),
      durationMinutes: z.number().int().min(10).max(24 * 60), price: money.default(0), pricePer: z.enum(['person', 'booking']).default('person'),
      maxParticipants: z.number().int().min(1).max(100).default(1), location: z.string().max(120).nullable().optional(), requiresPayment: z.boolean().default(false),
      bookableByGuests: z.boolean().default(true), active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
    validate: async (_tx, _t, b) => { if (b.kind) void moduleForKind(b.kind as string); },
  });

  /** Generate slots over a date range at fixed times (e.g. 07:00, 16:30 daily). */
  app.post('/admin/experiences/:id/slots', {
    preHandler: [requireStaff('experiences.manage'), anyExp],
    schema: { tags: ['experiences'], params: z.object({ id: z.string().uuid() }), body: z.object({ from: isoDate, to: isoDate, times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(12), capacity: z.number().int().min(1).max(500), weekdays: z.array(z.number().int().min(0).max(6)).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const b = req.body;
    if (b.to < b.from || b.to > addDays(b.from, 180)) throw badRequest('Choose up to 180 days');
    const n = await withTenant(t.id, async (tx) => {
      const [exp] = await tx.select().from(experiences).where(and(eq(experiences.id, req.params.id), eq(experiences.tenantId, t.id)));
      if (!exp) throw notFound('Experience');
      const rows = [];
      for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
        if (b.weekdays && !b.weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) continue;
        for (const time of b.times) {
          const start = zonedTime(d, time, t.timezone);
          rows.push({ tenantId: t.id, experienceId: exp.id, startsAt: start, endsAt: new Date(start.getTime() + exp.durationMinutes * 60_000), capacity: b.capacity });
        }
      }
      if (rows.length) await tx.insert(experienceSlots).values(rows);
      await audit(tx, req, { action: 'experience.slots_generate', entityType: 'experience', entityId: exp.id, changes: { count: rows.length } });
      return rows.length;
    });
    return reply.status(201).send({ data: { created: n } });
  });

  app.get('/admin/experience-schedule', {
    preHandler: [requireStaff('experiences.manage'), anyExp],
    schema: { tags: ['experiences'], querystring: z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(31).default(7) }) },
  }, async (req) => {
    const t = tenantOf(req);
    const from = req.query.from ?? todayIn(t.timezone);
    return withTenant(t.id, async (tx) => {
      const slots = await tx.select({ s: experienceSlots, name: experiences.name, kind: experiences.kind }).from(experienceSlots).innerJoin(experiences, eq(experiences.id, experienceSlots.experienceId))
        .where(and(eq(experienceSlots.tenantId, t.id), gte(experienceSlots.startsAt, zonedTime(from, '00:00', t.timezone)), lt(experienceSlots.startsAt, zonedTime(addDays(from, req.query.days), '00:00', t.timezone))))
        .orderBy(asc(experienceSlots.startsAt));
      const bookings = slots.length ? await tx.select({ b: experienceBookings, guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}` }).from(experienceBookings).innerJoin(guests, eq(guests.id, experienceBookings.guestId)).where(inArray(experienceBookings.slotId, slots.map((s) => s.s.id))) : [];
      return { data: slots.map((s) => ({ ...s.s, experienceName: s.name, kind: s.kind, bookings: bookings.filter((b) => b.b.slotId === s.s.id).map((b) => ({ ...b.b, guestName: b.guestName })) })) };
    });
  });

  app.patch('/admin/experience-slots/:id', {
    preHandler: [requireStaff('experiences.manage'), anyExp],
    schema: { tags: ['experiences'], params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['open', 'closed']).optional(), capacity: z.number().int().min(1).max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const set: Record<string, unknown> = { ...req.body };
      if (req.body.capacity) set.capacity = sql`greatest(${req.body.capacity}, ${experienceSlots.booked})`;
      const [s] = await tx.update(experienceSlots).set(set).where(and(eq(experienceSlots.id, req.params.id), eq(experienceSlots.tenantId, t.id))).returning();
      if (!s) throw notFound('Slot');
      return { data: s };
    });
  });

  app.post('/admin/experience-bookings/:id/status', {
    preHandler: [requireStaff('experiences.manage'), anyExp],
    schema: { tags: ['experiences'], params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['confirmed', 'completed', 'no_show', 'cancelled']) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      if (req.body.status === 'cancelled') return { data: await cancelExperienceBooking(tx, t, req.params.id, {}) };
      const [eb] = await tx.update(experienceBookings).set({ status: req.body.status }).where(and(eq(experienceBookings.id, req.params.id), eq(experienceBookings.tenantId, t.id))).returning();
      if (!eb) throw notFound('Booking');
      await audit(tx, req, { action: `experience_booking.${req.body.status}`, entityType: 'experience_booking', entityId: eb.id });
      return { data: eb };
    });
  });

  // ----- Public catalog (website + portal) -----
  app.get('/public/experiences', { preHandler: [resolvePublicTenant, anyExp], schema: { tags: ['experiences'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const rows = await tx.select().from(experiences).where(and(eq(experiences.tenantId, t.id), eq(experiences.active, true))).orderBy(asc(experiences.sort));
      return { data: rows.filter((e) => t.modules.has(moduleForKind(e.kind))) };
    });
  });

  app.get('/public/experiences/:id/slots', {
    preHandler: [resolvePublicTenant, anyExp],
    schema: { tags: ['experiences'], params: z.object({ id: z.string().uuid() }), querystring: z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(31).default(14) }) },
  }, async (req) => {
    const t = tenantOf(req);
    const from = req.query.from ?? todayIn(t.timezone);
    return withTenant(t.id, async (tx) => {
      const slots = await tx.select().from(experienceSlots).where(and(
        eq(experienceSlots.experienceId, req.params.id), eq(experienceSlots.tenantId, t.id), eq(experienceSlots.status, 'open'),
        gte(experienceSlots.startsAt, new Date(Math.max(Date.now() + 30 * 60_000, zonedTime(from, '00:00', t.timezone).getTime()))),
        lt(experienceSlots.startsAt, zonedTime(addDays(from, req.query.days), '00:00', t.timezone)),
      )).orderBy(asc(experienceSlots.startsAt));
      return { data: slots.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, remaining: s.capacity - s.booked })) };
    });
  });
};

