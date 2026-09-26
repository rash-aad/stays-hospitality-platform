import { bookings, invoices, tenants } from '@hp/db';
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { guestActor, requireGuest, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { isValidGstin, splitTax } from './gst.js';
import { getBilling, supplierSnapshot, type BillingSettings } from './service.js';

const billTo = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(160).nullable().optional(),
  gstin: z.string().trim().toUpperCase().nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

function checkGstin(g?: string | null) {
  if (g && !isValidGstin(g)) throw badRequest('That GSTIN doesn’t look right — check the 15 characters');
}

/** Invoice as rendered: frozen supplier (or live details for drafts) plus the CGST/SGST split per rate. */
async function present(tx: Tx, tenantId: string, inv: typeof invoices.$inferSelect) {
  const supplier = inv.supplier ?? (await supplierSnapshot(tx, tenantId));
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const l of inv.lines) {
    const r = l.rateBps ?? 0;
    const cur = byRate.get(r) ?? { taxable: 0, tax: 0 };
    byRate.set(r, { taxable: cur.taxable + l.amount, tax: cur.tax + l.taxAmount });
  }
  const taxSummary = [...byRate].sort((a, b) => a[0] - b[0]).map(([rateBps, v]) => ({ rateBps, taxable: v.taxable, ...splitTax(v.tax) }));
  const [b] = inv.bookingId ? await tx.select({ reference: bookings.reference, checkIn: bookings.checkIn, checkOut: bookings.checkOut }).from(bookings).where(eq(bookings.id, inv.bookingId)) : [];
  const billing = await getBilling(tx, tenantId);
  return { ...inv, supplier, taxSummary, booking: b ?? null, footerNote: billing.footerNote };
}

export const billingRoutes: Routes = async (app) => {
  app.get('/admin/billing-settings', { preHandler: requireStaff('tenant.settings'), schema: { tags: ['billing'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await getBilling(tx, t.id) }));
  });

  app.put('/admin/billing-settings', {
    preHandler: requireStaff('tenant.settings'),
    schema: {
      tags: ['billing'],
      body: z.object({
        legalName: z.string().trim().min(2).max(160).nullable(), gstin: z.string().trim().toUpperCase().nullable(), address: z.string().trim().max(400).nullable(),
        invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,10}$/, 'Letters, digits and dashes, up to 10'),
        sacRoom: z.string().regex(/^\d{6}$/), sacFood: z.string().regex(/^\d{6}$/), sacService: z.string().regex(/^\d{6}$/), footerNote: z.string().max(400).nullable(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    checkGstin(req.body.gstin);
    return withTenant(t.id, async (tx) => {
      await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t.id));
      const billing: BillingSettings = { ...req.body, gstin: req.body.gstin || null };
      await tx.update(tenants).set({ settings: { ...(row?.settings ?? {}), billing } }).where(eq(tenants.id, t.id));
      await audit(tx, req, { action: 'billing_settings.update', entityType: 'tenant', entityId: t.id, changes: { gstin: billing.gstin, legalName: billing.legalName } });
      return { data: billing };
    });
  });

  app.get('/admin/invoices', { preHandler: requireStaff('payments.read'), schema: { tags: ['billing'], querystring: pageQuery } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const where = and(eq(invoices.tenantId, t.id), req.query.q ? ilike(invoices.number, `%${req.query.q}%`) : undefined);
      const rows = await tx.select({ i: invoices, reference: bookings.reference }).from(invoices).leftJoin(bookings, eq(bookings.id, invoices.bookingId)).where(where).orderBy(desc(invoices.createdAt)).limit(req.query.pageSize).offset(offset(req.query));
      const [{ n }] = (await tx.select({ n: count() }).from(invoices).where(where)) as [{ n: number }];
      return { data: rows.map((r) => ({ ...r.i, bookingReference: r.reference })), meta: pageMeta(req.query, n) };
    });
  });

  app.get('/admin/invoices/:id', { preHandler: requireStaff('bookings.read'), schema: { tags: ['billing'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, req.params.id), eq(invoices.tenantId, t.id)));
      if (!inv) throw notFound('Invoice');
      return { data: await present(tx, t.id, inv) };
    });
  });

  app.put('/admin/bookings/:id/bill-to', {
    preHandler: requireStaff('bookings.write'),
    schema: { tags: ['billing'], params: z.object({ id: z.string().uuid() }), body: billTo },
  }, async (req) => {
    const t = tenantOf(req);
    checkGstin(req.body.gstin);
    return withTenant(t.id, async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.bookingId, req.params.id), sql`${invoices.issuedAt} is not null`));
      if (inv) throw conflict('The tax invoice is already issued; billing details can’t change');
      const [b] = await tx.update(bookings).set({ billTo: req.body }).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id))).returning({ id: bookings.id });
      if (!b) throw notFound('Booking');
      await audit(tx, req, { action: 'booking.bill_to', entityType: 'booking', entityId: b.id, changes: { company: req.body.company, gstin: req.body.gstin } });
      return { ok: true };
    });
  });

  // ----- Guest -----
  app.get('/portal/invoices/:id', { preHandler: requireGuest, schema: { tags: ['portal'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    return withTenant(t.id, async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, req.params.id), eq(invoices.guestId, g.guestId)));
      if (!inv) throw notFound('Invoice');
      return { data: await present(tx, t.id, inv) };
    });
  });

  app.put('/portal/bookings/:id/bill-to', {
    preHandler: requireGuest,
    schema: { tags: ['portal'], params: z.object({ id: z.string().uuid() }), body: billTo },
  }, async (req) => {
    const t = tenantOf(req);
    const g = guestActor(req);
    checkGstin(req.body.gstin);
    return withTenant(t.id, async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.bookingId, req.params.id), sql`${invoices.issuedAt} is not null`));
      if (inv) throw conflict('Your tax invoice is already issued — ask the front desk to reissue it');
      const [b] = await tx.update(bookings).set({ billTo: req.body }).where(and(eq(bookings.id, req.params.id), eq(bookings.guestId, g.guestId))).returning({ id: bookings.id });
      if (!b) throw notFound('Booking');
      return { ok: true };
    });
  });
};
