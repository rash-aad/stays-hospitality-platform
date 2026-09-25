import { createDb, type Db, type Tx } from '@hp/db';
import { sql } from 'drizzle-orm';

export type { Db, Tx };

let instance: ReturnType<typeof createDb> | null = null;

export function initDb(url: string, max = 20) {
  instance = createDb(url, { max });
  return instance;
}

export function db(): Db {
  if (!instance) throw new Error('db not initialised');
  return instance.db;
}

export async function closeDb() {
  await instance?.sql.end({ timeout: 5 });
  instance = null;
}

export async function pingDb() {
  await db().execute(sql`select 1`);
}

/**
 * Run `fn` in a transaction scoped to one tenant. Row-level security policies read
 * app.tenant_id, so even a query that forgets its tenant filter cannot see other tenants.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const hooks: (() => void)[] = [];
  const result = await db().transaction(async (tx) => {
    commitHooks.set(tx, hooks);
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
  for (const h of hooks) h();
  return result;
}

const commitHooks = new WeakMap<Tx, (() => void)[]>();
/** Run a side effect only after the surrounding tenant transaction has committed (e.g. cache purges). */
export function afterCommit(tx: Tx, fn: () => void) {
  const hooks = commitHooks.get(tx);
  if (hooks) hooks.push(fn);
  else fn();
}

/** Cross-tenant/system work (host resolution, login lookup, platform admin, jobs). Use sparingly. */
export function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
