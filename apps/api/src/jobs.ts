import type { Config } from './config.js';
import { startWorker } from './infra/queue.js';
import { dispatchNotifications, initTransports } from './domain/notifications/dispatch.js';

export async function startJobs(config: Config) {
  initTransports(config);
  return startWorker({
    notify: () => dispatchNotifications(),
  });
}
