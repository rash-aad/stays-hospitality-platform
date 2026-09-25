import { entityEvents, files, rooms, serviceRequests, serviceRequestTypes, users } from '@hp/db';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { crud } from '../../http/crud.js';
import { badRequest, notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { addRequestNote, assignRequest, createRequest, transitionRequest, validateWorkflow, workflowOf } from './service.js';

const idParam = z.object({ id: z.string().uuid() });
const formField = z.object({ key: z.string().regex(/^[a-z_]{1,30}$/), label: z.string().min(1).max(60), type: z.enum(['text', 'textarea', 'number', 'datetime', 'time', 'select']), required: z.boolean().optional(), options: z.array(z.string().max(60)).max(20).optional() });
const workflow = z.object({
  statuses: z.array(z.object({ key: z.string().regex(/^[a-z_]{2,30}$/), label: z.string().max(40), terminal: z.boolean().optional(), guestLabel: z.string().max(60).optional() })).min(2).max(12),
  transitions: z.record(z.string(), z.array(z.string())),
});

export const requestRoutes: Routes = async (app) => {
  crud(app, {
    path: '/admin/request-types', entity: 'service_request_type', table: serviceRequestTypes, permission: 'requests.configure', readPermission: 'requests.manage', tag: 'requests', orderBy: serviceRequestTypes.sort,
    body: z.object({
      key: z.string().regex(/^[a-z_]{2,40}$/), name: z.string().min(2).max(80), description: z.string().max(300).nullable().optional(),
      category: z.enum(['housekeeping', 'maintenance', 'concierge', 'room_service', 'front_desk', 'transport', 'spa', 'activities', 'dining']),
      moduleKey: z.enum(['housekeeping', 'maintenance', 'concierge', 'room_service', 'transport', 'spa', 'experiences', 'guest_portal', 'restaurant.reservations']),
      routesTo: z.enum(['none', 'housekeeping_task', 'maintenance_ticket']).default('none'), defaultPriority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      slaMinutes: z.number().int().min(5).max(7 * 24 * 60).default(30), requiresStay: z.boolean().default(true), guestVisible: z.boolean().default(true),
      formSchema: z.array(formField).max(15).default([]), workflow: workflow.nullable().optional(), defaultAssigneeRole: z.string().max(40).nullable().optional(),
      active: z.boolean().default(true), sort: z.number().int().default(0),
    }),
    validate: async (_tx, _t, b) => { if (b.workflow) validateWorkflow(b.workflow as never); },
  });

  app.get('/admin/requests', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], querystring: pageQuery.extend({ status: z.string().optional(), category: z.string().optional(), assignee: z.string().optional(), view: z.enum(['open', 'mine', 'overdue', 'all']).default('open') }) },
  }, async (req) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const q = req.query;
    return withTenant(t.id, async (tx) => {
      const open = sql`${serviceRequests.resolvedAt} is null and ${serviceRequests.status} not in ('cancelled','closed','resolved')`;
      const where = and(
        eq(serviceRequests.tenantId, t.id),
        q.view === 'open' ? open : q.view === 'mine' ? and(open, eq(serviceRequests.assignedUserId, actor.userId)) : q.view === 'overdue' ? and(open, sql`${serviceRequests.dueAt} < now()`) : undefined,
        q.status ? inArray(serviceRequests.status, q.status.split(',')) : undefined,
        q.category ? inArray(serviceRequestTypes.category, q.category.split(',') as never[]) : undefined,
        q.assignee ? eq(serviceRequests.assignedUserId, q.assignee) : undefined,
        q.q ? or(ilike(serviceRequests.reference, `%${q.q}%`), ilike(serviceRequests.title, `%${q.q}%`), ilike(rooms.number, `%${q.q}%`)) : undefined,
      );
      const rows = await tx
        .select({ r: serviceRequests, category: serviceRequestTypes.category, typeName: serviceRequestTypes.name, roomNumber: rooms.number, assignee: users.name, workflow: serviceRequestTypes.workflow,
          guestName: sql<string | null>`(select g.first_name || ' ' || g.last_name from guests g where g.id = ${serviceRequests.guestId})` })
        .from(serviceRequests)
        .innerJoin(serviceRequestTypes, eq(serviceRequestTypes.id, serviceRequests.typeId))
        .leftJoin(rooms, eq(rooms.id, serviceRequests.roomId))
        .leftJoin(users, eq(users.id, serviceRequests.assignedUserId))
        .where(where)
        .orderBy(desc(sql`case ${serviceRequests.priority} when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end`), asc(serviceRequests.dueAt))
        .limit(q.pageSize).offset(offset(q));
      const [{ n }] = (await tx.select({ n: count() }).from(serviceRequests).innerJoin(serviceRequestTypes, eq(serviceRequestTypes.id, serviceRequests.typeId)).leftJoin(rooms, eq(rooms.id, serviceRequests.roomId)).where(where)) as [{ n: number }];
      return {
        data: rows.map((x) => ({ ...x.r, category: x.category, typeName: x.typeName, roomNumber: x.roomNumber, assignee: x.assignee, guestName: x.guestName, overdue: !x.r.resolvedAt && !!x.r.dueAt && x.r.dueAt < new Date(), statuses: workflowOf({ workflow: x.workflow }).statuses })),
        meta: pageMeta(q, n),
      };
    });
  });

  app.get('/admin/requests/:id', { preHandler: requireStaff('requests.manage'), schema: { tags: ['requests'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [r] = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, req.params.id), eq(serviceRequests.tenantId, t.id)));
      if (!r) throw notFound('Request');
      const [type] = await tx.select().from(serviceRequestTypes).where(eq(serviceRequestTypes.id, r.typeId));
      const events = await tx.select({ e: entityEvents, actorName: sql<string | null>`coalesce((select name from users u where u.id = ${entityEvents.actorId}), (select g.first_name from guests g where g.id = ${entityEvents.actorId}))` }).from(entityEvents).where(and(eq(entityEvents.entityType, 'service_request'), eq(entityEvents.entityId, r.id))).orderBy(asc(entityEvents.createdAt));
      const attachmentIds = events.filter((e) => e.e.kind === 'attachment' && e.e.body).map((e) => e.e.body!);
      const atts = attachmentIds.length ? await tx.select().from(files).where(inArray(files.id, attachmentIds)) : [];
      const [room] = r.roomId ? await tx.select().from(rooms).where(eq(rooms.id, r.roomId)) : [];
      const wf = workflowOf(type!);
      return { data: { request: r, type, room: room ?? null, workflow: wf, nextStatuses: wf.transitions[r.status] ?? [], events: events.map((e) => ({ ...e.e, actorName: e.actorName })), attachments: atts.map((f) => ({ id: f.id, name: f.originalName, mime: f.mime, url: `/api/v1/files/${f.id}` })) } };
    });
  });

  app.post('/admin/requests', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], body: z.object({ typeId: z.string().uuid(), roomId: z.string().uuid().nullable().optional(), description: z.string().max(2000).optional(), details: z.record(z.string(), z.unknown()).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const r = await withTenant(t.id, async (tx) => {
      const r = await createRequest(tx, t, { ...req.body, staffUserId: staffActor(req).userId });
      await audit(tx, req, { action: 'request.create', entityType: 'service_request', entityId: r.id });
      return r;
    });
    return reply.status(201).send({ data: r });
  });

  app.post('/admin/requests/:id/status', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], params: idParam, body: z.object({ status: z.string().min(2).max(30), guestNote: z.string().max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await transitionRequest(tx, t, req.params.id, req.body.status, { type: 'user', id: staffActor(req).userId }, req.body.guestNote) }));
  });

  app.post('/admin/requests/:id/assign', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], params: idParam, body: z.object({ userId: z.string().uuid().nullable() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await assignRequest(tx, t, req.params.id, req.body.userId, staffActor(req).userId) }));
  });

  app.patch('/admin/requests/:id', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], params: idParam, body: z.object({ priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), dueAt: z.coerce.date().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    if (!Object.keys(req.body).length) throw badRequest('Nothing to update');
    return withTenant(t.id, async (tx) => {
      const [before] = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.id, req.params.id), eq(serviceRequests.tenantId, t.id)));
      if (!before) throw notFound('Request');
      const [r] = await tx.update(serviceRequests).set(req.body).where(eq(serviceRequests.id, before.id)).returning();
      if (req.body.priority) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'service_request', entityId: r!.id, kind: 'priority', fromValue: before.priority, toValue: req.body.priority, actorType: 'user', actorId: staffActor(req).userId });
      return { data: r };
    });
  });

  app.post('/admin/requests/:id/notes', {
    preHandler: requireStaff('requests.manage'),
    schema: { tags: ['requests'], params: idParam, body: z.object({ body: z.string().min(1).max(2000), visibility: z.enum(['internal', 'guest']).default('internal') }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const e = await withTenant(t.id, (tx) => addRequestNote(tx, t, req.params.id, req.body.body, req.body.visibility, { type: 'user', id: staffActor(req).userId }));
    return reply.status(201).send({ data: e });
  });
};
