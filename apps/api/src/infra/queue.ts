import { Queue, Worker, type Job, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { jobCounter } from './metrics.js';

export type JobName =
  | 'notify'
  | 'expire-holds'
  | 'reconcile-gateway'
  | 'sla-sweep'
  | 'generate-housekeeping'
  | 'reminders'
  | 'daily-report'
  | 'subscriptions'
  | 'ical-sync';

let queue: Queue | null = null;
let connection: Redis | null = null;

export function initQueue(conn: Redis) {
  connection = conn;
  queue = new Queue('hp', { connection: conn, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
  return queue;
}

export async function enqueue(name: JobName, data: Record<string, unknown>, opts: { delayMs?: number; jobId?: string } = {}) {
  if (!queue) return; // queue disabled (e.g. unit tests)
  await queue.add(name, data, { delay: opts.delayMs, jobId: opts.jobId });
}

export async function scheduleRepeating() {
  if (!queue) return;
  await queue.upsertJobScheduler('expire-holds', { every: 60_000 }, { name: 'expire-holds', data: {} });
  await queue.upsertJobScheduler('sla-sweep', { every: 60_000 }, { name: 'sla-sweep', data: {} });
  await queue.upsertJobScheduler('reconcile-gateway', { every: 5 * 60_000 }, { name: 'reconcile-gateway', data: {} });
  await queue.upsertJobScheduler('reminders', { every: 10 * 60_000 }, { name: 'reminders', data: {} });
  await queue.upsertJobScheduler('ical-sync', { every: 30 * 60_000 }, { name: 'ical-sync', data: {} });
  await queue.upsertJobScheduler('daily-report', { every: 60 * 60_000 }, { name: 'daily-report', data: {} });
  await queue.upsertJobScheduler('subscriptions', { every: 60 * 60_000 }, { name: 'subscriptions', data: {} });
  await queue.upsertJobScheduler('generate-housekeeping', { pattern: '0 30 0 * * *' }, { name: 'generate-housekeeping', data: {} });
}

export function startWorker(handlers: Partial<Record<JobName, (job: Job) => Promise<unknown>>>) {
  if (!connection) throw new Error('queue not initialised');
  const processor: Processor = async (job) => {
    const h = handlers[job.name as JobName];
    if (!h) return;
    try {
      const r = await h(job);
      jobCounter.inc({ queue: 'hp', name: job.name, result: 'ok' });
      return r;
    } catch (e) {
      jobCounter.inc({ queue: 'hp', name: job.name, result: 'error' });
      throw e;
    }
  };
  return new Worker('hp', processor, { connection: connection.duplicate(), concurrency: 5 });
}

export async function queueStats() {
  if (!queue) return null;
  return queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
}

export async function closeQueue() {
  await queue?.close();
  queue = null;
}
