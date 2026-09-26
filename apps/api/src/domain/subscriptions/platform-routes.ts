import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { files, platformInvoices, platformPayments, tenantSubscriptions, tenants } from '@hp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requirePlatform } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { todayIn } from '../../lib/dates.js';
import { purgeSite } from '../../lib/purge.js';
import { financialYear, isValidGstin } from '../billing/gst.js';
import { invalidateTenant } from '../tenants/tenant-cache.js';
import { addDaysISO, coveredUntil, daysBetween, subscriptionState } from './model.js';
import { approvePayment, graceOf, loadSub, presentInvoice, rejectPayment } from './service.js';
import { platformBilling, savePlatformBilling } from './settings.js';

const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const idParam = z.object({ id: z.string().uuid() });
const actorId = (req: FastifyRequest) => (req.actor.type === 'platform' ? req.actor.userId : '');

/** Lift a billing suspension when the property is covered again (trial extended, goodwill days, comp). */
async function reconcile(tx: Tx, tenantId: string) {
  const s = await platformBilling(tx);
  const sub = await loadSub(tx, tenantId);
  const [t] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  const covered = sub.status === 'comp' || sub.status === 'cancelled' || subscriptionState(sub, todayIn('Asia/Kolkata'), graceOf(sub, s), false).state !== 'lapsed';
  if (t?.status === 'suspended' && sub.suspendedReason === 'non_payment' && covered) {
    await tx.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
    await tx.update(tenantSubscriptions).set({ suspendedReason: null }).where(eq(tenantSubscriptions.tenantId, tenantId));
    return true;
  }
  return false;
}

async function subscriptionDetail(tx: Tx, tenantId: string) {
  const s = await platformBilling(tx);
  const sub = await loadSub(tx, tenantId);
  const [t] = await tx.select({ status: tenants.status, createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, tenantId));
  const st = subscriptionState(sub, todayIn('Asia/Kolkata'), graceOf(sub, s), t?.status === 'suspended');
  const invoices = await tx.select().from(platformInvoices).where(eq(platformInvoices.tenantId, tenantId)).orderBy(desc(platformInvoices.issuedAt));
  const payments = await tx.select().from(platformPayments).where(eq(platformPayments.tenantId, tenantId)).orderBy(desc(platformPayments.submittedAt));
  return { ...sub, ...st, freeDays: daysBetween(sub.startedAt, sub.trialEndsAt), effectiveGraceDays: graceOf(sub, s), platformGraceDays: s.graceDays, invoices: invoices.map(({ supplier: _s, ...i }) => i), payments };
}

