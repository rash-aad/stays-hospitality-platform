import { entityEvents, files, maintenanceTickets, properties, rooms, users } from '@hp/db';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { reference } from '../../lib/ids.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { resyncTotals } from '../bookings/inventory.js';
import { resolveLinkedRequest } from '../requests/service.js';

type Ticket = typeof maintenanceTickets.$inferSelect;
const idParam = z.object({ id: z.string().uuid() });
const FLOW: Record<Ticket['status'], Ticket['status'][]> = {
  open: ['assigned', 'in_progress', 'on_hold', 'resolved', 'closed'],
  assigned: ['in_progress', 'on_hold', 'resolved', 'open'],
  in_progress: ['on_hold', 'resolved'],
  on_hold: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export const maintenanceRoutes: Routes = async (app) => {
  app.addHook('preHandler', requireModule('maintenance'));

  app.get('/admin/maintenance', {
    preHandler: requireStaff('maintenance.manage'),
    schema: { tags: ['maintenance'], querystring: pageQuery.extend({ status: z.string().optional(), category: z.string().optional(), open: z.coerce.boolean().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const q = req.query;
    return withTenant(t.id, async (tx) => {
      const where = and(
        eq(maintenanceTickets.tenantId, t.id),
        q.status ? inArray(maintenanceTickets.status, q.status.split(',') as Ticket['status'][]) : q.open !== false ? sql`${maintenanceTickets.status} not in ('closed')` : undefined,
        q.category ? eq(maintenanceTickets.category, q.category as Ticket['category']) : undefined,
        q.q ? or(ilike(maintenanceTickets.title, `%${q.q}%`), ilike(maintenanceTickets.reference, `%${q.q}%`), ilike(maintenanceTickets.locationLabel, `%${q.q}%`)) : undefined,
      );
      const rows = await tx.select({ m: maintenanceTickets, assignee: users.name }).from(maintenanceTickets).leftJoin(users, eq(users.id, maintenanceTickets.assignedUserId)).where(where)
        .orderBy(desc(sql`case ${maintenanceTickets.severity} when 'critical' then 2 when 'major' then 1 else 0 end`), desc(sql`case ${maintenanceTickets.priority} when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end`), asc(maintenanceTickets.createdAt))
        .limit(q.pageSize).offset(offset(q));
      const [{ n }] = (await tx.select({ n: count() }).from(maintenanceTickets).where(where)) as [{ n: number }];
      return { data: rows.map((r) => ({ ...r.m, assignee: r.assignee })), meta: pageMeta(q, n) };
    });
  });

  app.get('/admin/maintenance/:id', { preHandler: requireStaff('maintenance.manage'), schema: { tags: ['maintenance'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [m] = await tx.select().from(maintenanceTickets).where(and(eq(maintenanceTickets.id, req.params.id), eq(maintenanceTickets.tenantId, t.id)));
      if (!m) throw notFound('Ticket');
      const events = await tx.select().from(entityEvents).where(and(eq(entityEvents.entityType, 'maintenance_ticket'), eq(entityEvents.entityId, m.id))).orderBy(asc(entityEvents.createdAt));
      // Photos can be attached to the ticket or to the guest request that created it.
      const reqEvents = m.serviceRequestId ? await tx.select().from(entityEvents).where(and(eq(entityEvents.entityType, 'service_request'), eq(entityEvents.entityId, m.serviceRequestId), eq(entityEvents.kind, 'attachment'))) : [];
      const ids = [...events, ...reqEvents].filter((e) => e.kind === 'attachment' && e.body).map((e) => e.body!);
      const atts = ids.length ? await tx.select().from(files).where(inArray(files.id, ids)) : [];
      return { data: { ticket: m, events, attachments: atts.map((f) => ({ id: f.id, name: f.originalName, mime: f.mime, url: `/api/v1/files/${f.id}` })) } };
    });
  });

  app.post('/admin/maintenance', {
    preHandler: requireStaff('maintenance.manage'),
    schema: {
      tags: ['maintenance'],
      body: z.object({
        roomId: z.string().uuid().nullable().optional(), locationLabel: z.string().max(120).optional(), title: z.string().min(3).max(120), description: z.string().max(2000).optional(),
        category: z.enum(['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'structural', 'it', 'other']), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        severity: z.enum(['minor', 'major', 'critical']).default('minor'), assignedUserId: z.string().uuid().nullable().optional(), blocksRoom: z.boolean().default(false), attachmentIds: z.array(z.string().uuid()).max(5).optional(),
      }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const m = await withTenant(t.id, async (tx) => {
      const { attachmentIds, ...b } = req.body;
      const [room] = b.roomId ? await tx.select().from(rooms).where(and(eq(rooms.id, b.roomId), eq(rooms.tenantId, t.id))) : [];
      if (b.roomId && !room) throw badRequest('Unknown room');
      const [p] = room ? [{ id: room.propertyId }] : await tx.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      const location = room ? `Room ${room.number}` : b.locationLabel;
      if (!location) throw badRequest('Say where the problem is');
      const [m] = await tx.insert(maintenanceTickets).values({ ...b, tenantId: t.id, propertyId: p!.id, locationLabel: location, reference: reference('MT'), status: b.assignedUserId ? 'assigned' : 'open', reportedByType: 'staff', reportedById: actor.userId }).returning();
      for (const id of attachmentIds ?? []) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'maintenance_ticket', entityId: m!.id, kind: 'attachment', body: id, actorType: 'user', actorId: actor.userId });
      if (b.blocksRoom && room) {
        await tx.update(rooms).set({ status: 'out_of_service', housekeepingStatus: 'out_of_service' }).where(eq(rooms.id, room.id));
        await resyncTotals(tx, room.roomTypeId);
      }
      await audit(tx, req, { action: 'maintenance.create', entityType: 'maintenance_ticket', entityId: m!.id });
      return m!;
    });
    return reply.status(201).send({ data: m });
  });

  app.patch('/admin/maintenance/:id', {
    preHandler: requireStaff('maintenance.manage'),
    schema: {
      tags: ['maintenance'], params: idParam,
      body: z.object({
        status: z.enum(['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed']).optional(), assignedUserId: z.string().uuid().nullable().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), severity: z.enum(['minor', 'major', 'critical']).optional(), resolution: z.string().max(2000).optional(), note: z.string().max(2000).optional(),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const [m] = await tx.select().from(maintenanceTickets).where(and(eq(maintenanceTickets.id, req.params.id), eq(maintenanceTickets.tenantId, t.id))).for('update');
      if (!m) throw notFound('Ticket');
      const { note, ...patch } = req.body;
      if (patch.status && patch.status !== m.status) {
        if (!FLOW[m.status].includes(patch.status)) throw conflict(`Cannot move a ${m.status.replace('_', ' ')} ticket to ${patch.status.replace('_', ' ')}`);
        if (patch.status === 'resolved' && !(patch.resolution ?? m.resolution)) throw badRequest('Describe how the issue was resolved');
      }
      if (patch.assignedUserId) {
        const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, patch.assignedUserId), eq(users.tenantId, t.id)));
        if (!u) throw badRequest('Unknown staff member');
      }
      const status = patch.status ?? (patch.assignedUserId && m.status === 'open' ? 'assigned' : m.status);
      const [u] = await tx.update(maintenanceTickets).set({ ...patch, status, resolvedAt: status === 'resolved' ? new Date() : m.resolvedAt }).where(eq(maintenanceTickets.id, m.id)).returning();
      if (status !== m.status) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'maintenance_ticket', entityId: m.id, kind: 'status', fromValue: m.status, toValue: status, actorType: 'user', actorId: actor.userId });
      if (patch.assignedUserId !== undefined) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'maintenance_ticket', entityId: m.id, kind: 'assignment', toValue: patch.assignedUserId, actorType: 'user', actorId: actor.userId });
      if (note) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'maintenance_ticket', entityId: m.id, kind: 'note', body: note, actorType: 'user', actorId: actor.userId });
      if (status === 'resolved' && m.status !== 'resolved') {
        await resolveLinkedRequest(tx, t, m.serviceRequestId, actor.userId);
        if (m.blocksRoom && m.roomId) {
          const [room] = await tx.update(rooms).set({ status: 'active', housekeepingStatus: 'dirty' }).where(eq(rooms.id, m.roomId)).returning();
          await resyncTotals(tx, room!.roomTypeId);
        }
      }
      await audit(tx, req, { action: 'maintenance.update', entityType: 'maintenance_ticket', entityId: m.id, changes: req.body });
      return { data: u };
    });
  });
};
