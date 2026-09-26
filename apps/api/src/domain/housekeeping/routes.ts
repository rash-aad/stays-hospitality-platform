import { entityEvents, housekeepingTasks, lostAndFound, rooms, roomTypes, stays, bookings, users, maintenanceTickets } from '@hp/db';
import QRCode from 'qrcode';
import { forbidden } from '../../http/errors.js';
import { reference } from '../../lib/ids.js';
import { runtimeConfig } from '../../runtime.js';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { crud, isoDate } from '../../http/crud.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { todayIn } from '../../lib/dates.js';
import { outer } from '../../lib/sql.js';
import { resyncTotals } from '../bookings/inventory.js';
import { resolveLinkedRequest } from '../requests/service.js';
import type { TenantInfo } from '../../http/context.js';

type Task = typeof housekeepingTasks.$inferSelect;
const idParam = z.object({ id: z.string().uuid() });

/** Housekeeping task lifecycle; room status follows the work (dirty → clean → inspected). */
export async function transitionTask(tx: Tx, tenant: TenantInfo, id: string, to: Task['status'], actorId: string, notes?: string) {
  const [task] = await tx.select().from(housekeepingTasks).where(and(eq(housekeepingTasks.id, id), eq(housekeepingTasks.tenantId, tenant.id))).for('update');
  if (!task) throw notFound('Task');
  const allowed: Record<Task['status'], Task['status'][]> = {
    pending: ['in_progress', 'done', 'skipped'],
    in_progress: ['done', 'pending'],
    done: ['inspected', 'failed_inspection'],
    failed_inspection: ['in_progress', 'done'],
    inspected: [],
    skipped: ['pending'],
  };
  if (!allowed[task.status].includes(to)) throw conflict(`Cannot move a ${task.status.replace('_', ' ')} task to ${to.replace('_', ' ')}`);
  const now = new Date();
  const patch: Partial<Task> = { status: to };
  if (to === 'in_progress') patch.startedAt = task.startedAt ?? now;
  if (to === 'done') patch.completedAt = now;
  if (to === 'inspected' || to === 'failed_inspection') Object.assign(patch, { inspectedByUserId: actorId, inspectedAt: now, inspectionNotes: notes ?? null });
  const [u] = await tx.update(housekeepingTasks).set(patch).where(eq(housekeepingTasks.id, task.id)).returning();
  const cleaningKinds = ['departure', 'stayover', 'deep_clean', 'touch_up'];
  if (to === 'done' && cleaningKinds.includes(task.kind)) await tx.update(rooms).set({ housekeepingStatus: 'clean' }).where(and(eq(rooms.id, task.roomId), sql`${rooms.housekeepingStatus} <> 'out_of_service'`));
  if (to === 'inspected') await tx.update(rooms).set({ housekeepingStatus: 'inspected' }).where(and(eq(rooms.id, task.roomId), sql`${rooms.housekeepingStatus} <> 'out_of_service'`));
  if (to === 'failed_inspection') await tx.update(rooms).set({ housekeepingStatus: 'dirty' }).where(eq(rooms.id, task.roomId));
  await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'housekeeping_task', entityId: task.id, kind: 'status', fromValue: task.status, toValue: to, body: notes, actorType: 'user', actorId });
  if (to === 'done' && task.serviceRequestId) await resolveLinkedRequest(tx, tenant, task.serviceRequestId, actorId);
  return u!;
}

/** Create the day's stayover tasks for occupied rooms (idempotent per room/day). */
export async function generateDailyTasks(tx: Tx, tenantId: string, propertyId: string, date: string) {
  const occupied = await tx
    .select({ roomId: stays.roomId, checkOut: bookings.checkOut })
    .from(stays)
    .innerJoin(bookings, eq(bookings.id, stays.bookingId))
    .where(and(eq(stays.tenantId, tenantId), eq(stays.status, 'in_house'), sql`${stays.roomId} is not null`));
  let created = 0;
  for (const o of occupied) {
    if (o.checkOut === date) continue; // departure clean is created at check-out
    const [exists] = await tx.select({ id: housekeepingTasks.id }).from(housekeepingTasks).where(and(eq(housekeepingTasks.roomId, o.roomId!), eq(housekeepingTasks.scheduledFor, date), eq(housekeepingTasks.kind, 'stayover')));
    if (exists) continue;
    await tx.insert(housekeepingTasks).values({ tenantId, propertyId, roomId: o.roomId!, kind: 'stayover', scheduledFor: date });
    await tx.update(rooms).set({ housekeepingStatus: 'dirty' }).where(and(eq(rooms.id, o.roomId!), sql`${rooms.housekeepingStatus} <> 'out_of_service'`));
    created++;
  }
  return created;
}

