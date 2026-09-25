import {
  bookingItems, bookings, entityEvents, experienceBookings, experiences, experienceSlots, guestMessages, guests, invoices, notifications, orderItems, orders,
  orderTypes, payments, promotions, properties, restaurantReservations, restaurants, rooms, serviceRequests, serviceRequestTypes,
} from '@hp/db';
import type { ModuleKey } from '@hp/contracts';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { guestActor, requireGuest, requireModule, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { idempotent } from '../../lib/idempotency.js';
import { cancelBooking, generateInvoice } from '../bookings/service.js';
import { bookExperience, cancelExperienceBooking, moduleForKind } from '../experiences/service.js';
import { resolveStayContext } from '../guests/access.js';
import { notify } from '../notifications/notify.js';
import { placeOrder, transitionOrder } from '../orders/service.js';
import { enabledMethods, getSettings, instructionsFor, submitUtr } from '../payments/service.js';
import { createRequest, guestLabel, transitionRequest, workflowOf, addRequestNote } from '../requests/service.js';
import { createReservation, transitionReservation } from '../restaurant/reservations.js';

const idParam = z.object({ id: z.string().uuid() });

export const portalRoutes: Routes = async (app) => {
  app.addHook('preHandler', requireGuest);
  app.addHook('preHandler', requireModule('guest_portal'));

  /** Everything the portal home needs in one call. */
  app.get('/portal/home', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      const [prop] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      let stay = null;
      if (ctx.stay) {
        const [b] = await tx.select().from(bookings).where(eq(bookings.id, ctx.stay.bookingId));
        const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b!.id), eq(bookingItems.kind, 'room')));
        const [room] = ctx.stay.roomId ? await tx.select({ number: rooms.number, floor: rooms.floor, housekeepingStatus: rooms.housekeepingStatus }).from(rooms).where(eq(rooms.id, ctx.stay.roomId)) : [];
        stay = { ...ctx.stay, adults: b!.adults, children: b!.children, roomType: item?.description, room: room ?? null, paymentStatus: b!.paymentStatus, total: b!.total, amountPaid: b!.amountPaid, currency: b!.currency };
      }
      const openRequests = ctx.verified ? await tx.select({ id: serviceRequests.id, title: serviceRequests.title, status: serviceRequests.status, createdAt: serviceRequests.createdAt }).from(serviceRequests).where(and(eq(serviceRequests.guestId, g.guestId), isNull(serviceRequests.resolvedAt))).orderBy(desc(serviceRequests.createdAt)).limit(5) : [];
      const activeOrders = ctx.verified ? await tx.select({ id: orders.id, reference: orders.reference, status: orders.status, estimatedReadyAt: orders.estimatedReadyAt, total: orders.total }).from(orders).where(and(eq(orders.guestId, g.guestId), inArray(orders.status, ['pending_payment', 'new', 'accepted', 'preparing', 'ready']))).orderBy(desc(orders.createdAt)) : [];
      const upcomingTables = ctx.verified ? await tx.select({ id: restaurantReservations.id, startsAt: restaurantReservations.startsAt, partySize: restaurantReservations.partySize, status: restaurantReservations.status, restaurant: restaurants.name }).from(restaurantReservations).innerJoin(restaurants, eq(restaurants.id, restaurantReservations.restaurantId)).where(and(eq(restaurantReservations.guestId, g.guestId), gte(restaurantReservations.startsAt, new Date()), inArray(restaurantReservations.status, ['confirmed', 'waitlisted', 'requested']))).orderBy(asc(restaurantReservations.startsAt)).limit(5) : [];
      const [{ unread }] = (await tx.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.recipientType, 'guest'), eq(notifications.recipientId, g.guestId), eq(notifications.channel, 'in_app'), isNull(notifications.readAt)))) as [{ unread: number }];
      const now = new Date();
      const offers = t.modules.has('offers') ? await tx.select().from(promotions).where(and(eq(promotions.tenantId, t.id), eq(promotions.active, true), eq(promotions.showInPortal, true), or(isNull(promotions.startsAt), lte(promotions.startsAt, now)), or(isNull(promotions.endsAt), gte(promotions.endsAt, now)))).orderBy(asc(promotions.sort)).limit(3) : [];
      return {
        data: {
          guest: { id: ctx.guest.id, firstName: ctx.guest.firstName, lastName: ctx.guest.lastName, email: ctx.guest.email, phone: ctx.guest.phone, verified: ctx.verified, notificationPrefs: ctx.guest.notificationPrefs },
          property: prop && { name: prop.name, phone: prop.phone, email: prop.email, checkInTime: prop.checkInTime, checkOutTime: prop.checkOutTime, images: prop.images.slice(0, 1) },
          stay, openRequests, activeOrders, upcomingTables, unreadNotifications: unread, offers, modules: [...t.modules],
        },
      };
    });
  });

  app.patch('/portal/profile', {
    schema: { tags: ['portal'], body: z.object({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().max(30).nullable(), notificationPrefs: z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), push: z.boolean() }).partial(), marketingOptIn: z.boolean() }).partial() },
  }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    await withTenant(t.id, (tx) => tx.update(guests).set(req.body).where(and(eq(guests.id, g.guestId), eq(guests.tenantId, t.id))));
    return { ok: true };
  });

  // ---------------- Bookings & invoices ----------------
  app.get('/portal/bookings', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      if (!ctx.verified) return { data: [], verified: false };
      const rows = await tx.select({ b: bookings, room: bookingItems.description }).from(bookings).leftJoin(bookingItems, and(eq(bookingItems.bookingId, bookings.id), eq(bookingItems.kind, 'room'))).where(and(eq(bookings.guestId, g.guestId), eq(bookings.tenantId, t.id))).orderBy(desc(bookings.checkIn));
      return { data: rows.map((r) => ({ ...r.b, room: r.room })), verified: true };
    });
  });

  app.post('/portal/bookings/:id/cancel', { schema: { tags: ['portal'], params: idParam, body: z.object({ reason: z.string().max(300).optional() }) } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      if (!ctx.verified) throw badRequest('Please verify your email first');
      return { data: await cancelBooking(tx, t, req.params.id, { by: 'guest', guestId: g.guestId, reason: req.body.reason }) };
    });
  });

  app.get('/portal/invoices', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      if (!ctx.verified) return { data: [] };
      // Keep the in-house folio fresh so the guest sees live room charges.
      if (ctx.stay?.inHouse) await generateInvoice(tx, t, ctx.stay.bookingId);
      const inv = await tx.select().from(invoices).where(and(eq(invoices.guestId, g.guestId), eq(invoices.tenantId, t.id))).orderBy(desc(invoices.createdAt));
      const pays = await tx.select({ id: payments.id, reference: payments.reference, method: payments.method, status: payments.status, amount: payments.amount, refundedAmount: payments.refundedAmount, currency: payments.currency, createdAt: payments.createdAt, targetType: payments.targetType, utr: payments.utr, rejectionReason: payments.rejectionReason })
        .from(payments).where(and(eq(payments.guestId, g.guestId), eq(payments.tenantId, t.id))).orderBy(desc(payments.createdAt));
      return { data: inv, payments: pays };
    });
  });

  // ---------------- Payments (orders / experiences / bookings) ----------------
  app.get('/portal/payments/:id', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(payments).where(and(eq(payments.id, req.params.id), eq(payments.guestId, g.guestId)));
      if (!p) throw notFound('Payment');
      const s = await getSettings(tx, t.id);
      return { data: { id: p.id, status: p.status, amount: p.amount, currency: p.currency, reference: p.reference, method: p.method, rejectionReason: p.rejectionReason, utr: p.utr, instructions: ['awaiting_payment', 'rejected'].includes(p.status) ? await instructionsFor(s, p) : null } };
    });
  });

  app.post('/portal/payments/:id/utr', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['portal'], params: idParam, body: z.object({ utr: z.string().min(6).max(40), proofFileId: z.string().uuid().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await submitUtr(tx, { tenant: t, paymentId: req.params.id, guestId: g.guestId, utr: req.body.utr, proofFileId: req.body.proofFileId }) }));
  });

  // ---------------- Dining ----------------
  app.get('/portal/dining', { preHandler: requireModule('restaurant'), schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      const rs = await tx.select().from(restaurants).where(and(eq(restaurants.tenantId, t.id), eq(restaurants.active, true))).orderBy(restaurants.sort);
      const types = rs.length ? await tx.select().from(orderTypes).where(and(inArray(orderTypes.restaurantId, rs.map((r) => r.id)), eq(orderTypes.active, true))).orderBy(orderTypes.sort) : [];
      const s = await getSettings(tx, t.id);
      const methods = enabledMethods(t, s, 'order', { inHouse: !!ctx.stay?.inHouse });
      return {
        data: rs.map((r) => ({
          id: r.id, name: r.name, kind: r.kind, description: r.description, cuisine: r.cuisine, images: r.images, location: r.location,
          canReserve: r.acceptsReservations && t.modules.has('restaurant.reservations'),
          orderTypes: t.modules.has('restaurant.ordering') && r.acceptsOrders
            ? types.filter((ty) => ty.restaurantId === r.id && t.modules.has(ty.moduleKey as ModuleKey)).map((ty) => ({
              id: ty.id, key: ty.key, name: ty.name, description: ty.description, locationMode: ty.locationMode, areas: ty.areas, allowScheduling: ty.allowScheduling,
              available: !(ty.requiresStay || ty.locationMode === 'room') || !!ctx.stay?.inHouse,
              unavailableReason: (ty.requiresStay || ty.locationMode === 'room') && !ctx.stay?.inHouse ? 'Available once you have checked in' : null,
              paymentModes: ty.paymentModes.filter((m) => methods.includes(m as never)),
            }))
            : [],
        })),
      };
    });
  });

  app.post('/portal/orders', {
    preHandler: requireModule('restaurant.ordering'),
    schema: {
      tags: ['portal'],
      headers: z.object({ 'idempotency-key': z.string().min(8).max(200) }).passthrough(),
      body: z.object({
        restaurantId: z.string().uuid(), orderTypeId: z.string().uuid(),
        lines: z.array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(20), optionIds: z.array(z.string().uuid()).max(20).optional(), notes: z.string().max(200).optional() })).min(1).max(50),
        paymentMode: z.enum(['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property']),
        area: z.string().max(60).optional(), tableId: z.string().uuid().optional(), customLocation: z.string().max(120).optional(),
        scheduledFor: z.coerce.date().optional(), specialInstructions: z.string().max(500).optional(),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const r = await idempotent(req, t.id, 'portal.order', async () => {
      const out = await withTenant(t.id, async (tx) => placeOrder(tx, t, await resolveStayContext(tx, t.id, g.guestId), req.body));
      return { status: 201, body: { data: { order: out.order, instructions: out.instructions } } };
    });
    return reply.status(r.status).send(r.body);
  });

  app.get('/portal/orders', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const os = await tx.select({ o: orders, restaurant: restaurants.name }).from(orders).innerJoin(restaurants, eq(restaurants.id, orders.restaurantId)).where(and(eq(orders.guestId, g.guestId), eq(orders.tenantId, t.id))).orderBy(desc(orders.createdAt)).limit(50);
      const items = os.length ? await tx.select().from(orderItems).where(inArray(orderItems.orderId, os.map((o) => o.o.id))) : [];
      const pays = os.length ? await tx.select({ id: payments.id, targetId: payments.targetId, status: payments.status }).from(payments).where(and(eq(payments.targetType, 'order'), inArray(payments.targetId, os.map((o) => o.o.id)))) : [];
      return { data: os.map((o) => ({ ...o.o, kitchenNotes: undefined, assignedUserId: undefined, restaurant: o.restaurant, items: items.filter((i) => i.orderId === o.o.id), paymentId: pays.find((p) => p.targetId === o.o.id)?.id ?? null })) };
    });
  });

  app.get('/portal/orders/:id', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, req.params.id), eq(orders.guestId, g.guestId)));
      if (!o) throw notFound('Order');
      const { kitchenNotes: _k, assignedUserId: _a, ...safe } = o;
      const history = await tx.select({ toValue: entityEvents.toValue, createdAt: entityEvents.createdAt }).from(entityEvents).where(and(eq(entityEvents.entityType, 'order'), eq(entityEvents.entityId, o.id), eq(entityEvents.visibility, 'guest'))).orderBy(asc(entityEvents.createdAt));
      return { data: { ...safe, items: await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id)), history } };
    });
  });

  app.post('/portal/orders/:id/cancel', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await transitionOrder(tx, t, req.params.id, 'cancelled', { type: 'guest', id: g.guestId }, 'Cancelled by guest') }));
  });

  app.get('/portal/reservations', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({
      data: (await tx.select({ r: restaurantReservations, restaurant: restaurants.name }).from(restaurantReservations).innerJoin(restaurants, eq(restaurants.id, restaurantReservations.restaurantId)).where(and(eq(restaurantReservations.guestId, g.guestId), eq(restaurantReservations.tenantId, t.id))).orderBy(desc(restaurantReservations.startsAt)).limit(50))
        .map((x) => ({ id: x.r.id, reference: x.r.reference, restaurant: x.restaurant, startsAt: x.r.startsAt, partySize: x.r.partySize, status: x.r.status, specialRequests: x.r.specialRequests })),
    }));
  });

  app.post('/portal/reservations', {
    preHandler: requireModule('restaurant.reservations'),
    schema: { tags: ['portal'], body: z.object({ restaurantId: z.string().uuid(), startsAt: z.coerce.date(), partySize: z.number().int().min(1).max(50), areaPreferenceId: z.string().uuid().nullable().optional(), occasion: z.string().max(60).optional(), specialRequests: z.string().max(500).optional(), joinWaitlist: z.boolean().default(false) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const r = await withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      if (!ctx.verified) throw badRequest('Please verify your email first');
      return createReservation(tx, t, { ...req.body, guestId: g.guestId, stayId: ctx.stay?.id ?? null, guestName: `${ctx.guest.firstName} ${ctx.guest.lastName}`, guestEmail: ctx.guest.email, guestPhone: ctx.guest.phone, source: 'portal' });
    });
    return reply.status(201).send({ data: { id: r.id, reference: r.reference, status: r.status, startsAt: r.startsAt } });
  });

  app.post('/portal/reservations/:id/cancel', { preHandler: requireModule('restaurant.reservations'), schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await transitionReservation(tx, t, req.params.id, 'cancelled', { guestId: g.guestId }) }));
  });

  // ---------------- Service requests ----------------
  app.get('/portal/request-types', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      const types = await tx.select().from(serviceRequestTypes).where(and(eq(serviceRequestTypes.tenantId, t.id), eq(serviceRequestTypes.active, true), eq(serviceRequestTypes.guestVisible, true))).orderBy(asc(serviceRequestTypes.sort));
      return {
        data: types.filter((ty) => t.modules.has(ty.moduleKey as ModuleKey)).map((ty) => ({
          id: ty.id, key: ty.key, name: ty.name, description: ty.description, category: ty.category, formSchema: ty.formSchema, slaMinutes: ty.slaMinutes,
          available: !ty.requiresStay || !!ctx.stay?.inHouse, unavailableReason: ty.requiresStay && !ctx.stay?.inHouse ? 'Available during your stay' : null,
        })),
      };
    });
  });

  app.post('/portal/requests', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['portal'], body: z.object({ typeId: z.string().uuid(), description: z.string().max(2000).optional(), details: z.record(z.string(), z.unknown()).optional(), attachmentIds: z.array(z.string().uuid()).max(5).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const r = await withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      if (req.body.attachmentIds?.length) {
        const { files } = await import('@hp/db');
        const own = await tx.select({ id: files.id }).from(files).where(and(inArray(files.id, req.body.attachmentIds), eq(files.uploadedById, g.guestId)));
        if (own.length !== req.body.attachmentIds.length) throw badRequest('Unknown attachment');
      }
      return createRequest(tx, t, { ...req.body, guest: ctx });
    });
    return reply.status(201).send({ data: { id: r.id, reference: r.reference, status: r.status, dueAt: r.dueAt } });
  });

  app.get('/portal/requests', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const rows = await tx.select({ r: serviceRequests, category: serviceRequestTypes.category, workflow: serviceRequestTypes.workflow }).from(serviceRequests).innerJoin(serviceRequestTypes, eq(serviceRequestTypes.id, serviceRequests.typeId)).where(and(eq(serviceRequests.guestId, g.guestId), eq(serviceRequests.tenantId, t.id))).orderBy(desc(serviceRequests.createdAt)).limit(50);
      return { data: rows.map((x) => ({ id: x.r.id, reference: x.r.reference, title: x.r.title, description: x.r.description, category: x.category, status: x.r.status, statusLabel: guestLabel(workflowOf({ workflow: x.workflow }), x.r.status), customerNote: x.r.customerNote, createdAt: x.r.createdAt, resolvedAt: x.r.resolvedAt })) };
    });
  });

  app.get('/portal/requests/:id', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const [r] = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, req.params.id), eq(serviceRequests.guestId, g.guestId)));
      if (!r) throw notFound('Request');
      const [type] = await tx.select().from(serviceRequestTypes).where(eq(serviceRequestTypes.id, r.typeId));
      const wf = workflowOf(type!);
      const events = await tx.select().from(entityEvents).where(and(eq(entityEvents.entityType, 'service_request'), eq(entityEvents.entityId, r.id), eq(entityEvents.visibility, 'guest'))).orderBy(asc(entityEvents.createdAt));
      return {
        data: {
          id: r.id, reference: r.reference, title: r.title, description: r.description, details: r.details, status: r.status, statusLabel: guestLabel(wf, r.status), createdAt: r.createdAt,
          canCancel: r.status === wf.statuses[0]!.key,
          timeline: events.map((e) => ({ kind: e.kind, label: e.kind === 'status' || e.kind === 'created' ? guestLabel(wf, e.toValue ?? '') : null, body: e.kind === 'attachment' ? null : e.body, fromGuest: e.actorType === 'guest', createdAt: e.createdAt })),
        },
      };
    });
  });

  app.post('/portal/requests/:id/cancel', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await transitionRequest(tx, t, req.params.id, 'cancelled', { type: 'guest', id: g.guestId }) }));
  });

  app.post('/portal/requests/:id/notes', { schema: { tags: ['portal'], params: idParam, body: z.object({ body: z.string().min(1).max(1000) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    await withTenant(t.id, (tx) => addRequestNote(tx, t, req.params.id, req.body.body, 'guest', { type: 'guest', id: g.guestId }));
    return reply.status(201).send({ ok: true });
  });

  // ---------------- Experiences ----------------
  app.get('/portal/experience-bookings', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({
      data: (await tx.select({ b: experienceBookings, name: experiences.name, kind: experiences.kind, startsAt: experienceSlots.startsAt, location: experiences.location }).from(experienceBookings).innerJoin(experiences, eq(experiences.id, experienceBookings.experienceId)).innerJoin(experienceSlots, eq(experienceSlots.id, experienceBookings.slotId)).where(and(eq(experienceBookings.guestId, g.guestId), eq(experienceBookings.tenantId, t.id))).orderBy(desc(experienceSlots.startsAt)))
        .map((x) => ({ ...x.b, experience: x.name, kind: x.kind, startsAt: x.startsAt, location: x.location })),
    }));
  });

  app.post('/portal/experience-bookings', {
    schema: { tags: ['portal'], headers: z.object({ 'idempotency-key': z.string().min(8).max(200) }).passthrough(), body: z.object({ slotId: z.string().uuid(), participants: z.number().int().min(1).max(100), paymentMode: z.enum(['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property', 'free']), notes: z.string().max(500).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const r = await idempotent(req, t.id, 'portal.experience', async () => {
      const out = await withTenant(t.id, async (tx) => bookExperience(tx, t, await resolveStayContext(tx, t.id, g.guestId), req.body));
      return { status: 201, body: { data: out } };
    });
    return reply.status(r.status).send(r.body);
  });

  app.post('/portal/experience-bookings/:id/cancel', { schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({ data: await cancelExperienceBooking(tx, t, req.params.id, { guestId: g.guestId }) }));
  });

  // ---------------- Messages & notifications ----------------
  app.get('/portal/messages', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      await tx.update(guestMessages).set({ readAt: new Date() }).where(and(eq(guestMessages.guestId, g.guestId), eq(guestMessages.senderType, 'staff'), isNull(guestMessages.readAt)));
      return { data: await tx.select({ id: guestMessages.id, body: guestMessages.body, senderType: guestMessages.senderType, createdAt: guestMessages.createdAt }).from(guestMessages).where(and(eq(guestMessages.guestId, g.guestId), eq(guestMessages.tenantId, t.id))).orderBy(asc(guestMessages.createdAt)).limit(200) };
    });
  });

  app.post('/portal/messages', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['portal'], body: z.object({ body: z.string().trim().min(1).max(2000) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const m = await withTenant(t.id, async (tx) => {
      const ctx = await resolveStayContext(tx, t.id, g.guestId);
      const [m] = await tx.insert(guestMessages).values({ tenantId: t.id, guestId: g.guestId, stayId: ctx.stay?.id ?? null, senderType: 'guest', body: req.body.body }).returning();
      return m;
    });
    return reply.status(201).send({ data: m });
  });

  app.get('/portal/notifications', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => ({
      data: await tx.select({ id: notifications.id, subject: notifications.subject, body: notifications.body, relatedType: notifications.relatedType, relatedId: notifications.relatedId, readAt: notifications.readAt, createdAt: notifications.createdAt })
        .from(notifications).where(and(eq(notifications.tenantId, t.id), eq(notifications.recipientType, 'guest'), eq(notifications.recipientId, g.guestId), eq(notifications.channel, 'in_app'))).orderBy(desc(notifications.createdAt)).limit(50),
    }));
  });

  app.post('/portal/notifications/read', { schema: { tags: ['portal'] } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    await withTenant(t.id, (tx) => tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.recipientType, 'guest'), eq(notifications.recipientId, g.guestId), isNull(notifications.readAt))));
    return { ok: true };
  });

  void notify; void moduleForKind;
};
