import { bookingItems, bookings, entityEvents, folioCharges, guests, invoices, payments, rooms, stays } from '@hp/db';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate, money } from '../../http/crud.js';
import { notFound } from '../../http/errors.js';
import { requireModule, requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import { moveBooking, tapeChart } from './tape-chart.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { todayIn } from '../../lib/dates.js';
import { idempotent } from '../../lib/idempotency.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { issueAccessLink } from '../guests/access.js';
import { runtimeConfig } from '../../runtime.js';
import {
  assignableRooms, assignRoom, cancelBooking, checkIn, checkOut, createBooking, generateInvoice, markNoShow, modifyBooking,
} from './service.js';

const idParam = z.object({ id: z.string().uuid() });

export const adminBookingRoutes: Routes = async (app) => {
  app.addHook('preHandler', requireModule('room_booking'));

  app.get('/admin/bookings', {
    preHandler: requireStaff('bookings.read'),
    schema: {
      tags: ['bookings'],
      querystring: pageQuery.extend({
        status: z.string().optional(),
        view: z.enum(['all', 'arrivals', 'departures', 'in_house', 'upcoming', 'pending_payment']).default('all'),
        from: isoDate.optional(), to: isoDate.optional(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    const q = req.query;
    return withTenant(t.id, async (tx) => {
      const today = todayIn(t.timezone);
      const statuses = q.status?.split(',').filter(Boolean) as (typeof bookings.$inferSelect.status)[] | undefined;
      const view = {
        all: undefined,
        arrivals: and(eq(bookings.checkIn, q.from ?? today), inArray(bookings.status, ['confirmed', 'checked_in', 'pending_payment'])),
        departures: and(eq(bookings.checkOut, q.from ?? today), inArray(bookings.status, ['checked_in', 'checked_out'])),
        in_house: eq(bookings.status, 'checked_in'),
        upcoming: and(gte(bookings.checkIn, today), inArray(bookings.status, ['confirmed', 'pending_payment'])),
        pending_payment: eq(bookings.status, 'pending_payment'),
      }[q.view];
      const where = and(
        eq(bookings.tenantId, t.id), view,
        statuses?.length ? inArray(bookings.status, statuses) : undefined,
        q.view === 'all' && q.from ? gte(bookings.checkOut, q.from) : undefined,
        q.view === 'all' && q.to ? lte(bookings.checkIn, q.to) : undefined,
        q.q ? or(ilike(bookings.reference, `%${q.q}%`), ilike(guests.email, `%${q.q}%`), ilike(sql`${guests.firstName} || ' ' || ${guests.lastName}`, `%${q.q}%`), ilike(guests.phone, `%${q.q}%`)) : undefined,
      );
      const rows = await tx
        .select({
          b: bookings, guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`, guestEmail: guests.email, guestPhone: guests.phone,
          roomType: bookingItems.description, roomNumber: rooms.number,
        })
        .from(bookings)
        .innerJoin(guests, eq(guests.id, bookings.guestId))
        .leftJoin(bookingItems, and(eq(bookingItems.bookingId, bookings.id), eq(bookingItems.kind, 'room')))
        .leftJoin(stays, eq(stays.bookingId, bookings.id))
        .leftJoin(rooms, eq(rooms.id, stays.roomId))
        .where(where)
        .orderBy(q.view === 'departures' ? asc(rooms.number) : q.view === 'all' ? desc(bookings.createdAt) : asc(bookings.checkIn))
        .limit(q.pageSize).offset(offset(q));
      const [{ n }] = (await tx.select({ n: count() }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId)).where(where)) as [{ n: number }];
      return { data: rows.map((r) => ({ ...r.b, guestName: r.guestName, guestEmail: r.guestEmail, guestPhone: r.guestPhone, roomType: r.roomType, roomNumber: r.roomNumber })), meta: pageMeta(q, n) };
    });
  });

  app.get('/admin/bookings/:id', { preHandler: requireStaff('bookings.read'), schema: { tags: ['bookings'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id)));
      if (!b) throw notFound('Booking');
      const [guest] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
      const items = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id));
      const [stay] = await tx.select({ s: stays, roomNumber: rooms.number }).from(stays).leftJoin(rooms, eq(rooms.id, stays.roomId)).where(eq(stays.bookingId, b.id));
      const pays = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id))).orderBy(desc(payments.createdAt));
      const charges = await tx.select().from(folioCharges).where(and(eq(folioCharges.bookingId, b.id), isNull(folioCharges.voidedAt))).orderBy(desc(folioCharges.createdAt));
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.bookingId, b.id)).orderBy(desc(invoices.createdAt)).limit(1);
      const history = await tx.select().from(entityEvents).where(and(eq(entityEvents.entityType, 'booking'), eq(entityEvents.entityId, b.id))).orderBy(desc(entityEvents.createdAt));
      const roomItem = items.find((i) => i.kind === 'room');
      const freeRooms = roomItem?.roomTypeId && ['confirmed', 'pending_payment'].includes(b.status) ? await assignableRooms(tx, b, roomItem.roomTypeId) : [];
      return { data: { booking: b, guest, items, stay: stay ? { ...stay.s, roomNumber: stay.roomNumber } : null, payments: pays, folio: charges, invoice: invoice ?? null, history, assignableRooms: freeRooms.map((r) => ({ id: r.id, number: r.number, housekeepingStatus: r.housekeepingStatus })) } };
    });
  });

  app.post('/admin/bookings', {
    preHandler: requireStaff('bookings.write'),
    schema: {
      tags: ['bookings'],
      body: z.object({
        roomTypeId: z.string().uuid(), ratePlanId: z.string().uuid(), checkIn: isoDate, checkOut: isoDate,
        adults: z.number().int().min(1).max(16), children: z.number().int().min(0).max(10).default(0), couponCode: z.string().max(30).nullable().optional(),
        addOnIds: z.array(z.string().uuid()).optional(),
        guest: z.union([
          z.object({ guestId: z.string().uuid() }),
          z.object({ email: z.string().email(), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().max(30).optional() }),
        ]),
        paymentMethod: z.enum(['upi_manual', 'upi_gateway', 'pay_at_property']).default('pay_at_property'),
        source: z.enum(['admin', 'phone', 'walk_in', 'ota', 'agent']).default('phone'),
        specialRequests: z.string().max(1000).optional(),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const r = await idempotent(req, t.id, 'admin.booking.create', async () => {
      const out = await withTenant(t.id, async (tx) => {
        const res = await createBooking(tx, t, { ...req.body, createdByUserId: actor.userId });
        await audit(tx, req, { action: 'booking.create', entityType: 'booking', entityId: res.booking.id, changes: { reference: res.booking.reference, source: req.body.source } });
        return res;
      });
      return { status: 201, body: { data: { booking: out.booking, instructions: out.instructions } } };
    });
    return reply.status(r.status).send(r.body);
  });

  app.patch('/admin/bookings/:id', {
    preHandler: requireStaff('bookings.write'),
    schema: {
      tags: ['bookings'], params: idParam,
      body: z.object({
        checkIn: isoDate.optional(), checkOut: isoDate.optional(), adults: z.number().int().min(1).optional(), children: z.number().int().min(0).optional(),
        roomTypeId: z.string().uuid().optional(), ratePlanId: z.string().uuid().optional(), specialRequests: z.string().max(1000).nullable().optional(), arrivalTime: z.string().max(20).nullable().optional(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id)));
      if (!b) throw notFound('Booking');
      const { specialRequests, arrivalTime, ...stay } = req.body;
      if (specialRequests !== undefined || arrivalTime !== undefined) await tx.update(bookings).set({ specialRequests, arrivalTime }).where(eq(bookings.id, b.id));
      let result: Awaited<ReturnType<typeof modifyBooking>> | null = null;
      if (Object.keys(stay).length) {
        result = await modifyBooking(tx, t, b.id, { checkIn: stay.checkIn ?? b.checkIn, checkOut: stay.checkOut ?? b.checkOut, adults: stay.adults ?? b.adults, children: stay.children ?? b.children, roomTypeId: stay.roomTypeId, ratePlanId: stay.ratePlanId });
        await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'booking', entityId: b.id, kind: 'update', body: `Stay changed: ${b.checkIn}→${b.checkOut} to ${result.booking.checkIn}→${result.booking.checkOut}`, actorType: 'user', actorId: staffActor(req).userId });
      }
      await audit(tx, req, { action: 'booking.modify', entityType: 'booking', entityId: b.id, changes: req.body });
      return { data: result ?? { booking: (await tx.select().from(bookings).where(eq(bookings.id, b.id)))[0] } };
    });
  });

  const action = (name: string, run: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], t: ReturnType<typeof tenantOf>, id: string, body: Record<string, unknown>) => Promise<unknown>, body = z.object({}).passthrough()) =>
    app.post(`/admin/bookings/:id/${name}`, { preHandler: requireStaff('bookings.write'), schema: { tags: ['bookings'], params: idParam, body } }, async (req) => {
      const t = tenantOf(req);
      return withTenant(t.id, async (tx) => {
        const out = await run(tx, t, req.params.id, (req.body ?? {}) as Record<string, unknown>);
        await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'booking', entityId: req.params.id, kind: 'status', toValue: name, actorType: 'user', actorId: staffActor(req).userId, body: typeof req.body === 'object' && req.body && 'reason' in req.body ? String((req.body as { reason?: string }).reason ?? '') : null });
        await audit(tx, req, { action: `booking.${name.replace('-', '_')}`, entityType: 'booking', entityId: req.params.id, changes: req.body as Record<string, unknown> });
        return { data: out };
      });
    });

  action('cancel', (tx, t, id, b) => cancelBooking(tx, t, id, { by: 'staff', reason: b.reason as string | undefined, waiveFee: !!b.waiveFee }), z.object({ reason: z.string().max(300).optional(), waiveFee: z.boolean().default(false) }));
  action('check-in', (tx, t, id, b) => checkIn(tx, t, id, (b.roomId as string | undefined) ?? undefined), z.object({ roomId: z.string().uuid().optional() }));
  action('check-out', (tx, t, id) => checkOut(tx, t, id));
  action('no-show', (tx, t, id) => markNoShow(tx, t, id));
  action('assign-room', (tx, t, id, b) => assignRoom(tx, t, id, (b.roomId as string) ?? null), z.object({ roomId: z.string().uuid().nullable() }));
  action('invoice', (tx, t, id, b) => generateInvoice(tx, t, id, !!b.issue), z.object({ issue: z.boolean().default(false) }));
  action('send-access-link', async (tx, t, id) => {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.tenantId, t.id)));
    if (!b) throw notFound('Booking');
    const [g] = await tx.select().from(guests).where(eq(guests.id, b.guestId));
    await issueAccessLink(tx, t, g!, b, runtimeConfig().WEB_PUBLIC_URL);
    return { sent: true };
  });

  /** Post a manual charge to the folio (minibar, laundry, damages…). */
  app.post('/admin/bookings/:id/charges', {
    preHandler: requireStaff('bookings.write'),
    schema: { tags: ['bookings'], params: idParam, body: z.object({ description: z.string().min(2).max(200), amount: money, taxAmount: money.default(0) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const c = await withTenant(t.id, async (tx) => {
      const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id)));
      if (!b) throw notFound('Booking');
      const [c] = await tx.insert(folioCharges).values({ tenantId: t.id, bookingId: b.id, sourceType: 'manual', ...req.body }).returning();
      await audit(tx, req, { action: 'folio.charge', entityType: 'booking', entityId: b.id, changes: req.body });
      return c;
    });
    return reply.status(201).send({ data: c });
  });

  app.delete('/admin/bookings/:id/charges/:chargeId', {
    preHandler: requireStaff('bookings.write'),
    schema: { tags: ['bookings'], params: z.object({ id: z.string().uuid(), chargeId: z.string().uuid() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [c] = await tx.update(folioCharges).set({ voidedAt: new Date() }).where(and(eq(folioCharges.id, req.params.chargeId), eq(folioCharges.bookingId, req.params.id), eq(folioCharges.tenantId, t.id))).returning();
      if (!c) throw notFound('Charge');
      await audit(tx, req, { action: 'folio.void', entityType: 'booking', entityId: req.params.id, changes: { chargeId: c.id, amount: c.amount } });
      return { ok: true };
    });
  });

  // ---------------- Tape chart ----------------
  app.get('/admin/tape-chart', {
    preHandler: requireStaff('bookings.read'),
    schema: { tags: ['bookings'], querystring: z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(42).default(14) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tapeChart(tx, t, req.query.from, req.query.days) }));
  });

  app.post('/admin/bookings/:id/move', {
    preHandler: requireStaff('bookings.write'),
    schema: {
      tags: ['bookings'], params: z.object({ id: z.string().uuid() }),
      body: z.object({ roomId: z.string().uuid().nullish(), checkIn: isoDate.optional(), checkOut: isoDate.optional(), pricing: z.enum(['reprice', 'keep']).default('reprice') }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    const a = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const b = await moveBooking(tx, t, req.params.id, req.body, a.userId);
      await audit(tx, req, { action: 'booking.move', entityType: 'booking', entityId: b.id, changes: req.body });
      return { data: b };
    });
  });
};
