import { reportRuns, tenants, users } from '@hp/db';
import { and, eq, sql } from 'drizzle-orm';
import { asSystem, withTenant, type Tx } from '../../infra/db.js';
import { addDays, formatDate, todayIn } from '../../lib/dates.js';
import { formatMoney } from '../../lib/money.js';
import { loadStaffAccess } from '../auth/permissions.js';
import { notify } from '../notifications/notify.js';
import { dailySummary, type DailySummary } from './daily.js';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function reportText(s: DailySummary, currency: string) {
  const m = (n: number) => formatMoney(n, currency);
  const pay = s.payments.byMethod.map((p) => `  ${p.tender ? `${p.method.replace(/_/g, ' ')} (${p.tender})` : p.method.replace(/_/g, ' ')}: ${m(p.amount)} × ${p.count}`).join('\n') || '  none';
  return [
    `Rooms: ${s.rooms.sold} of ${s.rooms.available} sold (${pct(s.rooms.occupancy)}) · ADR ${m(s.rooms.adr)} · RevPAR ${m(s.rooms.revpar)}${s.rooms.outOfService ? ` · ${s.rooms.outOfService} out of service` : ''}`,
    `Arrivals ${s.movements.arrivals} · departures ${s.movements.departures} · no-shows ${s.movements.noShows} · cancellations ${s.movements.cancellations}`,
    `New bookings: ${s.movements.newBookings} worth ${m(s.movements.newBookingValue)}`,
    '',
    `Revenue ${m(s.revenue.total)}: rooms ${m(s.revenue.rooms)} · food & drink ${m(s.revenue.food)} (${s.revenue.foodOrders} orders) · experiences ${m(s.revenue.experiences)} · other ${m(s.revenue.other)}`,
    `Money received ${m(s.payments.received)}${s.payments.refunds.amount ? ` · refunds ${m(s.payments.refunds.amount)}` : ''}`,
    pay,
    `Balance owed by in-house guests: ${m(s.outstanding.inHouseBalance)}`,
    s.feedback.responses ? `Guest feedback: ${s.feedback.responses} (average ${s.feedback.average})${s.feedback.low ? ` — ${s.feedback.low} unhappy, please follow up` : ''}` : '',
  ].filter((l) => l !== null).join('\n');
}

/** Email the day's report to everyone who can read reports (unless they opted out). Sent once per tenant and date. */
export async function sendDailyReport(tx: Tx, tenantId: string, date: string) {
  const [claimed] = await tx.insert(reportRuns).values({ tenantId, kind: 'daily', date }).onConflictDoNothing().returning();
  if (!claimed) return 0;
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  const summary = await dailySummary(tx, tenantId, t!.timezone, date);
  const staff = await tx.select({ id: users.id, prefs: users.notificationPrefs }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, 'active')));
  let sent = 0;
  for (const u of staff) {
    if (u.prefs?.dailyReport === false) continue;
    const access = await loadStaffAccess(tenantId, u.id);
    if (!access.isOwner && !access.permissions.includes('reports.read')) continue;
    await notify(tx, { tenantId, recipient: { type: 'user', id: u.id }, templateKey: 'report.daily', channels: ['email'], vars: { property: t!.name, date: formatDate(date), body: reportText(summary, t!.currency) } });
    sent++;
  }
  return sent;
}

/** Hourly job: after 7am local time, send yesterday's report for any tenant that didn't close the day itself. */
export async function sendDueDailyReports(now = new Date()) {
  const list = await asSystem((tx) => tx.execute<{ id: string; timezone: string }>(sql`
    select t.id, t.timezone from tenants t join tenant_modules m on m.tenant_id = t.id and m.module_key = 'reports' and m.enabled where t.status = 'active'`));
  let sent = 0;
  for (const t of list) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: t.timezone }).format(now));
    if (hour < 7) continue;
    sent += await withTenant(t.id, (tx) => sendDailyReport(tx, t.id, addDays(todayIn(t.timezone, now), -1)));
  }
  return sent;
}
