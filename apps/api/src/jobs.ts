import type { Config } from './config.js';
import { startWorker } from './infra/queue.js';
import { asSystem } from './infra/db.js';
import { dispatchNotifications, initTransports } from './domain/notifications/dispatch.js';
import { expireHolds } from './domain/bookings/service.js';
import { slaSweep } from './domain/requests/service.js';
import { generateDailyTasks } from './domain/housekeeping/routes.js';
import { expireStalePayments } from './domain/payments/expiry.js';
import { reconcileGatewayPayments } from './domain/payments/reconcile.js';
import { sendReminders } from './domain/engagement/reminders.js';
import { syncAllFeeds } from './domain/channels/routes.js';
import { sendDueDailyReports } from './domain/operations/report.js';
import { properties, tenantModules, tenants } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { todayIn } from './lib/dates.js';

export async function startJobs(config: Config) {
  initTransports(config);
  return startWorker({
    notify: () => dispatchNotifications(),
    'expire-holds': async () => {
      await dispatchNotifications();
      const bookings = await asSystem((tx) => expireHolds(tx));
      const other = await asSystem((tx) => expireStalePayments(tx));
      return { bookings, other };
    },
    'sla-sweep': () => asSystem((tx) => slaSweep(tx)),
    'reconcile-gateway': () => reconcileGatewayPayments(),
    reminders: () => sendReminders(),
    'ical-sync': () => syncAllFeeds(),
    'daily-report': () => sendDueDailyReports(),
    'generate-housekeeping': () =>
      asSystem(async (tx) => {
        const rows = await tx.select({ t: tenants, p: properties }).from(tenants).innerJoin(properties, eq(properties.tenantId, tenants.id))
          .innerJoin(tenantModules, and(eq(tenantModules.tenantId, tenants.id), eq(tenantModules.moduleKey, 'housekeeping'), eq(tenantModules.enabled, true)));
        let n = 0;
        for (const r of rows) n += await generateDailyTasks(tx, r.t.id, r.p.id, todayIn(r.p.timezone));
        return n;
      }),
  });
}
