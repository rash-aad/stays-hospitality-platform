import {
  auditLogs, bookingItems, bookings, entityEvents, experienceBookings, files, guestFeedback, guestMessages, guests, invoices, orders,
  payments, ratePlans, refreshTokens, restaurantReservations, serviceRequests, stays,
} from '@hp/db';
import { and, avg, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '../../http/crud.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { guestActor, requireGuest, requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { dryRun, withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, formatDate, todayIn } from '../../lib/dates.js';
import { formatMoney } from '../../lib/money.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { modifyBooking } from '../bookings/service.js';
import { resolveStayContext } from '../guests/access.js';
import { notify } from '../notifications/notify.js';

const idParam = z.object({ id: z.string().uuid() });

async function ownBooking(tx: Tx, tenantId: string, guestId: string, id: string) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.tenantId, tenantId), eq(bookings.guestId, guestId)));
  if (!b) throw notFound('Booking');
  const ctx = await resolveStayContext(tx, tenantId, guestId);
  if (!ctx.verified) throw forbidden('Please confirm your email first');
  return b;
}

/** Erase personal data but keep the pseudonymised row so invoices and accounts still reconcile. */
export async function anonymizeGuest(tx: Tx, tenantId: string, guestId: string) {
  const active = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.guestId, guestId), inArray(bookings.status, ['pending_payment', 'confirmed', 'checked_in'])));
  if (active.length) throw conflict('There is an upcoming or current stay on this profile — cancel or complete it first');
  await tx.update(guests).set({
    firstName: 'Deleted', lastName: 'guest', email: `erased+${guestId}@invalid.local`, phone: null, country: null, passwordHash: null, notes: null, tags: [],
    marketingOptIn: false, notificationPrefs: { email: false, sms: false, whatsapp: false, push: false }, anonymizedAt: new Date(),
  }).where(and(eq(guests.id, guestId), eq(guests.tenantId, tenantId)));
  await tx.update(bookings).set({ precheckin: null, billTo: null, specialRequests: null }).where(eq(bookings.guestId, guestId));
  await tx.update(guestMessages).set({ body: '[removed at the guest’s request]' }).where(eq(guestMessages.guestId, guestId));
  await tx.update(restaurantReservations).set({ guestName: 'Deleted guest', guestEmail: null, guestPhone: null, specialRequests: null }).where(eq(restaurantReservations.guestId, guestId));
  await tx.update(serviceRequests).set({ description: null, details: {} }).where(eq(serviceRequests.guestId, guestId));
  await tx.update(guestFeedback).set({ comment: null }).where(eq(guestFeedback.guestId, guestId));
  await tx.delete(refreshTokens).where(eq(refreshTokens.guestId, guestId));
}

