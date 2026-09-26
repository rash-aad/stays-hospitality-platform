import { bookings, guests, paymentSettings, payments, refunds, tenants, users, type PaymentMethod } from '@hp/db';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, forbidden, notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { encryptSecret, maskSecret } from '../../lib/crypto.js';
import { reference } from '../../lib/ids.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';

import { GATEWAYS } from './gateways/index.js';
import { mockGateway } from './gateways/mock.js';
import { openShiftOf } from '../operations/shifts.js';
import { applyGatewayEvent, capture, gatewayConfigured, gatewayCreds, getSettings, refundPayment, verifyManual } from './service.js';


const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

export const paymentRoutes: Routes = async (app, { config }) => {
  // ---------- Gateway webhooks (raw body needed for signature verification) ----------
  await app.register(async (plain) => {
    const hooks = plain.withTypeProvider<ZodTypeProvider>();
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
    });
    hooks.post('/public/payments/webhook/:tenant/:provider', {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: { tags: ['payments'], params: z.object({ tenant: z.string(), provider: z.enum(['razorpay', 'mock']) }) },
    }, async (req, reply) => {
      const [t] = await asSystem((tx) => tx.select().from(tenants).where(eq(tenants.slug, req.params.tenant)));
      if (!t) throw notFound('Tenant');
      const result = await withTenant(t.id, async (tx) => {
        const s = await getSettings(tx, t.id);
        if (s.gatewayProvider !== req.params.provider || !gatewayConfigured(s)) throw forbidden('Gateway not configured');
        const gw = GATEWAYS[req.params.provider];
        const sig = (req.headers['x-razorpay-signature'] ?? req.headers['x-signature']) as string | undefined;
        if (!gw.verifyWebhook(gatewayCreds(s), (req as unknown as { rawBody: string }).rawBody, sig)) throw new AppError(401, 'bad_signature', 'Webhook signature did not verify');
        const ev = gw.parseWebhook(req.body);
        if (!ev) return { ignored: true };
        const p = await applyGatewayEvent(tx, t.id, ev);
        return { ok: true, payment: p?.id ?? null };
      });
      return reply.send(result);
    });
  });

  /** Development-only: simulate the guest completing a mock UPI gateway payment (drives the real webhook path). */
  if (config.NODE_ENV !== 'production') {
    app.post('/public/payments/mock/:paymentId/simulate', {
      schema: { tags: ['payments'], params: z.object({ paymentId: z.string().uuid() }), body: z.object({ success: z.boolean().default(true) }) },
    }, async (req) => {
      const out = await asSystem(async (tx) => {
        const [p] = await tx.select().from(payments).where(eq(payments.id, req.params.paymentId));
        if (!p || p.provider !== 'mock' || !p.providerOrderId) throw notFound('Mock payment');
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, p.tenantId));
        const s = await getSettings(tx, p.tenantId);
        return { p, t: t!, sim: mockGateway.simulatePayment(p.providerOrderId, gatewayCreds(s).webhookSecret, req.body.success) };
      });
      const res = await app.inject({ method: 'POST', url: `/api/v1/public/payments/webhook/${out.t.slug}/mock`, headers: { 'content-type': 'application/json', 'x-signature': out.sim.signature }, payload: out.sim.body });
      return { data: { webhookStatus: res.statusCode, event: out.sim.event } };
    });
  }

  // ---------- Tenant admin ----------
  const listQuery = pageQuery.extend({
    status: z.string().optional(),
    method: z.enum(['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property']).optional(),
  });
  app.get('/admin/payments', { preHandler: requireStaff('payments.read'), schema: { tags: ['payments'], querystring: listQuery } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const statuses = req.query.status?.split(',').filter(Boolean);
      const where = and(
        eq(payments.tenantId, t.id),
        statuses?.length ? inArray(payments.status, statuses as never[]) : undefined,
        req.query.method ? eq(payments.method, req.query.method) : undefined,
        req.query.q ? or(ilike(payments.reference, `%${req.query.q}%`), ilike(payments.utr, `%${req.query.q}%`), ilike(guests.email, `%${req.query.q}%`), ilike(bookings.reference, `%${req.query.q}%`)) : undefined,
      );
      const rows = await tx
        .select({ payment: payments, guestName: sql<string | null>`${guests.firstName} || ' ' || ${guests.lastName}`, guestEmail: guests.email, bookingReference: bookings.reference, verifiedBy: users.name })
        .from(payments)
        .leftJoin(guests, eq(guests.id, payments.guestId))
        .leftJoin(bookings, eq(bookings.id, payments.bookingId))
        .leftJoin(users, eq(users.id, payments.verifiedByUserId))
        .where(where)
        .orderBy(desc(sql`${payments.status} = 'pending_verification'`), desc(payments.submittedAt), desc(payments.createdAt))
        .limit(req.query.pageSize).offset(offset(req.query));
      const [{ n }] = (await tx.select({ n: count() }).from(payments).leftJoin(guests, eq(guests.id, payments.guestId)).leftJoin(bookings, eq(bookings.id, payments.bookingId)).where(where)) as [{ n: number }];
      const [{ pending }] = (await tx.select({ pending: count() }).from(payments).where(and(eq(payments.tenantId, t.id), eq(payments.status, 'pending_verification')))) as [{ pending: number }];
      return { data: rows.map((r) => ({ ...r.payment, guestName: r.guestName, guestEmail: r.guestEmail, bookingReference: r.bookingReference, verifiedBy: r.verifiedBy })), meta: { ...pageMeta(req.query, n), pendingVerification: pending } };
    });
  });

  app.post('/admin/payments/:id/verify', {
    preHandler: requireStaff('payments.verify'),
    schema: { tags: ['payments'], params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const p = await verifyManual(tx, { tenant: t, paymentId: req.params.id, userId: actor.userId, approve: req.body.decision === 'approve', reason: req.body.reason });
      await audit(tx, req, { action: `payment.${req.body.decision}`, entityType: 'payment', entityId: p.id, changes: { utr: p.utr, amount: p.amount, reason: req.body.reason } });
      return { data: p };
    });
  });

  app.post('/admin/payments/:id/refund', {
    preHandler: requireStaff('payments.refund'),
    schema: { tags: ['payments'], params: z.object({ id: z.string().uuid() }), body: z.object({ amount: z.number().int().min(1), reason: z.string().max(300).optional(), note: z.string().max(300).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const r = await refundPayment(tx, { tenant: t, paymentId: req.params.id, amount: req.body.amount, reason: req.body.reason, note: req.body.note, userId: actor.userId });
      // Cash handed back at the desk comes out of the refunding cashier's open drawer.
      const [paid] = await tx.select({ tender: payments.tender }).from(payments).where(eq(payments.id, req.params.id));
      const shift = paid?.tender === 'cash' ? await openShiftOf(tx, t.id, actor.userId) : null;
      if (shift) await tx.update(refunds).set({ shiftId: shift.id }).where(eq(refunds.id, r.id));
      await audit(tx, req, { action: 'payment.refund', entityType: 'payment', entityId: req.params.id, changes: { amount: req.body.amount, status: r.status } });
      return { data: r };
    });
  });

  app.get('/admin/payments/:id/refunds', { preHandler: requireStaff('payments.read'), schema: { tags: ['payments'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tx.select().from(refunds).where(and(eq(refunds.paymentId, req.params.id), eq(refunds.tenantId, t.id))).orderBy(desc(refunds.createdAt)) }));
  });

  /** Record money taken at the desk (cash/card/UPI to the property) against a booking. */
  app.post('/admin/bookings/:id/payments', {
    preHandler: requireStaff('bookings.write'),
    schema: { tags: ['payments'], params: z.object({ id: z.string().uuid() }), body: z.object({ amount: z.number().int().min(1), note: z.string().max(300).optional(), utr: z.string().max(40).optional(), tender: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'other']).default('cash') }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const p = await withTenant(t.id, async (tx) => {
      const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id)));
      if (!b) throw notFound('Booking');
      const shift = await openShiftOf(tx, t.id, actor.userId);
      const [p] = await tx.insert(payments).values({
        tender: req.body.tender, shiftId: shift?.id ?? null,
        tenantId: t.id, guestId: b.guestId, targetType: 'booking', targetId: b.id, bookingId: b.id, method: 'pay_at_property', status: 'awaiting_payment',
        amount: req.body.amount, currency: b.currency, reference: reference('PAY', 8), utr: req.body.utr?.toUpperCase() || null, metadata: { note: req.body.note, recordedBy: actor.userId },
      }).returning();
      const captured = await capture(tx, p!, { verifiedByUserId: actor.userId, verifiedAt: new Date() });
      await audit(tx, req, { action: 'payment.record', entityType: 'payment', entityId: captured.id, changes: { amount: req.body.amount, tender: req.body.tender, booking: b.reference, shift: shift?.id } });
      return captured;
    });
    return reply.status(201).send({ data: p });
  });

  // ---------- Payment settings (tenant chooses: own UPI ID with manual approval, UPI gateway, or both) ----------
  app.get('/admin/payment-settings', { preHandler: requireStaff('payments.read'), schema: { tags: ['payments'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const s = await getSettings(tx, t.id);
      return {
        data: {
          methodsEnabled: s.methodsEnabled, upiVpa: s.upiVpa, upiPayeeName: s.upiPayeeName, gatewayProvider: s.gatewayProvider, gatewayKeyId: s.gatewayKeyId,
          gatewaySecretSet: !!s.gatewaySecretEnc, gatewayWebhookSecretSet: !!s.gatewayWebhookSecretEnc, gatewayKeyMasked: maskSecret(s.gatewayKeyId),
          manualPayWindowMinutes: s.manualPayWindowMinutes, verificationWindowHours: s.verificationWindowHours, requireProofUpload: s.requireProofUpload,
          webhookUrl: `${config.API_PUBLIC_URL}/api/v1/public/payments/webhook/${t.slug}/${s.gatewayProvider ?? 'razorpay'}`,
          paymentsModuleEnabled: t.modules.has('payments'),
        },
      };
    });
  });

  app.put('/admin/payment-settings', {
    preHandler: requireStaff('payments.settings'),
    schema: {
      tags: ['payments'],
      body: z.object({
        methodsEnabled: z.array(z.enum(['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property'])).min(1),
        upiVpa: z.string().trim().regex(VPA_RE, 'Enter a UPI ID like yourbusiness@okhdfcbank').nullable().optional(),
        upiPayeeName: z.string().trim().min(2).max(60).nullable().optional(),
        gatewayProvider: z.enum(['razorpay', 'mock']).nullable().optional(),
        gatewayKeyId: z.string().trim().max(100).nullable().optional(),
        gatewaySecret: z.string().min(8).max(200).optional(),
        gatewayWebhookSecret: z.string().min(8).max(200).optional(),
        manualPayWindowMinutes: z.number().int().min(10).max(24 * 60).optional(),
        verificationWindowHours: z.number().int().min(1).max(96).optional(),
        requireProofUpload: z.boolean().optional(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    const b = req.body;
    if (b.gatewayProvider === 'mock' && config.NODE_ENV === 'production') throw badRequest('The mock gateway is not available in production');
    return withTenant(t.id, async (tx) => {
      const current = await getSettings(tx, t.id);
      const next = {
        methodsEnabled: [...new Set(b.methodsEnabled)] as PaymentMethod[],
        upiVpa: b.upiVpa !== undefined ? b.upiVpa : current.upiVpa,
        upiPayeeName: b.upiPayeeName !== undefined ? b.upiPayeeName : current.upiPayeeName,
        gatewayProvider: b.gatewayProvider !== undefined ? b.gatewayProvider : current.gatewayProvider,
        gatewayKeyId: b.gatewayKeyId !== undefined ? b.gatewayKeyId : current.gatewayKeyId,
        gatewaySecretEnc: b.gatewaySecret ? encryptSecret(b.gatewaySecret, config.SECRETS_MASTER_KEY) : current.gatewaySecretEnc,
        gatewayWebhookSecretEnc: b.gatewayWebhookSecret ? encryptSecret(b.gatewayWebhookSecret, config.SECRETS_MASTER_KEY) : current.gatewayWebhookSecretEnc,
        manualPayWindowMinutes: b.manualPayWindowMinutes ?? current.manualPayWindowMinutes,
        verificationWindowHours: b.verificationWindowHours ?? current.verificationWindowHours,
        requireProofUpload: b.requireProofUpload ?? current.requireProofUpload,
      };
      if (next.methodsEnabled.includes('upi_manual') && (!next.upiVpa || !next.upiPayeeName)) throw badRequest('Add your UPI ID and payee name to accept direct UPI payments');
      if (next.methodsEnabled.includes('upi_gateway') && !(next.gatewayProvider && next.gatewayKeyId && next.gatewaySecretEnc && next.gatewayWebhookSecretEnc)) {
        throw badRequest('Add your gateway key, secret and webhook secret to accept gateway payments');
      }
      await tx.update(paymentSettings).set(next).where(eq(paymentSettings.tenantId, t.id));
      await audit(tx, req, {
        action: 'payment_settings.update', entityType: 'payment_settings', entityId: t.id,
        changes: { methodsEnabled: next.methodsEnabled, upiVpa: next.upiVpa, gatewayProvider: next.gatewayProvider, gatewaySecretChanged: !!b.gatewaySecret, webhookSecretChanged: !!b.gatewayWebhookSecret },
      });
      return { ok: true };
    });
  });
};

