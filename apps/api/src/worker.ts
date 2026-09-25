import { loadConfig } from './config.js';
import { initDb } from './infra/db.js';
import { initQueue, scheduleRepeating } from './infra/queue.js';
import { initRedis } from './infra/redis.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
initDb(config.APP_DATABASE_URL, 5);
initQueue(initRedis(config.REDIS_URL));
await scheduleRepeating();
const worker = await startJobs(config);
console.log('worker started');
const stop = async () => { await worker.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