export const subscriptionPlatformRoutes: Routes = async (app, { config }) => {
  app.addHook('preHandler', requirePlatform);

  // ---------------- bookEZ billing settings ----------------
  app.get('/platform/billing-settings', { schema: { tags: ['platform'] } }, async () => ({ data: await asSystem((tx) => platformBilling(tx)) }));

  app.put('/platform/billing-settings', {
    schema: {
      tags: ['platform'],
      body: z.object({
        vpa: z.string().trim().regex(VPA_RE, 'Enter a UPI ID like bookez@okhdfcbank'), payeeName: z.string().trim().min(2).max(60),
        legalName: z.string().trim().min(2).max(160), gstin: z.string().trim().toUpperCase().nullable(), address: z.string().trim().min(5).max(400),
        stateCode: z.string().regex(/^\d{2}$/).nullable(), invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/),
        gstRateBps: z.number().int().min(0).max(2800), sac: z.string().regex(/^\d{6}$/), verifyPromise: z.string().trim().min(5).max(200),
        graceDays: z.number().int().min(0).max(60), trialDays: z.number().int().min(0).max(365), email: z.string().email().nullable(),
      }),
    },
  }, async (req) => {
    if (req.body.gstin && !isValidGstin(req.body.gstin)) throw badRequest('That GSTIN doesn’t look right — check the 15 characters');
    const stateCode = req.body.gstin ? req.body.gstin.slice(0, 2) : req.body.stateCode;
    const value = { ...req.body, stateCode };
    await asSystem(async (tx) => {
      await savePlatformBilling(tx, value);
      await audit(tx, req, { action: 'platform.billing_settings', entityType: 'platform', entityId: 'billing', tenantId: null, actor: { type: 'platform', id: actorId(req) }, changes: value });
    });
    return { data: value };
  });

  // ---------------- Per-tenant subscription ----------------
  app.get('/platform/tenants/:id/subscription', { schema: { tags: ['platform'], params: idParam } }, async (req) => ({ data: await asSystem((tx) => subscriptionDetail(tx, req.params.id)) }));

  app.put('/platform/tenants/:id/subscription', {
    schema: {
      tags: ['platform'], params: idParam,
      body: z.object({
        freeDays: z.number().int().min(0).max(3650), monthlyFee: z.number().int().min(100).max(10_000_000_00).nullable(), yearlyFee: z.number().int().min(100).max(100_000_000_00).nullable(),
        graceDays: z.number().int().min(0).max(60).nullable(),
      }),
    },
  }, async (req) => {
    const out = await asSystem(async (tx) => {
      const sub = await loadSub(tx, req.params.id);
      const trialEndsAt = addDaysISO(sub.startedAt, req.body.freeDays);
      const trialOver = trialEndsAt < todayIn('Asia/Kolkata');
      if (sub.status !== 'comp' && sub.status !== 'cancelled' && trialOver && !req.body.monthlyFee && !req.body.yearlyFee) throw badRequest('Set a monthly or yearly fee — the free trial is over');
      // Issued invoices keep their amounts; new prices apply from the next invoice.
      await tx.update(tenantSubscriptions).set({ trialEndsAt, monthlyFee: req.body.monthlyFee, yearlyFee: req.body.yearlyFee, graceDays: req.body.graceDays }).where(eq(tenantSubscriptions.tenantId, req.params.id));
      await audit(tx, req, { action: 'platform.subscription.update', entityType: 'tenant_subscription', entityId: req.params.id, tenantId: req.params.id, actor: { type: 'platform', id: actorId(req) }, changes: { before: { trialEndsAt: sub.trialEndsAt, monthlyFee: sub.monthlyFee, yearlyFee: sub.yearlyFee, graceDays: sub.graceDays }, after: { trialEndsAt, ...req.body } } });
      const reactivated = await reconcile(tx, req.params.id);
      return { detail: await subscriptionDetail(tx, req.params.id), reactivated };
    });
    await invalidateTenant(req.params.id);
    if (out.reactivated) purgeSite(req.params.id);
    return { data: out.detail };
  });

  app.post('/platform/tenants/:id/subscription/extend', { schema: { tags: ['platform'], params: idParam, body: z.object({ days: z.number().int().min(1).max(366), note: z.string().trim().min(2).max(300) }) } }, async (req) => {
    const out = await asSystem(async (tx) => {
      const sub = await loadSub(tx, req.params.id);
      const patch = sub.paidUntil ? { paidUntil: addDaysISO(coveredUntil(sub), req.body.days) } : { trialEndsAt: addDaysISO(sub.trialEndsAt, req.body.days) };
      await tx.update(tenantSubscriptions).set(patch).where(eq(tenantSubscriptions.tenantId, req.params.id));
      await audit(tx, req, { action: 'platform.subscription.extend', entityType: 'tenant_subscription', entityId: req.params.id, tenantId: req.params.id, actor: { type: 'platform', id: actorId(req) }, changes: { days: req.body.days, note: req.body.note, ...patch } });
      const reactivated = await reconcile(tx, req.params.id);
      return { detail: await subscriptionDetail(tx, req.params.id), reactivated };
    });
    await invalidateTenant(req.params.id);
    if (out.reactivated) purgeSite(req.params.id);
    return { data: out.detail };
  });

  /** comp = free, no billing · cancelled = billing stopped · billing = back to normal. */
  app.put('/platform/tenants/:id/subscription/status', { schema: { tags: ['platform'], params: idParam, body: z.object({ status: z.enum(['comp', 'cancelled', 'billing']), note: z.string().trim().max(300).optional() }) } }, async (req) => {
    const out = await asSystem(async (tx) => {
      const sub = await loadSub(tx, req.params.id);
      const status = req.body.status === 'billing' ? (sub.paidUntil ? 'active' : 'trial') : req.body.status;
      await tx.update(tenantSubscriptions).set({ status, cancelledAt: status === 'cancelled' ? new Date() : null }).where(eq(tenantSubscriptions.tenantId, req.params.id));
      await audit(tx, req, { action: `platform.subscription.${req.body.status}`, entityType: 'tenant_subscription', entityId: req.params.id, tenantId: req.params.id, actor: { type: 'platform', id: actorId(req) }, changes: { from: sub.status, to: status, note: req.body.note } });
      const reactivated = await reconcile(tx, req.params.id);
      return { detail: await subscriptionDetail(tx, req.params.id), reactivated };
    });
    await invalidateTenant(req.params.id);
    if (out.reactivated) purgeSite(req.params.id);
    return { data: out.detail };
  });

  app.get('/platform/invoices/:id', { schema: { tags: ['platform'], params: idParam } }, async (req) => {
    const [inv] = await asSystem((tx) => tx.select().from(platformInvoices).where(eq(platformInvoices.id, req.params.id)));
    if (!inv) throw notFound('Invoice');
    return { data: presentInvoice(inv) };
  });

  // ---------------- Payments to verify ----------------
  app.get('/platform/payments', { schema: { tags: ['platform'], querystring: z.object({ status: z.enum(['pending', 'all']).default('pending') }) } }, async (req) => {
    const rows = await asSystem((tx) => tx.select({ p: platformPayments, tenant: tenants.name, slug: tenants.slug, number: platformInvoices.number, cycle: platformInvoices.cycle, periodStart: platformInvoices.periodStart, periodEnd: platformInvoices.periodEnd })
      .from(platformPayments).innerJoin(tenants, eq(tenants.id, platformPayments.tenantId)).innerJoin(platformInvoices, eq(platformInvoices.id, platformPayments.invoiceId))
      .where(req.query.status === 'pending' ? eq(platformPayments.status, 'pending_verification') : undefined)
      .orderBy(req.query.status === 'pending' ? platformPayments.submittedAt : desc(platformPayments.submittedAt)).limit(200));
    const now = Date.now();
    return { data: rows.map((r) => ({ ...r.p, tenant: r.tenant, slug: r.slug, invoiceNumber: r.number, cycle: r.cycle, periodStart: r.periodStart, periodEnd: r.periodEnd, ageHours: Math.floor((now - r.p.submittedAt.getTime()) / 3600_000), overdue: now - r.p.submittedAt.getTime() > 12 * 3600_000 })) };
  });

  app.post('/platform/payments/:id/approve', { schema: { tags: ['platform'], params: idParam } }, async (req) => {
    const r = await asSystem(async (tx) => {
      const r = await approvePayment(tx, req.params.id, actorId(req));
      await audit(tx, req, { action: 'platform.payment.approve', entityType: 'platform_payment', entityId: req.params.id, tenantId: r.tenantId, actor: { type: 'platform', id: actorId(req) }, changes: { paidUntil: r.paidUntil, reactivated: r.reactivated } });
      return r;
    });
    await invalidateTenant(r.tenantId);
    if (r.reactivated) purgeSite(r.tenantId);
    return { data: r };
  });

  app.post('/platform/payments/:id/reject', { schema: { tags: ['platform'], params: idParam, body: z.object({ reason: z.string().trim().min(5).max(300) }) } }, async (req) => {
    const p = await asSystem(async (tx) => {
      const p = await rejectPayment(tx, req.params.id, actorId(req), req.body.reason);
      await audit(tx, req, { action: 'platform.payment.reject', entityType: 'platform_payment', entityId: p.id, tenantId: p.tenantId, actor: { type: 'platform', id: actorId(req) }, changes: { reason: req.body.reason, utr: p.utr } });
      return p;
    });
    return { data: { id: p.id, status: 'rejected' } };
  });

  const root = resolve(config.UPLOAD_DIR);
  app.get('/platform/payments/:id/proof', { schema: { tags: ['platform'], params: idParam } }, async (req, reply) => {
    const f = await asSystem(async (tx) => {
      const [p] = await tx.select().from(platformPayments).where(eq(platformPayments.id, req.params.id));
      if (!p?.proofFileId) return null;
      return (await tx.select().from(files).where(and(eq(files.id, p.proofFileId), eq(files.tenantId, p.tenantId))))[0] ?? null;
    });
    if (!f) throw notFound('Screenshot');
    const path = join(root, f.storageKey);
    if (!path.startsWith(root)) throw notFound('Screenshot');
    await stat(path).catch(() => { throw notFound('Screenshot'); });
    return reply.header('content-type', f.mime).header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store').send(createReadStream(path));
  });

  // ---------------- Revenue ----------------
  app.get('/platform/revenue', { schema: { tags: ['platform'] } }, async () => {
    return asSystem(async (tx) => {
      const s = await platformBilling(tx);
      const fy = financialYear(new Date());
      const [r] = (await tx.execute<{ month: number; fy: number; pending: number; pendingCount: number }>(sql`
        select coalesce(sum(i.total) filter (where date_trunc('month', i.paid_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata')), 0)::int as month,
               coalesce(sum(i.total) filter (where i.status = 'paid' and i.financial_year = ${fy}), 0)::int as fy,
               (select coalesce(sum(amount), 0)::int from platform_payments where status = 'pending_verification') as pending,
               (select count(*)::int from platform_payments where status = 'pending_verification') as "pendingCount"
        from platform_invoices i where i.status = 'paid'`)) as unknown as [{ month: number; fy: number; pending: number; pendingCount: number }];
      const today = todayIn('Asia/Kolkata');
      const subs = await tx.select().from(tenantSubscriptions).where(sql`${tenantSubscriptions.status} in ('trial', 'active')`);
      const due = subs.filter((x) => { const d = daysBetween(today, coveredUntil(x)); return d >= 0 && d <= 30 && (x.monthlyFee || x.yearlyFee); });
      const expected = due.reduce((sum, x) => { const fee = x.cycle === 'yearly' ? x.yearlyFee ?? x.monthlyFee : x.monthlyFee ?? x.yearlyFee; return sum + Math.round((fee ?? 0) * (1 + s.gstRateBps / 10_000)); }, 0);
      return { data: { collectedThisMonth: r.month, collectedThisFy: r.fy, financialYear: fy, pendingAmount: r.pending, pendingCount: r.pendingCount, renewalsDue30: due.length, renewalsDue30Amount: expected } };
    });
  });
};
