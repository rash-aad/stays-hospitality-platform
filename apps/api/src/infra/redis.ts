import { Redis } from 'ioredis';

let client: Redis | null = null;

export function initRedis(url: string) {
  client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  return client;
}

export function redis(): Redis {
  if (!client) throw new Error('redis not initialised');
  return client;
}

export async function closeRedis() {
  await client?.quit();
  client = null;
}
