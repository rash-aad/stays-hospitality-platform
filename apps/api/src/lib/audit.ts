import { auditLogs } from '@hp/db';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../infra/db.js';

export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string;
  changes?: Record<string, unknown>;
  tenantId?: string | null;
  /** Explicit actor when the request isn't authenticated yet (e.g. the login itself). */
  actor?: { type: 'user' | 'guest' | 'platform'; id: string };
};

/** Record a sensitive action. Actor, tenant, IP and request id come from the verified request. */
export async function audit(tx: Tx, req: FastifyRequest | null, input: AuditInput) {
  const actor = req?.actor ?? { type: 'anon' as const };
  const actorType = actor.type === 'staff' ? 'user' : actor.type === 'anon' ? 'system' : actor.type;
  const actorId = actor.type === 'staff' || actor.type === 'platform' ? actor.userId : actor.type === 'guest' ? actor.guestId : null;
  if (input.actor) {
    await tx.insert(auditLogs).values({ tenantId: input.tenantId ?? null, actorType: input.actor.type, actorId: input.actor.id, action: input.action, entityType: input.entityType, entityId: input.entityId, changes: input.changes, ip: req?.ip, requestId: req?.id });
    return;
  }
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId !== undefined ? input.tenantId : (req?.tenant?.id ?? null),
    actorType,
    actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    changes: input.changes,
    ip: req?.ip,
    requestId: req?.id,
  });
}
