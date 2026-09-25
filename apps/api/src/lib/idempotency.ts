import { idempotencyKeys } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { conflict, unprocessable } from '../http/errors.js';
import { withTenant } from '../infra/db.js';
import { sha256 } from './ids.js';

/**
 * Exactly-once semantics for critical POSTs (bookings, payments). A retried request with the same
 * Idempotency-Key and body replays the stored response; a different body under the same key is rejected.
 */
export async function idempotent<T>(
  req: FastifyRequest,
  tenantId: string,
  scope: string,
  run: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !key) return { ...(await run()), replayed: false };
  if (key.length > 200) throw unprocessable('Idempotency-Key too long');
  const actorKey = req.actor.type === 'guest' ? req.actor.guestId : req.actor.type === 'staff' ? req.actor.userId : 'anon';
  const scoped = `${scope}:${actorKey}`;
  const requestHash = sha256(JSON.stringify(req.body ?? null));
  const where = and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.scope, scoped), eq(idempotencyKeys.key, key));

  const inserted = await withTenant(tenantId, (tx) =>
    tx.insert(idempotencyKeys).values({ tenantId, scope: scoped, key, requestHash }).onConflictDoNothing().returning(),
  );
  if (inserted.length === 0) {
    const [row] = await withTenant(tenantId, (tx) => tx.select().from(idempotencyKeys).where(where));
    if (!row) throw conflict('Idempotency key state unavailable, retry');
    if (row.requestHash !== requestHash) throw unprocessable('Idempotency-Key was reused with a different request body');
    if (row.responseStatus == null) throw conflict('A request with this Idempotency-Key is still in progress');
    return { status: row.responseStatus, body: row.responseBody as T, replayed: true };
  }
  try {
    const result = await run();
    await withTenant(tenantId, (tx) =>
      tx.update(idempotencyKeys).set({ responseStatus: result.status, responseBody: result.body as unknown }).where(where),
    );
    return { ...result, replayed: false };
  } catch (err) {
    await withTenant(tenantId, (tx) => tx.delete(idempotencyKeys).where(where));
    throw err;
  }
}
