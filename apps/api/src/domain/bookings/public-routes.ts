import { bookingItems, bookings, guests, payments, properties, ratePlans, roomTypes, addOns } from '@hp/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '../../http/crud.js';
import { badRequest, forbidden, notFound } from '../../http/errors.js';
import { requireModule, resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { idempotent } from '../../lib/idempotency.js';
import { enabledMethods, getSettings, instructionsFor, submitUtr, gatewayCreds, capture } from '../payments/service.js';
import { GATEWAYS } from '../payments/gateways/index.js';
import { availableUnits } from './inventory.js';
import { checkPayToken, payToken } from './pay-token.js';
import { createBooking, priceStay } from './service.js';

const stayQuery = z.object({
  checkIn: isoDate, checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(16).default(2),
  children: z.coerce.number().int().min(0).max(10).default(0),
});

export const publicBookingRoutes: Routes = async (app) => {
  const pre = [resolvePublicTenant, requireModule('room_booking')];

  app.get('/public/stay-search', { preHandler: pre, schema: { tags: ['booking'], querystring: stayQuery.extend({ couponCode: z.string().max(30).optional() }) } }, async (req) => {
    const t = tenantOf(req);
    const q = req.query;
    if (q.checkOut <= q.checkIn) throw badRequest('Departure must be after arrival');
    return withTenant(t.id, async (tx) => {
      const [prop] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      if (!prop) throw notFound('Property');
      const units = await availableUnits(tx, prop.id, q.checkIn, q.checkOut);
      const types = await tx.select().from(roomTypes).where(and(eq(roomTypes.propertyId, prop.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sort));
      const plans = await tx.select().from(ratePlans).where(and(eq(ratePlans.tenantId, t.id), eq(ratePlans.active, true)));
      const results = [];
      for (const rt of types) {
        const fits = q.adults <= rt.maxAdults && q.children <= rt.maxChildren && q.adults + q.children <= rt.maxOccupancy;
        const u = units.get(rt.id);
        const rates = [];
        if (fits && u && u.units > 0 && !u.closedToArrival) {
          for (const plan of plans.filter((p) => p.roomTypeId === rt.id)) {
            try {
              const { quote } = await priceStay(tx, t, { roomTypeId: rt.id, ratePlanId: plan.id, ...q });
              rates.push({ ratePlanId: plan.id, name: plan.name, description: plan.description, mealPlan: plan.mealPlan, refundable: plan.refundable, cancellationPolicy: plan.cancellationPolicy, quote });
            } catch (e) {
              rates.push({ ratePlanId: plan.id, name: plan.name, unavailableReason: (e as Error).message });
            }
          }
        }
        results.push({
          roomType: { id: rt.id, name: rt.name, slug: rt.slug, description: rt.description, images: rt.images, amenities: rt.amenities, bedConfig: rt.bedConfig, sizeSqm: rt.sizeSqm, view: rt.view, maxOccupancy: rt.maxOccupancy },
          available: rates.some((r) => 'quote' in r), unitsLeft: u && u.units <= 3 ? u.units : null, fitsParty: fits,
          minStay: u?.minStay || null, rates: rates.sort((a, b) => ('quote' in a && 'quote' in b ? a.quote!.total - b.quote!.total : 0)),
        });
      }
      const extras = await tx.select().from(addOns).where(and(eq(addOns.tenantId, t.id), eq(addOns.active, true)));
      const settings = await getSettings(tx, t.id);
      return { data: { property: { id: prop.id, name: prop.name, checkInTime: prop.checkInTime, checkOutTime: prop.checkOutTime }, results, addOns: extras, paymentMethods: enabledMethods(t, settings, 'booking') } };
    });
  });

  const stayBody = stayQuery.extend({ roomTypeId: z.string().uuid(), ratePlanId: z.string().uuid(), couponCode: z.string().max(30).nullable().optional(), addOnIds: z.array(z.string().uuid()).max(20).optional() });

  app.post('/public/booking/quote', { preHandler: pre, schema: { tags: ['booking'], body: stayBody } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const { quote, roomType, plan } = await priceStay(tx, t, req.body);
      return { data: { quote, roomType: { id: roomType.id, name: roomType.name }, ratePlan: { id: plan.id, name: plan.name, cancellationPolicy: plan.cancellationPolicy, refundable: plan.refundable } } };
    });
  });

  app.post('/public/bookings', {
    preHandler: pre,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['booking'],
      headers: z.object({ 'idempotency-key': z.string().min(8).max(200) }).passthrough(),
      body: stayBody.extend({
        guest: z.object({ email: z.string().email(), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().min(6).max(30), country: z.string().length(2).optional() }),
        paymentMethod: z.enum(['upi_manual', 'upi_gateway', 'pay_at_property']),
        specialRequests: z.string().max(1000).optional(), arrivalTime: z.string().max(20).optional(),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const loggedInGuest = req.actor.type === 'guest' ? req.actor.guestId : null;
    const r = await idempotent(req, t.id, 'booking.create', async () => {
      const out = await withTenant(t.id, (tx) =>
        createBooking(tx, t, { ...req.body, guest: loggedInGuest ? { guestId: loggedInGuest } : req.body.guest, source: 'direct' }),
      );
      return {
        status: 201,
        body: {
          data: {
            id: out.booking.id, reference: out.booking.reference, status: out.booking.status, paymentStatus: out.booking.paymentStatus,
            total: out.booking.total, currency: out.booking.currency, holdExpiresAt: out.booking.holdExpiresAt, payToken: payToken(out.booking.id), instructions: out.instructions,
          },
        },
      };
    });
    return reply.status(r.status).header('idempotent-replayed', String(r.replayed)).send(r.body);
  });

  // ----- Payment page for a booking (capability token or the booking's own guest) -----
  const payAuth = z.object({ token: z.string().optional() });
  async function authorisedBooking(req: { actor: { type: string; guestId?: string }; params: { id: string }; query?: unknown; body?: unknown }, tx: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string, token?: string) {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, tenantId)));
    if (!b) throw notFound('Booking');
    const ownGuest = req.actor.type === 'guest' && req.actor.guestId === b.guestId;
    if (!ownGuest && !checkPayToken(b.id, token)) throw forbidden('This payment link is not valid');
    return b;
  }

  app.get('/public/bookings/:id/payment', { preHandler: resolvePublicTenant, schema: { tags: ['booking'], params: z.object({ id: z.string().uuid() }), querystring: payAuth } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const b = await authorisedBooking(req, tx, t.id, req.query.token);
      const [item] = await tx.select().from(bookingItems).where(and(eq(bookingItems.bookingId, b.id), eq(bookingItems.kind, 'room')));
      const [g] = await tx.select({ firstName: guests.firstName, email: guests.email }).from(guests).where(eq(guests.id, b.guestId));
      const [p] = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id))).orderBy(desc(payments.createdAt)).limit(1);
      const settings = await getSettings(tx, t.id);
      return {
        data: {
          booking: { id: b.id, reference: b.reference, status: b.status, paymentStatus: b.paymentStatus, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults, children: b.children, total: b.total, currency: b.currency, holdExpiresAt: b.holdExpiresAt, room: item?.description, guestFirstName: g?.firstName, guestEmail: g?.email },
          payment: p ? { id: p.id, method: p.method, status: p.status, reference: p.reference, utr: p.utr, rejectionReason: p.rejectionReason, expiresAt: p.expiresAt } : null,
          instructions: p && ['awaiting_payment', 'rejected'].includes(p.status) ? await instructionsFor(settings, p) : null,
        },
      };
    });
  });

  app.post('/public/bookings/:id/utr', {
    preHandler: resolvePublicTenant,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['booking'], params: z.object({ id: z.string().uuid() }), body: z.object({ token: z.string().optional(), utr: z.string().min(6).max(40), payerVpa: z.string().max(100).optional(), proofFileId: z.string().uuid().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const b = await authorisedBooking(req, tx, t.id, req.body.token);
      const [p] = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id), inArray(payments.status, ['awaiting_payment', 'rejected']))).orderBy(desc(payments.createdAt)).limit(1);
      if (!p) throw badRequest('There is no payment waiting for a UTR on this booking');
      const updated = await submitUtr(tx, { tenant: t, paymentId: p.id, guestId: null, utr: req.body.utr, payerVpa: req.body.payerVpa, proofFileId: req.body.proofFileId });
      return { data: { status: updated.status, expiresAt: updated.expiresAt } };
    });
  });

  /** Browser callback after a gateway checkout. Signature is verified; the webhook remains the source of truth. */
  app.post('/public/bookings/:id/gateway-confirm', {
    preHandler: resolvePublicTenant,
    schema: { tags: ['booking'], params: z.object({ id: z.string().uuid() }), body: z.object({ token: z.string().optional(), orderId: z.string(), paymentId: z.string(), signature: z.string() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const b = await authorisedBooking(req, tx, t.id, req.body.token);
      const [p] = await tx.select().from(payments).where(and(eq(payments.targetType, 'booking'), eq(payments.targetId, b.id), eq(payments.providerOrderId, req.body.orderId))).for('update');
      if (!p || !p.provider) throw notFound('Payment');
      const settings = await getSettings(tx, t.id);
      if (!GATEWAYS[p.provider].verifyCheckout(gatewayCreds(settings), req.body)) throw forbidden('Payment signature did not verify');
      const captured = await capture(tx, p, { providerPaymentId: req.body.paymentId });
      return { data: { status: captured.status } };
    });
  });
};
