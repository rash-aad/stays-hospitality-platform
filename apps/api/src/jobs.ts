import type { Config } from './config.js';
import { startWorker } from './infra/queue.js';
import { asSystem } from './infra/db.js';
import { dispatchNotifications, initTransports } from './domain/notifications/dispatch.js';
import { expireHolds } from './domain/bookings/service.js';

export async function startJobs(config: Config) {
  initTransports(config);
  return startWorker({
    notify: () => dispatchNotifications(),
    'expire-holds': async () => {
      await dispatchNotifications();
      return asSystem((tx) => expireHolds(tx));
    },
  });
}
