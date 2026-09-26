import { expect, test } from '@playwright/test';
import Redis from 'ioredis';
import postgres from 'postgres';
import { CITY } from './helpers';

/**
 * Regression: a suspended property must go offline even if the web tier never receives a cache purge
 * (lost purge, several web servers, a long-running server with stale cached pages).
 */
test('a suspended property goes offline without relying on a cache purge', async ({ request }) => {
  // Warm the web tier's cache for the city hotel's site.
  expect((await request.get(`${CITY}/`)).status()).toBe(200);
  expect((await request.get(`${CITY}/`)).status()).toBe(200);

  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://hp:hp_dev_password@localhost:5433/hp', { max: 1 });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'printworks'`;
  try {
    // Suspend behind the web tier's back: database + API tenant cache only, no purge sent.
    await sql`update tenants set status = 'suspended' where id = ${t!.id}`;
    await redis.del(`tenant:${t!.id}`);
    await expect.poll(async () => (await request.get(`${CITY}/`)).status(), { timeout: 10_000 }).toBe(404);
    expect((await request.get(`${CITY}/rooms`)).status()).toBe(404);
  } finally {
    await sql`update tenants set status = 'active' where id = ${t!.id}`;
    await redis.del(`tenant:${t!.id}`);
    await sql.end();
    redis.disconnect();
  }
  await expect.poll(async () => (await request.get(`${CITY}/`)).status(), { timeout: 10_000 }).toBe(200);
});