export const engagementRoutes: Routes = async (app) => {
  // ================= Online pre-check-in =================
  const precheckin = z.object({
    arrivalTime: z.string().max(40).nullable(), travellingBy: z.enum(['car', 'flight', 'train', 'bus', 'other']).nullable(),
    nationality: z.string().max(60).nullable(), idType: z.enum(['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other']).nullable(),
    idNumberLast4: z.string().regex(/^[A-Za-z0-9]{4}$/, 'Only the last 4 characters').nullable(), idFileId: z.string().uuid().nullable(),
    address: z.string().max(300).nullable(), purposeOfVisit: z.enum(['leisure', 'business', 'event', 'other']).nullable(),
    guestNames: z.array(z.string().max(80)).max(10).default([]), specialRequests: z.string().max(800).nullable(), consent: z.literal(true, { message: 'Please confirm the details are correct' }),
  });

  app.get('/portal/bookings/:id/precheckin', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const b = await ownBooking(tx, t.id, g.guestId, req.params.id);
      const [item] = await tx.select({ description: bookingItems.description }).from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
      return { data: { booking: { id: b.id, reference: b.reference, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults, children: b.children, status: b.status, room: item?.description }, precheckin: b.precheckin, completedAt: b.precheckinAt } };
    });
  });

  app.put('/portal/bookings/:id/precheckin', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam, body: precheckin } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const b = await ownBooking(tx, t.id, g.guestId, req.params.id);
      if (!['confirmed', 'pending_payment'].includes(b.status)) throw conflict('Online check-in is for upcoming stays');
      if (req.body.idFileId) {
        const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, req.body.idFileId), eq(files.uploadedById, g.guestId)));
        if (!f) throw badRequest('Unknown ID document');
      }
      await tx.update(bookings).set({ precheckin: req.body, precheckinAt: new Date(), arrivalTime: req.body.arrivalTime ?? b.arrivalTime }).where(eq(bookings.id, b.id));
      await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'booking', entityId: b.id, kind: 'update', body: 'Guest completed online check-in', actorType: 'guest', actorId: g.guestId });
      return { ok: true };
    });
  });

  // ================= Change dates (guest self-service) =================
  const change = z.object({ checkIn: isoDate, checkOut: isoDate, adults: z.number().int().min(1).max(16).optional(), children: z.number().int().min(0).max(10).optional() });
  async function guard(tx: Tx, tenantId: string, tz: string, guestId: string, id: string) {
    const b = await ownBooking(tx, tenantId, guestId, id);
    if (b.status !== 'confirmed') throw conflict('Only confirmed, upcoming bookings can be changed online');
    if (b.checkIn < addDays(todayIn(tz), 2)) throw conflict('Changes within 48 hours of arrival need the front desk — please message us');
    const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
    const [plan] = item?.ratePlanId ? await tx.select().from(ratePlans).where(eq(ratePlans.id, item.ratePlanId)) : [];
    if (plan && !plan.refundable) throw conflict('This rate can’t be changed online — please message the front desk');
    return b;
  }
  app.post('/portal/bookings/:id/change-dates/quote', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam, body: change } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    // Runs the real modification — availability, pricing, restrictions — then rolls it back.
    const r = await dryRun(t.id, async (tx) => {
      const b = await guard(tx, t.id, t.timezone, g.guestId, req.params.id);
      if (req.body.checkIn < todayIn(t.timezone)) throw badRequest('Arrival date is in the past');
      return modifyBooking(tx, t, b.id, { ...req.body, adults: req.body.adults ?? b.adults, children: req.body.children ?? b.children });
    });
    return { data: { total: r.booking.total, previousTotal: r.previousTotal, difference: r.booking.total - r.previousTotal, balance: r.balance } };
  });
  app.post('/portal/bookings/:id/change-dates', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam, body: change } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const b = await guard(tx, t.id, t.timezone, g.guestId, req.params.id);
      if (req.body.checkIn < todayIn(t.timezone)) throw badRequest('Arrival date is in the past');
      const r = await modifyBooking(tx, t, b.id, { ...req.body, adults: req.body.adults ?? b.adults, children: req.body.children ?? b.children });
      await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'booking', entityId: b.id, kind: 'update', body: `Guest changed dates: ${b.checkIn}→${b.checkOut} to ${r.booking.checkIn}→${r.booking.checkOut}`, actorType: 'guest', actorId: g.guestId });
      const [guest] = await tx.select().from(guests).where(eq(guests.id, g.guestId));
      const balanceNote = r.balance > 0 ? ` A balance of ${formatMoney(r.balance, b.currency)} is payable at the hotel.` : r.balance < 0 ? ` We’ll refund ${formatMoney(-r.balance, b.currency)} to your original payment method.` : '';
      await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: g.guestId }, templateKey: 'booking.dates_changed', vars: { name: guest!.firstName, reference: b.reference, checkIn: formatDate(r.booking.checkIn), checkOut: formatDate(r.booking.checkOut), total: formatMoney(r.booking.total, b.currency), balanceNote }, related: { type: 'booking', id: b.id } });
      await audit(tx, req, { action: 'booking.guest_change_dates', entityType: 'booking', entityId: b.id, changes: req.body });
      return { data: { booking: r.booking, balance: r.balance } };
    });
  });

  // ================= Feedback =================
  const feedback = z.object({
    overall: z.number().int().min(1).max(5), recommend: z.number().int().min(0).max(10).nullable().optional(),
    aspects: z.partialRecord(z.enum(['room', 'cleanliness', 'service', 'food', 'value', 'location']), z.number().int().min(1).max(5)).default({}),
    comment: z.string().trim().max(3000).nullable().optional(), publicConsent: z.boolean().default(false),
  });
  app.get('/portal/bookings/:id/feedback', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const b = await ownBooking(tx, t.id, g.guestId, req.params.id);
      const [f] = await tx.select().from(guestFeedback).where(eq(guestFeedback.bookingId, b.id));
      return { data: { booking: { id: b.id, reference: b.reference, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status }, feedback: f ?? null } };
    });
  });
  app.post('/portal/bookings/:id/feedback', { preHandler: requireGuest, schema: { tags: ['portal'], params: idParam, body: feedback } }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const f = await withTenant(t.id, async (tx) => {
      const b = await ownBooking(tx, t.id, g.guestId, req.params.id);
      if (!['checked_in', 'checked_out'].includes(b.status)) throw conflict('You can share feedback once your stay has begun');
      const [row] = await tx.insert(guestFeedback).values({ ...req.body, recommend: req.body.recommend ?? null, comment: req.body.comment || null, tenantId: t.id, bookingId: b.id, guestId: g.guestId })
        .onConflictDoUpdate({ target: guestFeedback.bookingId, set: { ...req.body, recommend: req.body.recommend ?? null, comment: req.body.comment || null } }).returning();
      return row!;
    });
    return reply.status(201).send({ data: f });
  });
  app.get('/admin/feedback', { preHandler: requireStaff('guests.read'), schema: { tags: ['guests'], querystring: pageQuery.extend({ rating: z.coerce.number().int().min(1).max(5).optional() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const where = and(eq(guestFeedback.tenantId, t.id), req.query.rating ? eq(guestFeedback.overall, req.query.rating) : undefined);
      const rows = await tx.select({ f: guestFeedback, guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`, reference: bookings.reference, checkOut: bookings.checkOut })
        .from(guestFeedback).innerJoin(guests, eq(guests.id, guestFeedback.guestId)).innerJoin(bookings, eq(bookings.id, guestFeedback.bookingId))
        .where(where).orderBy(desc(guestFeedback.createdAt)).limit(req.query.pageSize).offset(offset(req.query));
      const [{ n }] = (await tx.select({ n: count() }).from(guestFeedback).where(where)) as [{ n: number }];
      const [s] = await tx.select({
        avg: avg(guestFeedback.overall), total: count(),
        promoters: sql<number>`count(*) filter (where ${guestFeedback.recommend} >= 9)::int`, detractors: sql<number>`count(*) filter (where ${guestFeedback.recommend} <= 6)::int`,
        rated: sql<number>`count(${guestFeedback.recommend})::int`,
      }).from(guestFeedback).where(eq(guestFeedback.tenantId, t.id));
      const nps = s && s.rated ? Math.round(((s.promoters - s.detractors) / s.rated) * 100) : null;
      return { data: rows.map((r) => ({ ...r.f, guestName: r.guestName, reference: r.reference, checkOut: r.checkOut })), meta: pageMeta(req.query, n), summary: { average: s?.avg ? Number(Number(s.avg).toFixed(2)) : null, responses: s?.total ?? 0, nps } };
    });
  });
  app.post('/admin/feedback/:id/reply', { preHandler: requireStaff('guests.write'), schema: { tags: ['guests'], params: idParam, body: z.object({ body: z.string().trim().min(2).max(2000) }) } }, async (req) => {
    const t = tenantOf(req);
    const a = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const [f] = await tx.update(guestFeedback).set({ staffReply: req.body.body, repliedByUserId: a.userId, repliedAt: new Date() }).where(and(eq(guestFeedback.id, req.params.id), eq(guestFeedback.tenantId, t.id))).returning();
      if (!f) throw notFound('Feedback');
      await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: f.guestId }, templateKey: 'feedback.reply', channels: ['email', 'in_app'], vars: { property: t.name, body: req.body.body } });
      await audit(tx, req, { action: 'feedback.reply', entityType: 'guest_feedback', entityId: f.id });
      return { data: f };
    });
  });

  // ================= Privacy (DPDP Act) =================
  app.get('/portal/privacy/export', { preHandler: requireGuest, schema: { tags: ['portal'] } }, async (req, reply) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    const data = await withTenant(t.id, async (tx) => {
      const [guest] = await tx.select().from(guests).where(eq(guests.id, g.guestId));
      const { passwordHash: _p, ...profile } = guest!;
      return {
        exportedAt: new Date().toISOString(), property: t.name, profile,
        bookings: await tx.select().from(bookings).where(eq(bookings.guestId, g.guestId)),
        stays: await tx.select().from(stays).where(eq(stays.guestId, g.guestId)),
        orders: await tx.select().from(orders).where(eq(orders.guestId, g.guestId)),
        tableReservations: await tx.select().from(restaurantReservations).where(eq(restaurantReservations.guestId, g.guestId)),
        requests: await tx.select().from(serviceRequests).where(eq(serviceRequests.guestId, g.guestId)),
        experiences: await tx.select().from(experienceBookings).where(eq(experienceBookings.guestId, g.guestId)),
        payments: await tx.select().from(payments).where(eq(payments.guestId, g.guestId)),
        invoices: await tx.select().from(invoices).where(eq(invoices.guestId, g.guestId)),
        messages: await tx.select().from(guestMessages).where(eq(guestMessages.guestId, g.guestId)),
        feedback: await tx.select().from(guestFeedback).where(eq(guestFeedback.guestId, g.guestId)),
      };
    });
    return reply.header('content-type', 'application/json').header('content-disposition', 'attachment; filename="my-data.json"').send(data);
  });

  app.post('/portal/privacy/erase', { preHandler: requireGuest, schema: { tags: ['portal'], body: z.object({ confirm: z.literal('ERASE') }) } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    await withTenant(t.id, async (tx) => {
      await anonymizeGuest(tx, t.id, g.guestId);
      await tx.insert(auditLogs).values({ tenantId: t.id, actorType: 'guest', actorId: g.guestId, action: 'guest.erase_self', entityType: 'guest', entityId: g.guestId, requestId: req.id });
    });
    return { ok: true };
  });

  app.post('/admin/guests/:id/anonymize', { preHandler: requireStaff('guests.write'), schema: { tags: ['guests'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [g] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.id, req.params.id), eq(guests.tenantId, t.id), isNull(guests.anonymizedAt)));
      if (!g) throw notFound('Guest');
      await anonymizeGuest(tx, t.id, g.id);
      await audit(tx, req, { action: 'guest.anonymize', entityType: 'guest', entityId: g.id });
    });
    return { ok: true };
  });
};
