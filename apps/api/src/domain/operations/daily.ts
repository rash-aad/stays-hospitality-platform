import { sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';

const one = async <T>(tx: Tx, q: ReturnType<typeof sql>) => ((await tx.execute(q)) as unknown as T[])[0]!;
const all = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

export type DailySummary = Awaited<ReturnType<typeof dailySummary>>;

/** The day's figures: rooms (occupancy, ADR, RevPAR), movements, revenue by department, money in and out. */
export async function dailySummary(tx: Tx, tenantId: string, timezone: string, date: string) {
  // Column names are internal constants; the time zone is passed as a bound parameter.
  const local = (col: string) => sql`(${sql.raw(col)} at time zone ${timezone})::date`;
  const rooms = await one<{ available: number; sold: number; revenue: number; outOfService: number }>(tx, sql`
    with n as (
      select (x->>'price')::int as price from bookings b join booking_items bi on bi.booking_id = b.id and bi.kind = 'room', jsonb_array_elements(bi.nightly) x
      where b.tenant_id = ${tenantId} and b.status in ('confirmed','checked_in','checked_out') and (x->>'date')::date = ${date}::date
    )
    select (select count(*)::int from rooms where tenant_id = ${tenantId} and status = 'active') as available,
           (select count(*)::int from rooms where tenant_id = ${tenantId} and status <> 'active') as "outOfService",
           (select count(*)::int from n) as sold, (select coalesce(sum(price), 0)::int from n) as revenue`);
  const moves = await one<{ arrivals: number; departures: number; noShows: number; cancellations: number; newBookings: number; newBookingValue: number; inHouse: number }>(tx, sql`
    select count(*) filter (where check_in = ${date}::date and status in ('checked_in','checked_out'))::int as arrivals,
           count(*) filter (where check_out = ${date}::date and status = 'checked_out')::int as departures,
           count(*) filter (where check_in = ${date}::date and status = 'no_show')::int as "noShows",
           count(*) filter (where status = 'cancelled' and ${local('cancelled_at')} = ${date}::date)::int as cancellations,
           count(*) filter (where ${local('created_at')} = ${date}::date and status in ('confirmed','checked_in','checked_out'))::int as "newBookings",
           coalesce(sum(total) filter (where ${local('created_at')} = ${date}::date and status in ('confirmed','checked_in','checked_out')), 0)::int as "newBookingValue",
           count(*) filter (where check_in <= ${date}::date and check_out > ${date}::date and status in ('checked_in','checked_out'))::int as "inHouse"
    from bookings where tenant_id = ${tenantId}`);
  const depts = await one<{ food: number; foodOrders: number; experiences: number; charges: number }>(tx, sql`
    select (select coalesce(sum(total), 0)::int from orders where tenant_id = ${tenantId} and status not in ('cancelled','pending_payment') and ${local('created_at')} = ${date}::date) as food,
           (select count(*)::int from orders where tenant_id = ${tenantId} and status not in ('cancelled','pending_payment') and ${local('created_at')} = ${date}::date) as "foodOrders",
           (select coalesce(sum(total), 0)::int from experience_bookings where tenant_id = ${tenantId} and status in ('confirmed','completed') and ${local('created_at')} = ${date}::date) as experiences,
           (select coalesce(sum(amount + tax_amount), 0)::int from folio_charges where tenant_id = ${tenantId} and source_type = 'manual' and ${local('created_at')} = ${date}::date) as charges`);
  const payments = await all<{ method: string; tender: string | null; count: number; amount: number }>(tx, sql`
    select method, tender, count(*)::int as count, coalesce(sum(amount), 0)::int as amount from payments
    where tenant_id = ${tenantId} and status in ('captured','partially_refunded','refunded') and ${local('coalesce(verified_at, created_at)')} = ${date}::date
    group by method, tender order by amount desc`);
  const refunds = await one<{ count: number; amount: number }>(tx, sql`
    select count(*)::int as count, coalesce(sum(amount), 0)::int as amount from refunds where tenant_id = ${tenantId} and status in ('processed','recorded') and ${local('created_at')} = ${date}::date`);
  const outstanding = await one<{ inHouseBalance: number }>(tx, sql`
    select coalesce(sum(b.total + coalesce((select sum(f.amount + f.tax_amount) from folio_charges f where f.booking_id = b.id), 0) - b.amount_paid), 0)::int as "inHouseBalance"
    from bookings b where b.tenant_id = ${tenantId} and b.status = 'checked_in'`);
  const feedback = await one<{ responses: number; average: number | null; low: number }>(tx, sql`
    select count(*)::int as responses, round(avg(overall)::numeric, 2)::float as average, count(*) filter (where overall <= 2)::int as low
    from guest_feedback where tenant_id = ${tenantId} and ${local('created_at')} = ${date}::date`);
  const available = rooms.available;
  return {
    date,
    rooms: {
      available, sold: rooms.sold, outOfService: rooms.outOfService, revenue: rooms.revenue,
      occupancy: available ? rooms.sold / available : 0,
      adr: rooms.sold ? Math.round(rooms.revenue / rooms.sold) : 0,
      revpar: available ? Math.round(rooms.revenue / available) : 0,
    },
    movements: moves,
    revenue: { rooms: rooms.revenue, food: depts.food, experiences: depts.experiences, other: depts.charges, total: rooms.revenue + depts.food + depts.experiences + depts.charges, foodOrders: depts.foodOrders },
    payments: { byMethod: payments, received: payments.reduce((s, p) => s + p.amount, 0), refunds },
    outstanding,
    feedback,
  };
}