export const housekeepingRoutes: Routes = async (app) => {
  app.addHook('preHandler', requireModule('housekeeping'));

  /** Room board: every room with its cleaning status, occupancy and today's tasks. */
  app.get('/admin/housekeeping/board', { preHandler: requireStaff('housekeeping.manage'), schema: { tags: ['housekeeping'], querystring: z.object({ date: isoDate.optional() }) } }, async (req) => {
    const t = tenantOf(req);
    const date = req.query.date ?? todayIn(t.timezone);
    return withTenant(t.id, async (tx) => {
      const rs = await tx
        .select({
          room: rooms, typeName: roomTypes.name,
          occupancy: sql<string | null>`(select case when b.check_out = ${date}::date then 'departure' else 'occupied' end from stays s join bookings b on b.id = s.booking_id where s.room_id = ${outer(rooms.id)} and s.status = 'in_house' limit 1)`,
          arrival: sql<boolean>`exists (select 1 from stays s join bookings b on b.id = s.booking_id where s.room_id = ${outer(rooms.id)} and s.status = 'upcoming' and b.check_in = ${date}::date and b.status = 'confirmed')`,
          openTickets: sql<number>`(select count(*)::int from maintenance_tickets m where m.room_id = ${outer(rooms.id)} and m.status not in ('resolved','closed'))`,
        })
        .from(rooms)
        .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
        .where(eq(rooms.tenantId, t.id))
        .orderBy(asc(rooms.floor), asc(rooms.number));
      const tasks = await tx
        .select({ task: housekeepingTasks, assignee: users.name })
        .from(housekeepingTasks)
        .leftJoin(users, eq(users.id, housekeepingTasks.assignedUserId))
        .where(and(eq(housekeepingTasks.tenantId, t.id), eq(housekeepingTasks.scheduledFor, date)))
        .orderBy(asc(housekeepingTasks.createdAt));
      const byStatus = rs.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.room.housekeepingStatus]: (acc[r.room.housekeepingStatus] ?? 0) + 1 }), {});
      return {
        data: {
          date,
          summary: { ...byStatus, tasksPending: tasks.filter((x) => x.task.status === 'pending').length, tasksInProgress: tasks.filter((x) => x.task.status === 'in_progress').length, awaitingInspection: tasks.filter((x) => x.task.status === 'done').length },
          rooms: rs.map((r) => ({ ...r.room, typeName: r.typeName, occupancy: r.occupancy ?? (r.arrival ? 'arrival' : 'vacant'), openTickets: r.openTickets, tasks: tasks.filter((x) => x.task.roomId === r.room.id).map((x) => ({ ...x.task, assignee: x.assignee })) })),
        },
      };
    });
  });

  app.put('/admin/housekeeping/rooms/:id/status', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], params: idParam, body: z.object({ status: z.enum(['clean', 'dirty', 'inspected', 'out_of_service']), note: z.string().max(300).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, req.params.id), eq(rooms.tenantId, t.id)));
      if (!room) throw notFound('Room');
      const oos = req.body.status === 'out_of_service';
      const [u] = await tx.update(rooms).set({ housekeepingStatus: req.body.status, status: oos ? 'out_of_service' : room.status === 'out_of_service' ? 'active' : room.status, notes: req.body.note ?? room.notes }).where(eq(rooms.id, room.id)).returning();
      if (oos || room.status === 'out_of_service') await resyncTotals(tx, room.roomTypeId);
      await audit(tx, req, { action: 'room.housekeeping_status', entityType: 'room', entityId: room.id, changes: { from: room.housekeepingStatus, to: req.body.status, note: req.body.note } });
      return { data: u };
    });
  });

  app.post('/admin/housekeeping/tasks', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], body: z.object({ roomId: z.string().uuid(), kind: z.enum(['departure', 'stayover', 'deep_clean', 'turndown', 'touch_up']), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), scheduledFor: isoDate.optional(), assignedUserId: z.string().uuid().nullable().optional(), notes: z.string().max(500).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const task = await withTenant(t.id, async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, req.body.roomId), eq(rooms.tenantId, t.id)));
      if (!room) throw badRequest('Unknown room');
      const [task] = await tx.insert(housekeepingTasks).values({ ...req.body, tenantId: t.id, propertyId: room.propertyId, scheduledFor: req.body.scheduledFor ?? todayIn(t.timezone) }).returning();
      if (['departure', 'stayover', 'deep_clean'].includes(req.body.kind)) await tx.update(rooms).set({ housekeepingStatus: 'dirty' }).where(and(eq(rooms.id, room.id), sql`${rooms.housekeepingStatus} <> 'out_of_service'`));
      return task;
    });
    return reply.status(201).send({ data: task });
  });

  app.post('/admin/housekeeping/generate', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], body: z.object({ date: isoDate.optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const { properties } = await import('@hp/db');
      const [p] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      return { data: { created: await generateDailyTasks(tx, t.id, p!.id, req.body.date ?? todayIn(t.timezone)) } };
    });
  });

  app.patch('/admin/housekeeping/tasks/:id', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], params: idParam, body: z.object({ assignedUserId: z.string().uuid().nullable().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), notes: z.string().max(500).nullable().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      if (req.body.assignedUserId) {
        const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, req.body.assignedUserId), eq(users.tenantId, t.id)));
        if (!u) throw badRequest('Unknown staff member');
      }
      const [task] = await tx.update(housekeepingTasks).set(req.body).where(and(eq(housekeepingTasks.id, req.params.id), eq(housekeepingTasks.tenantId, t.id))).returning();
      if (!task) throw notFound('Task');
      return { data: task };
    });
  });

  app.post('/admin/housekeeping/tasks/bulk-assign', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], body: z.object({ taskIds: z.array(z.string().uuid()).min(1).max(200), assignedUserId: z.string().uuid().nullable() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const r = await tx.update(housekeepingTasks).set({ assignedUserId: req.body.assignedUserId }).where(and(eq(housekeepingTasks.tenantId, t.id), inArray(housekeepingTasks.id, req.body.taskIds))).returning({ id: housekeepingTasks.id });
      return { data: { updated: r.length } };
    });
  });

  app.post('/admin/housekeeping/tasks/:id/status', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], params: idParam, body: z.object({ status: z.enum(['pending', 'in_progress', 'done', 'inspected', 'failed_inspection', 'skipped']), notes: z.string().max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await transitionTask(tx, t, req.params.id, req.body.status, staffActor(req).userId, req.body.notes) }));
  });

  // ---------------- Scan-to-clean (a QR code on each room door opens its page on a phone) ----------------
  const OPEN = ['pending', 'in_progress', 'done', 'failed_inspection'] as const;
  async function scanView(tx: Tx, tenant: TenantInfo, roomId: string) {
    const [room] = await tx.select({ r: rooms, type: roomTypes.name }).from(rooms).innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId)).where(and(eq(rooms.id, roomId), eq(rooms.tenantId, tenant.id)));
    if (!room) throw notFound('Room');
    const today = todayIn(tenant.timezone);
    const [stay] = await tx.select({ checkOut: bookings.checkOut }).from(stays).innerJoin(bookings, eq(bookings.id, stays.bookingId)).where(and(eq(stays.roomId, roomId), eq(stays.status, 'in_house')));
    const [task] = await tx.select({ t: housekeepingTasks, assignee: users.name }).from(housekeepingTasks).leftJoin(users, eq(users.id, housekeepingTasks.assignedUserId))
      .where(and(eq(housekeepingTasks.roomId, roomId), lte(housekeepingTasks.scheduledFor, today), inArray(housekeepingTasks.status, [...OPEN])))
      .orderBy(desc(housekeepingTasks.scheduledFor), sql`case ${housekeepingTasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`).limit(1);
    return {
      room: { id: room.r.id, number: room.r.number, floor: room.r.floor, type: room.type, housekeepingStatus: room.r.housekeepingStatus, status: room.r.status, notes: room.r.notes },
      occupancy: stay ? (stay.checkOut === today ? 'departing' : 'occupied') : 'vacant',
      task: task ? { ...task.t, assignee: task.assignee } : null,
    };
  }

  app.get('/admin/housekeeping/rooms/:id/scan', { preHandler: requireStaff('housekeeping.manage'), schema: { tags: ['housekeeping'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await scanView(tx, t, req.params.id) }));
  });

  app.post('/admin/housekeeping/rooms/:id/scan', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: { tags: ['housekeeping'], params: idParam, body: z.object({ action: z.enum(['start', 'done', 'inspected', 'failed']), notes: z.string().max(500).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const me = staffActor(req);
    return withTenant(t.id, async (tx) => {
      const view = await scanView(tx, t, req.params.id);
      let task = view.task;
      const { action } = req.body;
      if (!task) {
        if (action !== 'start') throw conflict('There’s no cleaning task for this room today — tap Start to begin one');
        const [created] = await tx.insert(housekeepingTasks).values({ tenantId: t.id, propertyId: (await tx.select({ p: rooms.propertyId }).from(rooms).where(eq(rooms.id, req.params.id)))[0]!.p, roomId: req.params.id, kind: 'touch_up', scheduledFor: todayIn(t.timezone), assignedUserId: me.userId }).returning();
        task = { ...created!, assignee: null };
      }
      if (action === 'start' && !task.assignedUserId) await tx.update(housekeepingTasks).set({ assignedUserId: me.userId }).where(eq(housekeepingTasks.id, task.id));
      const to = ({ start: 'in_progress', done: 'done', inspected: 'inspected', failed: 'failed_inspection' } as const)[action];
      if (task.status !== to) await transitionTask(tx, t, task.id, to, me.userId, req.body.notes);
      return { data: await scanView(tx, t, req.params.id) };
    });
  });

  /** Report a fault from the room: becomes a maintenance ticket (and can take the room out of service). */
  app.post('/admin/housekeeping/rooms/:id/issue', {
    preHandler: requireStaff('housekeeping.manage'),
    schema: {
      tags: ['housekeeping'], params: idParam,
      body: z.object({ title: z.string().trim().min(3).max(120), category: z.enum(['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'structural', 'it', 'other']), description: z.string().max(2000).optional(), blocksRoom: z.boolean().default(false), attachmentIds: z.array(z.string().uuid()).max(5).optional() }),
    },
  }, async (req, reply) => {
    const t = tenantOf(req);
    if (!t.modules.has('maintenance')) throw forbidden('Maintenance isn’t switched on for this property');
    const me = staffActor(req);
    const m = await withTenant(t.id, async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, req.params.id), eq(rooms.tenantId, t.id)));
      if (!room) throw notFound('Room');
      const { attachmentIds, ...b } = req.body;
      const [m] = await tx.insert(maintenanceTickets).values({ ...b, tenantId: t.id, propertyId: room.propertyId, roomId: room.id, locationLabel: `Room ${room.number}`, reference: reference('MT'), priority: b.blocksRoom ? 'high' : 'normal', severity: b.blocksRoom ? 'major' : 'minor', status: 'open', reportedByType: 'staff', reportedById: me.userId }).returning();
      for (const id of attachmentIds ?? []) await tx.insert(entityEvents).values({ tenantId: t.id, entityType: 'maintenance_ticket', entityId: m!.id, kind: 'attachment', body: id, actorType: 'user', actorId: me.userId });
      if (b.blocksRoom) {
        await tx.update(rooms).set({ status: 'out_of_service', housekeepingStatus: 'out_of_service' }).where(eq(rooms.id, room.id));
        await resyncTotals(tx, room.roomTypeId);
      }
      await audit(tx, req, { action: 'maintenance.create', entityType: 'maintenance_ticket', entityId: m!.id, changes: { via: 'room_scan' } });
      return m!;
    });
    return reply.status(201).send({ data: m });
  });

  /** Printable sheet: one QR per room that opens its scan page. */
  app.get('/admin/housekeeping/qr-codes', { preHandler: requireStaff('housekeeping.manage'), schema: { tags: ['housekeeping'] } }, async (req) => {
    const t = tenantOf(req);
    const list = await withTenant(t.id, (tx) => tx.select({ id: rooms.id, number: rooms.number, floor: rooms.floor, type: roomTypes.name }).from(rooms).innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId)).where(eq(rooms.tenantId, t.id)).orderBy(rooms.number));
    const base = runtimeConfig().WEB_PUBLIC_URL.replace(/\/$/, '');
    return { data: await Promise.all(list.map(async (r) => ({ ...r, url: `${base}/admin/hk/${r.id}`, qr: await QRCode.toString(`${base}/admin/hk/${r.id}`, { type: 'svg', margin: 1 }) }))) };
  });

  crud(app, {
    path: '/admin/lost-and-found', entity: 'lost_item', table: lostAndFound, permission: 'housekeeping.manage', tag: 'housekeeping', modules: ['housekeeping'], orderBy: lostAndFound.foundAt,
    body: z.object({
      propertyId: z.string().uuid(), roomId: z.string().uuid().nullable().optional(), description: z.string().min(2).max(300), locationFound: z.string().max(120).nullable().optional(),
      foundAt: z.coerce.date(), status: z.enum(['stored', 'returned', 'claimed', 'disposed']).default('stored'), guestId: z.string().uuid().nullable().optional(),
      storageLocation: z.string().max(120).nullable().optional(), notes: z.string().max(500).nullable().optional(), resolvedAt: z.coerce.date().nullable().optional(),
    }),
  });
};

