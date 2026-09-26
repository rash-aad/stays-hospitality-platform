import { files, platformInvoices, tenantSubscriptions } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { isValidGstin } from '../billing/gst.js';
import { invalidateTenant } from '../tenants/tenant-cache.js';
import { issueInvoice, presentInvoice, submitPayment, subscriptionOverview, voidOpenInvoice } from './service.js';

/**
 * The property's own subscription. Runs as system (payment alerts go to platform admins, who belong to no
 * tenant) — every query is filtered by the caller's tenant id, never by anything from the request body.
 */
export const subscriptionTenantRoutes: Routes = async (app) => {
  const manage = requireStaff('tenant.settings');
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/admin/subscription', { preHandler: manage, schema: { tags: ['subscription'] } }, async (req) => {
    const t = tenantOf(req);
    return { data: await asSystem((tx) => subscriptionOverview(tx, t.id, t.status)) };
  });

  /** Slim status for the admin banner — any staff member. */
  app.get('/admin/subscription/status', { preHandler: requireStaff(), schema: { tags: ['subscription'] } }, async (req) => {
    const t = tenantOf(req);
    const o = await asSystem((tx) => subscriptionOverview(tx, t.id, t.status));
    return { data: { state: o.state, daysLeft: o.daysLeft, graceLeft: o.graceLeft, coveredUntil: o.coveredUntil, pendingVerification: o.pendingVerification, trial: !o.paidUntil } };
  });

  app.post('/admin/subscription/invoice', { preHandler: manage, schema: { tags: ['subscription'], body: z.object({ cycle: z.enum(['monthly', 'yearly']) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const inv = await asSystem(async (tx) => {
      const inv = await issueInvoice(tx, t.id, req.body.cycle);
      await audit(tx, req, { action: 'subscription.invoice', entityType: 'platform_invoice', entityId: inv.id, tenantId: t.id, changes: { cycle: req.body.cycle, number: inv.number, total: inv.total } });
      return inv;
    });
    return reply.status(201).send({ data: inv });
  });

  app.delete('/admin/subscription/invoice/:id', { preHandler: manage, schema: { tags: ['subscription'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return { data: await asSystem((tx) => voidOpenInvoice(tx, t.id, req.params.id)) };
  });

  app.post('/admin/subscription/invoice/:id/payment', {
    preHandler: manage,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['subscription'], params: idParam, body: z.object({ utr: z.string().trim().max(40), proofFileId: z.string().uuid().nullish() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    const p = await asSystem(async (tx) => {
      if (req.body.proofFileId) {
        const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, req.body.proofFileId), eq(files.tenantId, t.id)));
        if (!f) throw badRequest('Unknown screenshot');
      }
      const p = await submitPayment(tx, t.id, req.params.id, { utr: req.body.utr, proofFileId: req.body.proofFileId, userId: me.userId });
      await audit(tx, req, { action: 'subscription.payment_submitted', entityType: 'platform_payment', entityId: p.id, tenantId: t.id, changes: { utr: p.utr, amount: p.amount } });
      return p;
    });
    return reply.status(201).send({ data: { id: p.id, status: p.status, amount: p.amount, utr: p.utr } });
  });

  app.put('/admin/subscription/bill-to', {
    preHandler: manage,
    schema: { tags: ['subscription'], body: z.object({ name: z.string().trim().min(2).max(160), company: z.string().trim().max(160).nullish(), gstin: z.string().trim().toUpperCase().nullish(), address: z.string().trim().max(300).nullish() }) },
  }, async (req) => {
    const t = tenantOf(req);
    if (req.body.gstin && !isValidGstin(req.body.gstin)) throw badRequest('That GSTIN doesn’t look right — check the 15 characters');
    const billTo = { name: req.body.name, company: req.body.company || null, gstin: req.body.gstin || null, address: req.body.address || null, stateCode: req.body.gstin ? req.body.gstin.slice(0, 2) : null };
    await asSystem(async (tx) => {
      await tx.update(tenantSubscriptions).set({ billTo }).where(eq(tenantSubscriptions.tenantId, t.id));
      await audit(tx, req, { action: 'subscription.bill_to', entityType: 'tenant', entityId: t.id, tenantId: t.id, changes: billTo });
    });
    await invalidateTenant(t.id);
    return { data: billTo };
  });

  app.get('/admin/subscription/invoices/:id', { preHandler: manage, schema: { tags: ['subscription'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    const [inv] = await asSystem((tx) => tx.select().from(platformInvoices).where(and(eq(platformInvoices.id, req.params.id), eq(platformInvoices.tenantId, t.id))));
    if (!inv) throw notFound('Invoice');
    return { data: presentInvoice(inv) };
  });
};
