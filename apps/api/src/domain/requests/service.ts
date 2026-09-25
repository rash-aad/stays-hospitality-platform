import type { ModuleKey } from '@hp/contracts';
import {
  entityEvents, housekeepingTasks, maintenanceTickets, properties, rooms, serviceRequests, serviceRequestTypes, users,
  type RequestFormField, type RequestWorkflow,
} from '@hp/db';
import { and, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, forbidden, moduleDisabled, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { todayIn } from '../../lib/dates.js';
import { reference } from '../../lib/ids.js';
import { outer } from '../../lib/sql.js';
import { requireInHouse, type StayContext } from '../guests/access.js';
import { notify } from '../notifications/notify.js';

type RequestType = typeof serviceRequestTypes.$inferSelect;
type Request = typeof serviceRequests.$inferSelect;

export const DEFAULT_WORKFLOW: RequestWorkflow = {
  statuses: [
    { key: 'open', label: 'Open', guestLabel: 'Received' },
    { key: 'acknowledged', label: 'Acknowledged', guestLabel: 'Seen by our team' },
    { key: 'in_progress', label: 'In progress', guestLabel: 'On its way' },
    { key: 'resolved', label: 'Resolved', guestLabel: 'Done', terminal: true },
    { key: 'cancelled', label: 'Cancelled', guestLabel: 'Cancelled', terminal: true },
  ],
  transitions: {
    open: ['acknowledged', 'in_progress', 'resolved', 'cancelled'],
    acknowledged: ['in_progress', 'resolved', 'cancelled'],
    in_progress: ['resolved', 'cancelled'],
    resolved: ['open'],
    cancelled: [],
  },
};

export const workflowOf = (t: Pick<RequestType, 'workflow'>) => t.workflow ?? DEFAULT_WORKFLOW;
export const isTerminal = (wf: RequestWorkflow, status: string) => !!wf.statuses.find((s) => s.key === status)?.terminal;
export const guestLabel = (wf: RequestWorkflow, status: string) => wf.statuses.find((s) => s.key === status)?.guestLabel ?? status;

/** Validate workflow shape when a tenant configures a custom one. */
export function validateWorkflow(wf: RequestWorkflow) {
  const keys = new Set(wf.statuses.map((s) => s.key));
  if (!keys.size || !wf.statuses[0]) throw badRequest('Workflow needs at least one status');
  if (!wf.statuses.some((s) => s.terminal)) throw badRequest('Workflow needs at least one final status');
  for (const [from, tos] of Object.entries(wf.transitions)) {
    if (!keys.has(from) || tos.some((t) => !keys.has(t))) throw badRequest(`Workflow transition references an unknown status: ${from}`);
  }
}

/** Validate and coerce answers against the type's form schema; unknown keys are dropped. */
export function validateDetails(fields: RequestFormField[], details: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = details[f.key];
    if (v == null || v === '') {
      if (f.required) throw badRequest(`${f.label} is required`);
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw badRequest(`${f.label} must be a number`);
      out[f.key] = n;
    } else if (f.type === 'select') {
      if (!f.options?.includes(String(v))) throw badRequest(`Choose a valid option for ${f.label}`);
      out[f.key] = String(v);
    } else if (f.type === 'datetime') {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw badRequest(`${f.label} must be a date and time`);
      out[f.key] = d.toISOString();
    } else {
      out[f.key] = String(v).slice(0, f.type === 'textarea' ? 2000 : 200);
    }
  }
  return out;
}

