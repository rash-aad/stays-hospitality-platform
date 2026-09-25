import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { initTokens } from './domain/auth/tokens.js';
import { closeDb, initDb } from './infra/db.js';
import { closeQueue, initQueue, scheduleRepeating } from './infra/queue.js';
import { closeRedis, initRedis } from './infra/redis.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
initDb(config.APP_DATABASE_URL);
const r = initRedis(config.REDIS_URL);
initQueue(r);
initTokens(config.JWT_SECRET);

const app = await buildApp(config);
const worker = config.INLINE_WORKER === '1' ? await startJobs(config) : null;
await scheduleRepeating();

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  await app.close(); // stop accepting, drain in-flight requests
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await closeDb();
  clearTimeout(force);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
