import { bookings, businessDays, cashMovements, cashShifts, guests, orders, payments, properties, users } from '@hp/db';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '../../http/crud.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { TenantInfo } from '../../http/context.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { markNoShow } from '../bookings/service.js';
import { dailySummary } from './daily.js';
import { sendDailyReport } from './report.js';
import { openShiftOf, shiftTotals } from './shifts.js';

async function propertyOf(tx: Tx, tenantId: string) {
  const [p] = await tx.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, tenantId)).limit(1);
  if (!p) throw notFound('Property');
  return p.id;
}

/** The day to close next: the day after the last closed one (or today if none), never in the future. */
async function auditState(tx: Tx, t: TenantInfo) {
  const propertyId = await propertyOf(tx, t.id);
  const today = todayIn(t.timezone);
  const [last] = await tx.select({ date: businessDays.date }).from(businessDays).where(eq(businessDays.tenantId, t.id)).orderBy(desc(businessDays.date)).limit(1);
  const date = last ? addDays(last.date, 1) : today;
  const guestName = sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`;
  const arrivals = await tx.select({ id: bookings.id, reference: bookings.reference, guestName, checkIn: bookings.checkIn }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(eq(bookings.tenantId, t.id), eq(bookings.status, 'confirmed'), lte(bookings.checkIn, date))).orderBy(asc(bookings.checkIn));
  const departures = await tx.select({ id: bookings.id, reference: bookings.reference, guestName, checkOut: bookings.checkOut }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(eq(bookings.tenantId, t.id), eq(bookings.status, 'checked_in'), lte(bookings.checkOut, date))).orderBy(asc(bookings.checkOut));
  const [pv] = await tx.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.tenantId, t.id), eq(payments.status, 'pending_verification')));
  const [oo] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.tenantId, t.id), inArray(orders.status, ['new', 'accepted', 'preparing', 'ready']), sql`(${orders.createdAt} at time zone ${t.timezone})::date <= ${date}::date`));
  const shifts = await tx.select({ id: cashShifts.id, user: users.name, openedAt: cashShifts.openedAt }).from(cashShifts).innerJoin(users, eq(users.id, cashShifts.userId)).where(and(eq(cashShifts.tenantId, t.id), eq(cashShifts.status, 'open')));
  return {
    propertyId, date, today, lastClosed: last?.date ?? null, canClose: date <= today,
    checks: { arrivalsPending: arrivals, departuresPending: departures, paymentsToVerify: pv!.n, openOrders: oo!.n, openShifts: shifts },
  };
}

export const operationsRoutes: Routes = async (app) => {
  // ---------------- Night audit ----------------
  app.get('/admin/night-audit', { preHandler: requireStaff('frontoffice.audit'), schema: { tags: ['operations'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const s = await auditState(tx, t);
      return { data: { ...s, preview: s.canClose ? await dailySummary(tx, t.id, t.timezone, s.date) : null } };
    });
  });

  app.post('/admin/night-audit/close', {
    preHandler: requireStaff('frontoffice.audit'),
    schema: { tags: ['operations'], body: z.object({ date: isoDate, noShows: z.enum(['mark', 'keep']).optional(), notes: z.string().max(1000).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      // One audit at a time per property.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`night-audit:${t.id}`}))`);
      const s = await auditState(tx, t);
      if (!s.canClose) throw conflict('Today is already closed — the next audit runs tomorrow');
      if (req.body.date !== s.date) throw conflict(`The next day to close is ${s.date}`);
      if (s.checks.departuresPending.length) throw conflict('Check out (or extend) guests who were due to leave before closing the day');
      const late = s.checks.arrivalsPending.filter((a) => a.checkIn <= s.date);
      if (late.length && !req.body.noShows) throw badRequest('Decide what to do with guests who haven’t arrived: mark them as no-shows or keep them for a late arrival');
      if (req.body.noShows === 'mark') for (const a of late) await markNoShow(tx, t, a.id);
      const summary = await dailySummary(tx, t.id, t.timezone, s.date);
      const [day] = await tx.insert(businessDays).values({ tenantId: t.id, propertyId: s.propertyId, date: s.date, closedByUserId: me.userId, summary, notes: req.body.notes }).returning();
      await audit(tx, req, { action: 'night_audit.close', entityType: 'business_day', entityId: day!.id, changes: { date: s.date, noShows: req.body.noShows === 'mark' ? late.length : 0 } });
      await sendDailyReport(tx, t.id, s.date);
      return { data: day };
    });
  });

  app.get('/admin/night-audit/days', { preHandler: requireStaff('reports.read'), schema: { tags: ['operations'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(90).default(30) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({
      data: await tx.select({ id: businessDays.id, date: businessDays.date, closedAt: businessDays.closedAt, closedBy: users.name, summary: businessDays.summary, notes: businessDays.notes })
        .from(businessDays).leftJoin(users, eq(users.id, businessDays.closedByUserId)).where(eq(businessDays.tenantId, t.id)).orderBy(desc(businessDays.date)).limit(req.query.limit),
    }));
  });

  // ---------------- Cash drawer shifts ----------------
  app.get('/admin/shifts/current', { preHandler: requireStaff('cash.handle'), schema: { tags: ['operations'] } }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const s = await openShiftOf(tx, t.id, me.userId);
      if (!s) return { data: null };
      const moves = await tx.select().from(cashMovements).where(eq(cashMovements.shiftId, s.id)).orderBy(desc(cashMovements.createdAt));
      return { data: { ...s, totals: await shiftTotals(tx, s.id, s.openingFloat), movements: moves } };
    });
  });

  app.post('/admin/shifts', { preHandler: requireStaff('cash.handle'), schema: { tags: ['operations'], body: z.object({ openingFloat: z.number().int().min(0).max(100_000_00) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    const s = await withTenant(t.id, async (tx) => {
      if (await openShiftOf(tx, t.id, me.userId)) throw conflict('You already have a drawer open');
      const [s] = await tx.insert(cashShifts).values({ tenantId: t.id, propertyId: await propertyOf(tx, t.id), userId: me.userId, openingFloat: req.body.openingFloat }).returning();
      await audit(tx, req, { action: 'shift.open', entityType: 'cash_shift', entityId: s!.id, changes: { openingFloat: req.body.openingFloat } });
      return s!;
    });
    return reply.status(201).send({ data: s });
  });

  app.post('/admin/shifts/current/movements', {
    preHandler: requireStaff('cash.handle'),
    schema: { tags: ['operations'], body: z.object({ kind: z.enum(['paid_out', 'paid_in', 'drop']), amount: z.number().int().min(1).max(100_000_00), reason: z.string().trim().min(2).max(200) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    const m = await withTenant(t.id, async (tx) => {
      const s = await openShiftOf(tx, t.id, me.userId);
      if (!s) throw conflict('Open a drawer first');
      const [m] = await tx.insert(cashMovements).values({ tenantId: t.id, shiftId: s.id, ...req.body, createdByUserId: me.userId }).returning();
      await audit(tx, req, { action: `shift.${req.body.kind}`, entityType: 'cash_shift', entityId: s.id, changes: req.body });
      return m!;
    });
    return reply.status(201).send({ data: m });
  });

  app.post('/admin/shifts/current/close', {
    preHandler: requireStaff('cash.handle'),
    schema: { tags: ['operations'], body: z.object({ countedCash: z.number().int().min(0).max(1_000_000_00), notes: z.string().max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const s = await openShiftOf(tx, t.id, me.userId);
      if (!s) throw conflict('No drawer is open');
      const totals = await shiftTotals(tx, s.id, s.openingFloat);
      const variance = req.body.countedCash - totals.expected;
      if (variance !== 0 && !req.body.notes?.trim()) throw badRequest('The count doesn’t match — add a note explaining the difference');
      const [closed] = await tx.update(cashShifts).set({ status: 'closed', closedAt: new Date(), expectedCash: totals.expected, countedCash: req.body.countedCash, variance, notes: req.body.notes }).where(eq(cashShifts.id, s.id)).returning();
      await audit(tx, req, { action: 'shift.close', entityType: 'cash_shift', entityId: s.id, changes: { expected: totals.expected, counted: req.body.countedCash, variance } });
      return { data: { ...closed, totals } };
    });
  });

  app.get('/admin/shifts', {
    preHandler: requireStaff('payments.read'),
    schema: { tags: ['operations'], querystring: z.object({ from: isoDate.optional(), to: isoDate.optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const to = req.query.to ?? todayIn(t.timezone);
    const from = req.query.from ?? addDays(to, -13);
    return withTenant(t.id, async (tx) => {
      const rows = await tx.select({ s: cashShifts, user: users.name }).from(cashShifts).innerJoin(users, eq(users.id, cashShifts.userId))
        .where(and(eq(cashShifts.tenantId, t.id), gte(sql`(${cashShifts.openedAt} at time zone ${t.timezone})::date`, sql`${from}::date`), lte(sql`(${cashShifts.openedAt} at time zone ${t.timezone})::date`, sql`${to}::date`)))
        .orderBy(desc(cashShifts.openedAt));
      return { data: await Promise.all(rows.map(async (r) => ({ ...r.s, user: r.user, totals: r.s.status === 'open' ? await shiftTotals(tx, r.s.id, r.s.openingFloat) : null }))) };
    });
  });
};