export async function createRequest(
  tx: Tx,
  tenant: TenantInfo,
  input: {
    typeId: string;
    description?: string | null;
    details?: Record<string, unknown>;
    priority?: Request['priority'];
    guest?: StayContext;
    staffUserId?: string;
    roomId?: string | null;
    attachmentIds?: string[];
  },
) {
  const [type] = await tx.select().from(serviceRequestTypes).where(and(eq(serviceRequestTypes.id, input.typeId), eq(serviceRequestTypes.tenantId, tenant.id), eq(serviceRequestTypes.active, true)));
  if (!type) throw notFound('Request type');
  if (!tenant.modules.has(type.moduleKey as ModuleKey)) throw moduleDisabled(type.moduleKey);
  const details = validateDetails(type.formSchema, input.details);

  let roomId: string | null = null;
  let stayId: string | null = null;
  let propertyId: string;
  if (input.guest) {
    if (!type.guestVisible) throw forbidden('This request is handled by staff only');
    if (!input.guest.verified) throw forbidden('Please verify your email before sending requests');
    // Room context comes from the guest's verified in-house stay — never from the request body.
    const stay = type.requiresStay ? requireInHouse(input.guest) : input.guest.stay;
    roomId = stay?.inHouse ? stay.roomId : null;
    stayId = stay?.id ?? null;
    propertyId = stay?.propertyId ?? (await tx.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, tenant.id)).limit(1))[0]!.id;
  } else {
    if (input.roomId) {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, input.roomId), eq(rooms.tenantId, tenant.id)));
      if (!room) throw badRequest('Unknown room');
      roomId = room.id;
      propertyId = room.propertyId;
    } else {
      propertyId = (await tx.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, tenant.id)).limit(1))[0]!.id;
    }
  }
  const wf = workflowOf(type);
  const [req] = await tx.insert(serviceRequests).values({
    tenantId: tenant.id, propertyId, typeId: type.id, guestId: input.guest?.guest.id ?? null, stayId, roomId, reference: reference('RQ'),
    title: type.name, description: input.description?.slice(0, 2000), details, priority: input.priority ?? type.defaultPriority, status: wf.statuses[0]!.key,
    dueAt: new Date(Date.now() + type.slaMinutes * 60_000), source: input.guest ? 'guest' : 'staff', createdByUserId: input.staffUserId ?? null,
  }).returning();
  await tx.insert(entityEvents).values({
    tenantId: tenant.id, entityType: 'service_request', entityId: req!.id, kind: 'created', toValue: req!.status, visibility: 'guest',
    actorType: input.guest ? 'guest' : 'user', actorId: input.guest?.guest.id ?? input.staffUserId ?? null,
  });
  for (const fileId of input.attachmentIds ?? []) {
    await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'service_request', entityId: req!.id, kind: 'attachment', body: fileId, actorType: input.guest ? 'guest' : 'user', actorId: input.guest?.guest.id ?? input.staffUserId ?? null, visibility: 'guest' });
  }

  // Route into the operational module that does the work.
  if (type.routesTo === 'housekeeping_task' && roomId && tenant.modules.has('housekeeping')) {
    const [prop] = await tx.select().from(properties).where(eq(properties.id, propertyId));
    await tx.insert(housekeepingTasks).values({
      tenantId: tenant.id, propertyId, roomId, kind: 'guest_request', priority: req!.priority, scheduledFor: todayIn(prop!.timezone), serviceRequestId: req!.id,
      notes: [type.name, input.description].filter(Boolean).join(' — '),
    });
  }
  if (type.routesTo === 'maintenance_ticket' && tenant.modules.has('maintenance')) {
    const [room] = roomId ? await tx.select().from(rooms).where(eq(rooms.id, roomId)) : [];
    const cat = String(details.category ?? 'other');
    await tx.insert(maintenanceTickets).values({
      tenantId: tenant.id, propertyId, roomId, locationLabel: room ? `Room ${room.number}` : String(details.location ?? 'Property'), reference: reference('MT'),
      title: input.description?.slice(0, 120) || type.name, description: input.description, category: (['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'structural', 'it'].includes(cat) ? cat : 'other') as 'other',
      priority: req!.priority, severity: req!.priority === 'urgent' ? 'critical' : 'minor', serviceRequestId: req!.id, reportedByType: input.guest ? 'guest' : 'staff', reportedById: input.guest?.guest.id ?? input.staffUserId ?? null,
    });
  }
  return req!;
}

export async function transitionRequest(
  tx: Tx,
  tenant: TenantInfo,
  id: string,
  to: string,
  actor: { type: 'user' | 'guest' | 'system'; id: string | null },
  guestNote?: string | null,
) {
  const [r] = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, tenant.id))).for('update');
  if (!r || (actor.type === 'guest' && r.guestId !== actor.id)) throw notFound('Request');
  const [type] = await tx.select().from(serviceRequestTypes).where(eq(serviceRequestTypes.id, r.typeId));
  const wf = workflowOf(type!);
  if (actor.type === 'guest' && (to !== 'cancelled' || r.status !== wf.statuses[0]!.key)) throw conflict('This request is already being handled');
  if (r.status === to) return r;
  if (!(wf.transitions[r.status] ?? []).includes(to)) throw conflict(`Cannot move from ${r.status} to ${to}`);
  const terminal = isTerminal(wf, to);
  const [u] = await tx.update(serviceRequests).set({ status: to, resolvedAt: terminal ? new Date() : null, customerNote: guestNote ?? r.customerNote }).where(eq(serviceRequests.id, r.id)).returning();
  await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'service_request', entityId: r.id, kind: 'status', fromValue: r.status, toValue: to, body: guestNote, actorType: actor.type, actorId: actor.id, visibility: 'guest' });
  if (r.guestId && actor.type !== 'guest') {
    await notify(tx, {
      tenantId: tenant.id, recipient: { type: 'guest', id: r.guestId }, templateKey: 'request.status', channels: ['in_app', 'push'],
      vars: { title: r.title, reference: r.reference, status: guestLabel(wf, to).toLowerCase(), note: guestNote ? ` ${guestNote}` : '' }, related: { type: 'service_request', id: r.id },
    });
  }
  return u!;
}

