import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '../../http/crud.js';
import { badRequest } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { addDays, nightsBetween, todayIn } from '../../lib/dates.js';

const range = z.object({ from: isoDate.optional(), to: isoDate.optional() });
type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

function resolveRange(tz: string, q: { from?: string; to?: string }) {
  const to = q.to ?? todayIn(tz);
  const from = q.from ?? addDays(to, -29);
  if (from > to) throw badRequest('`from` must be before `to`');
  if (nightsBetween(from, to) > 731) throw badRequest('Choose a range of two years or less');
  return { from, to, toExclusive: addDays(to, 1) };
}

export const reportRoutes: Routes = async (app) => {
  const guard = [requireStaff('reports.read'), requireModule('reports')];

  app.get('/admin/reports/summary', { preHandler: guard, schema: { tags: ['reports'], querystring: range } }, async (req) => {
    const t = tenantOf(req);
    const { from, to, toExclusive } = resolveRange(t.timezone, req.query);
    const tz = t.timezone;
    return withTenant(t.id, async (tx) => {
      // Room nights & revenue by stay date, pro-rated from each booking's nightly breakdown.
      const daily = await rows<{ date: string; sold: number; revenue: number; available: number }>(tx, sql`
        with days as (select generate_series(${from}::date, ${to}::date, '1 day')::date as d),
        nights as (
          select (n->>'date')::date as d, (n->>'price')::int as price
          from bookings b join booking_items bi on bi.booking_id = b.id and bi.kind = 'room',
               jsonb_array_elements(bi.nightly) n
          where b.tenant_id = ${t.id} and b.status in ('confirmed','checked_in','checked_out')
        ),
        cap as (select count(*)::int as rooms from rooms where tenant_id = ${t.id} and status = 'active')
        select to_char(days.d, 'YYYY-MM-DD') as date, count(nights.d)::int as sold, coalesce(sum(nights.price), 0)::int as revenue, (select rooms from cap) as available
        from days left join nights on nights.d = days.d group by days.d order by days.d`);
      const sold = daily.reduce((s, d) => s + d.sold, 0);
      const available = daily.reduce((s, d) => s + d.available, 0);
      const roomRevenue = daily.reduce((s, d) => s + d.revenue, 0);

      const [bk] = await rows<{ bookings: number; value: number; cancelled: number; noshow: number; lead: number | null; los: number | null }>(tx, sql`
        select count(*) filter (where status in ('confirmed','checked_in','checked_out'))::int as bookings,
          coalesce(avg(total) filter (where status in ('confirmed','checked_in','checked_out')), 0)::int as value,
          count(*) filter (where status = 'cancelled')::int as cancelled, count(*) filter (where status = 'no_show')::int as noshow,
          avg(check_in - (created_at at time zone ${tz})::date) filter (where status in ('confirmed','checked_in','checked_out'))::float as lead,
          avg(check_out - check_in) filter (where status in ('confirmed','checked_in','checked_out'))::float as los
        from bookings where tenant_id = ${t.id} and (created_at at time zone ${tz})::date between ${from}::date and ${to}::date`);
      const sources = await rows(tx, sql`select source, count(*)::int as bookings, coalesce(sum(total),0)::int as revenue from bookings where tenant_id = ${t.id} and status in ('confirmed','checked_in','checked_out') and (created_at at time zone ${tz})::date between ${from}::date and ${to}::date group by source order by bookings desc`);
      const payments = await rows(tx, sql`select method, count(*)::int as count, coalesce(sum(amount - refunded_amount),0)::int as amount from payments where tenant_id = ${t.id} and status in ('captured','partially_refunded','refunded') and (created_at at time zone ${tz})::date between ${from}::date and ${to}::date group by method`);

      const [dining] = await rows<Row>(tx, sql`
        select (select count(*)::int from restaurant_reservations where tenant_id = ${t.id} and status in ('confirmed','seated','completed') and starts_at >= ${from}::date and starts_at < ${toExclusive}::date) as reservations,
               (select coalesce(sum(party_size),0)::int from restaurant_reservations where tenant_id = ${t.id} and status in ('seated','completed') and starts_at >= ${from}::date and starts_at < ${toExclusive}::date) as covers,
               (select count(*)::int from restaurant_reservations where tenant_id = ${t.id} and status = 'no_show' and starts_at >= ${from}::date and starts_at < ${toExclusive}::date) as "noShows",
               (select count(*)::int from orders where tenant_id = ${t.id} and status not in ('cancelled','pending_payment') and created_at >= ${from}::date and created_at < ${toExclusive}::date) as orders,
               (select coalesce(sum(total),0)::int from orders where tenant_id = ${t.id} and status not in ('cancelled','pending_payment') and created_at >= ${from}::date and created_at < ${toExclusive}::date) as "orderRevenue",
               (select coalesce(avg(extract(epoch from (e.created_at - o.created_at)) / 60), 0)::int from orders o join entity_events e on e.entity_id = o.id and e.entity_type = 'order' and e.to_value = 'ready' where o.tenant_id = ${t.id} and o.created_at >= ${from}::date and o.created_at < ${toExclusive}::date) as "avgMinutesToReady"`);
      const byOutlet = await rows(tx, sql`select r.name, count(o.id)::int as orders, coalesce(sum(o.total),0)::int as revenue from restaurants r left join orders o on o.restaurant_id = r.id and o.status not in ('cancelled','pending_payment') and o.created_at >= ${from}::date and o.created_at < ${toExclusive}::date where r.tenant_id = ${t.id} group by r.name order by revenue desc`);

      const requests = await rows(tx, sql`
        select srt.category, count(sr.id)::int as count,
          coalesce(avg(extract(epoch from (sr.resolved_at - sr.created_at)) / 60) filter (where sr.resolved_at is not null), 0)::int as "avgMinutes",
          count(*) filter (where sr.resolved_at > sr.due_at or (sr.resolved_at is null and sr.due_at < now()))::int as breached
        from service_requests sr join service_request_types srt on srt.id = sr.type_id
        where sr.tenant_id = ${t.id} and sr.created_at >= ${from}::date and sr.created_at < ${toExclusive}::date
        group by srt.category order by count desc`);
      const [ops] = await rows<Row>(tx, sql`
        select (select count(*)::int from housekeeping_tasks where tenant_id = ${t.id} and scheduled_for between ${from}::date and ${to}::date) as "hkTasks",
               (select count(*)::int from housekeeping_tasks where tenant_id = ${t.id} and scheduled_for between ${from}::date and ${to}::date and status in ('done','inspected')) as "hkDone",
               (select count(*)::int from housekeeping_tasks where tenant_id = ${t.id} and status = 'failed_inspection' and scheduled_for between ${from}::date and ${to}::date) as "hkFailedInspections",
               (select count(*)::int from maintenance_tickets where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date) as "mtOpened",
               (select count(*)::int from maintenance_tickets where tenant_id = ${t.id} and resolved_at >= ${from}::date and resolved_at < ${toExclusive}::date) as "mtResolved",
               (select count(*)::int from maintenance_tickets where tenant_id = ${t.id} and status not in ('resolved','closed')) as "mtBacklog"`);
      const [engagement] = await rows<Row>(tx, sql`
        with stayed as (select distinct guest_id from stays where tenant_id = ${t.id} and (checked_in_at >= ${from}::date and checked_in_at < ${toExclusive}::date)),
        active as (
          select guest_id from orders where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date
          union select guest_id from service_requests where tenant_id = ${t.id} and source = 'guest' and created_at >= ${from}::date and created_at < ${toExclusive}::date
          union select guest_id from restaurant_reservations where tenant_id = ${t.id} and source = 'portal' and created_at >= ${from}::date and created_at < ${toExclusive}::date
          union select guest_id from guest_messages where tenant_id = ${t.id} and sender_type = 'guest' and created_at >= ${from}::date and created_at < ${toExclusive}::date
          union select guest_id from experience_bookings where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date
        )
        select (select count(*)::int from stayed) as "stayingGuests", (select count(*)::int from active where guest_id in (select guest_id from stayed)) as "portalActiveGuests",
               (select count(*)::int from experience_bookings where tenant_id = ${t.id} and status in ('confirmed','completed') and created_at >= ${from}::date and created_at < ${toExclusive}::date) as "experienceBookings",
               (select coalesce(sum(total),0)::int from experience_bookings where tenant_id = ${t.id} and status in ('confirmed','completed') and created_at >= ${from}::date and created_at < ${toExclusive}::date) as "experienceRevenue"`);
      const moduleUsage = await rows(tx, sql`
        select m.module_key as module, m.enabled,
          case m.module_key
            when 'room_booking' then (select count(*) from bookings where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'restaurant.reservations' then (select count(*) from restaurant_reservations where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'restaurant.ordering' then (select count(*) from orders where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'housekeeping' then (select count(*) from housekeeping_tasks where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'maintenance' then (select count(*) from maintenance_tickets where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'experiences' then (select count(*) from experience_bookings where tenant_id = ${t.id} and created_at >= ${from}::date and created_at < ${toExclusive}::date)
            when 'concierge' then (select count(*) from service_requests sr join service_request_types t2 on t2.id = sr.type_id where sr.tenant_id = ${t.id} and t2.module_key = 'concierge' and sr.created_at >= ${from}::date and sr.created_at < ${toExclusive}::date)
            else null end::int as activity
        from tenant_modules m where m.tenant_id = ${t.id} order by m.module_key`);

      return {
        data: {
          range: { from, to },
          rooms: {
            occupancy: available ? sold / available : 0, roomNightsSold: sold, roomNightsAvailable: available, roomRevenue,
            adr: sold ? Math.round(roomRevenue / sold) : 0, revpar: available ? Math.round(roomRevenue / available) : 0,
            bookings: bk?.bookings ?? 0, averageBookingValue: bk?.value ?? 0, cancellations: bk?.cancelled ?? 0, noShows: bk?.noshow ?? 0,
            averageLeadDays: bk?.lead != null ? Math.round(bk.lead * 10) / 10 : null, averageLengthOfStay: bk?.los != null ? Math.round(bk.los * 10) / 10 : null,
            daily, sources,
          },
          payments, dining: { ...dining, byOutlet }, requests, operations: ops, engagement, moduleUsage,
        },
      };
    });
  });

  const exportTypes = {
    bookings: (tenantId: string, from: string, toEx: string) => sql`select b.reference, b.status, b.payment_status, b.source, b.check_in, b.check_out, b.adults, b.children, g.first_name || ' ' || g.last_name as guest, g.email, b.total / 100.0 as total, b.amount_paid / 100.0 as paid, b.currency, b.created_at from bookings b join guests g on g.id = b.guest_id where b.tenant_id = ${tenantId} and b.created_at >= ${from}::date and b.created_at < ${toEx}::date order by b.created_at`,
    payments: (tenantId: string, from: string, toEx: string) => sql`select reference, method, status, target_type, amount / 100.0 as amount, refunded_amount / 100.0 as refunded, currency, utr, payer_vpa, created_at, verified_at from payments where tenant_id = ${tenantId} and created_at >= ${from}::date and created_at < ${toEx}::date order by created_at`,
    orders: (tenantId: string, from: string, toEx: string) => sql`select o.reference, r.name as outlet, o.status, o.location_label, o.payment_mode, o.payment_status, o.subtotal / 100.0 as subtotal, o.tax_total / 100.0 as tax, o.total / 100.0 as total, o.created_at from orders o join restaurants r on r.id = o.restaurant_id where o.tenant_id = ${tenantId} and o.created_at >= ${from}::date and o.created_at < ${toEx}::date order by o.created_at`,
    reservations: (tenantId: string, from: string, toEx: string) => sql`select rr.reference, r.name as outlet, rr.status, rr.guest_name, rr.party_size, rr.starts_at, rr.source, rr.occasion from restaurant_reservations rr join restaurants r on r.id = rr.restaurant_id where rr.tenant_id = ${tenantId} and rr.starts_at >= ${from}::date and rr.starts_at < ${toEx}::date order by rr.starts_at`,
    requests: (tenantId: string, from: string, toEx: string) => sql`select sr.reference, t.category, sr.title, sr.status, sr.priority, sr.source, sr.created_at, sr.due_at, sr.resolved_at, round(extract(epoch from (sr.resolved_at - sr.created_at)) / 60) as minutes_to_resolve from service_requests sr join service_request_types t on t.id = sr.type_id where sr.tenant_id = ${tenantId} and sr.created_at >= ${from}::date and sr.created_at < ${toEx}::date order by sr.created_at`,
  } as const;

  app.get('/admin/reports/export', {
    preHandler: guard,
    schema: { tags: ['reports'], querystring: range.extend({ type: z.enum(['bookings', 'payments', 'orders', 'reservations', 'requests']) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const { from, to, toExclusive } = resolveRange(t.timezone, req.query);
    const data = await withTenant(t.id, (tx) => rows(tx, exportTypes[req.query.type](t.id, from, toExclusive)));
    const cols = data[0] ? Object.keys(data[0]) : [];
    // Neutralise spreadsheet formula injection and quote every field.
    const cell = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [cols.join(','), ...data.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${req.query.type}-${from}-to-${to}.csv"`)
      .send(`﻿${csv}`);
  });

  /** Today at a glance for the admin dashboard. */
  app.get('/admin/dashboard', { preHandler: requireStaff(), schema: { tags: ['reports'] } }, async (req) => {
    const t = tenantOf(req);
    const today = todayIn(t.timezone);
    return withTenant(t.id, async (tx) => {
      const [d] = await rows<Row>(tx, sql`
        select
          (select count(*)::int from bookings where tenant_id = ${t.id} and check_in = ${today}::date and status in ('confirmed','pending_payment')) as "arrivalsPending",
          (select count(*)::int from bookings where tenant_id = ${t.id} and check_in = ${today}::date and status = 'checked_in') as "arrivalsDone",
          (select count(*)::int from bookings where tenant_id = ${t.id} and check_out = ${today}::date and status = 'checked_in') as "departuresPending",
          (select count(*)::int from bookings where tenant_id = ${t.id} and check_out = ${today}::date and status = 'checked_out') as "departuresDone",
          (select count(*)::int from bookings where tenant_id = ${t.id} and status = 'checked_in') as "inHouse",
          (select count(*)::int from rooms where tenant_id = ${t.id} and status = 'active') as "rooms",
          (select count(*)::int from rooms where tenant_id = ${t.id} and housekeeping_status = 'dirty') as "dirtyRooms",
          (select count(*)::int from rooms where tenant_id = ${t.id} and status = 'out_of_service') as "outOfService",
          (select count(*)::int from payments where tenant_id = ${t.id} and status = 'pending_verification') as "paymentsToVerify",
          (select count(*)::int from service_requests where tenant_id = ${t.id} and resolved_at is null and status not in ('cancelled','closed','resolved')) as "openRequests",
          (select count(*)::int from service_requests where tenant_id = ${t.id} and resolved_at is null and status not in ('cancelled','closed','resolved') and due_at < now()) as "overdueRequests",
          (select count(*)::int from orders where tenant_id = ${t.id} and status in ('new','accepted','preparing','ready')) as "liveOrders",
          (select count(*)::int from restaurant_reservations where tenant_id = ${t.id} and status in ('confirmed','seated') and (starts_at at time zone ${t.timezone})::date = ${today}::date) as "tablesToday",
          (select coalesce(sum(party_size),0)::int from restaurant_reservations where tenant_id = ${t.id} and status in ('confirmed','seated') and (starts_at at time zone ${t.timezone})::date = ${today}::date) as "coversToday",
          (select count(*)::int from maintenance_tickets where tenant_id = ${t.id} and status not in ('resolved','closed')) as "openTickets",
          (select count(*)::int from guest_messages where tenant_id = ${t.id} and sender_type = 'guest' and read_at is null) as "unreadMessages",
          (select count(*)::int from bookings where tenant_id = ${t.id} and status = 'pending_payment') as "pendingPaymentBookings"`);
      const next7 = await rows(tx, sql`
        with days as (select generate_series(${today}::date, ${today}::date + 6, '1 day')::date as d)
        select to_char(d, 'YYYY-MM-DD') as date,
          (select count(*)::int from bookings b where b.tenant_id = ${t.id} and b.status in ('confirmed','checked_in') and b.check_in <= d and b.check_out > d) as occupied,
          (select count(*)::int from bookings b where b.tenant_id = ${t.id} and b.status in ('confirmed','pending_payment') and b.check_in = d) as arrivals
        from days order by d`);
      return { data: { today, ...d, next7 } };
    });
  });
};