/** Called by housekeeping/maintenance when the linked work is finished. */
export async function resolveLinkedRequest(tx: Tx, tenant: TenantInfo, requestId: string | null, actorId: string | null) {
  if (!requestId) return;
  const [r] = await tx.select().from(serviceRequests).where(eq(serviceRequests.id, requestId));
  if (!r) return;
  const [type] = await tx.select().from(serviceRequestTypes).where(eq(serviceRequestTypes.id, r.typeId));
  const wf = workflowOf(type!);
  if (isTerminal(wf, r.status)) return;
  const target = wf.statuses.find((s) => s.terminal && s.key !== 'cancelled')?.key;
  if (target && (wf.transitions[r.status] ?? []).includes(target)) await transitionRequest(tx, tenant, r.id, target, { type: 'user', id: actorId });
}

export async function assignRequest(tx: Tx, tenant: TenantInfo, id: string, userId: string | null, actorId: string) {
  if (userId) {
    const [u] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenant.id), eq(users.status, 'active')));
    if (!u) throw badRequest('Unknown staff member');
  }
  const [r] = await tx.update(serviceRequests).set({ assignedUserId: userId }).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, tenant.id))).returning();
  if (!r) throw notFound('Request');
  await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'service_request', entityId: id, kind: 'assignment', toValue: userId, actorType: 'user', actorId });
  if (userId) await notify(tx, { tenantId: tenant.id, recipient: { type: 'user', id: userId }, templateKey: 'request.status', channels: ['in_app'], vars: { title: r.title, reference: r.reference, status: 'assigned to you', note: '' }, related: { type: 'service_request', id } });
  return r;
}

export async function addRequestNote(tx: Tx, tenant: TenantInfo, id: string, body: string, visibility: 'internal' | 'guest', actor: { type: 'user' | 'guest'; id: string }) {
  const [r] = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, tenant.id)));
  if (!r || (actor.type === 'guest' && r.guestId !== actor.id)) throw notFound('Request');
  const [e] = await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'service_request', entityId: id, kind: 'note', body: body.slice(0, 2000), visibility: actor.type === 'guest' ? 'guest' : visibility, actorType: actor.type, actorId: actor.id }).returning();
  if (visibility === 'guest' && actor.type === 'user' && r.guestId) {
    await tx.update(serviceRequests).set({ customerNote: body.slice(0, 500) }).where(eq(serviceRequests.id, id));
    await notify(tx, { tenantId: tenant.id, recipient: { type: 'guest', id: r.guestId }, templateKey: 'request.status', channels: ['in_app', 'push'], vars: { title: r.title, reference: r.reference, status: 'updated', note: ` ${body}` }, related: { type: 'service_request', id } });
  }
  return e!;
}

/** Escalate open requests past their SLA once (normal→high, high→urgent). */
export async function slaSweep(tx: Tx) {
  const overdue = await tx
    .select({ r: serviceRequests })
    .from(serviceRequests)
    .where(and(lt(serviceRequests.dueAt, new Date()), isNull(serviceRequests.resolvedAt), inArray(serviceRequests.priority, ['low', 'normal', 'high']), notInArray(serviceRequests.status, ['resolved', 'closed', 'cancelled']),
      sql`not exists (select 1 from entity_events e where e.entity_id = ${outer(serviceRequests.id)} and e.kind = 'priority' and e.actor_type = 'system')`))
    .limit(200)
    .for('update', { skipLocked: true });
  for (const { r } of overdue) {
    const next = r.priority === 'high' ? 'urgent' : 'high';
    await tx.update(serviceRequests).set({ priority: next }).where(eq(serviceRequests.id, r.id));
    await tx.insert(entityEvents).values({ tenantId: r.tenantId, entityType: 'service_request', entityId: r.id, kind: 'priority', fromValue: r.priority, toValue: next, body: 'SLA breached — escalated', actorType: 'system' });
  }
  return overdue.length;
}
