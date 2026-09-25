import { bookings, experienceBookings, guestMessages, guests, orders, restaurantReservations, serviceRequests, users } from '@hp/db';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { outer } from '../../lib/sql.js';
import { z } from 'zod';
import { notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { notify } from '../notifications/notify.js';

export const guestAdminRoutes: Routes = async (app) => {
  app.get('/admin/guests', { preHandler: requireStaff('guests.read'), schema: { tags: ['guests'], querystring: pageQuery.extend({ tag: z.string().optional() }) } }, async (req) => {
    const t = tenantOf(req);
    const q = req.query;
    return withTenant(t.id, async (tx) => {
      const where = and(
        eq(guests.tenantId, t.id),
        q.q ? or(ilike(guests.email, `%${q.q}%`), ilike(sql`${guests.firstName} || ' ' || ${guests.lastName}`, `%${q.q}%`), ilike(guests.phone, `%${q.q}%`)) : undefined,
        q.tag ? sql`${q.tag} = any(${guests.tags})` : undefined,
      );
      const rows = await tx
        .select({
          g: guests,
          stays: sql<number>`(select count(*)::int from bookings b where b.guest_id = ${outer(guests.id)} and b.status in ('confirmed','checked_in','checked_out'))`,
          revenue: sql<number>`(select coalesce(sum(b.total),0)::int from bookings b where b.guest_id = ${outer(guests.id)} and b.status in ('confirmed','checked_in','checked_out'))`,
          lastStay: sql<string | null>`(select max(b.check_in)::text from bookings b where b.guest_id = ${outer(guests.id)} and b.status in ('confirmed','checked_in','checked_out'))`,
        })
        .from(guests).where(where).orderBy(desc(guests.createdAt)).limit(q.pageSize).offset(offset(q));
      const [{ n }] = (await tx.select({ n: count() }).from(guests).where(where)) as [{ n: number }];
      return { data: rows.map(({ g, ...agg }) => ({ id: g.id, email: g.email, phone: g.phone, firstName: g.firstName, lastName: g.lastName, country: g.country, tags: g.tags, hasAccount: !!g.passwordHash, createdAt: g.createdAt, ...agg })), meta: pageMeta(q, n) };
    });
  });

  app.get('/admin/guests/:id', { preHandler: requireStaff('guests.read'), schema: { tags: ['guests'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [g] = await tx.select().from(guests).where(and(eq(guests.id, req.params.id), eq(guests.tenantId, t.id)));
      if (!g) throw notFound('Guest');
      const { passwordHash: _pw, ...guest } = g;
      return {
        data: {
          guest: { ...guest, hasAccount: !!_pw },
          bookings: await tx.select().from(bookings).where(eq(bookings.guestId, g.id)).orderBy(desc(bookings.checkIn)),
          reservations: await tx.select().from(restaurantReservations).where(eq(restaurantReservations.guestId, g.id)).orderBy(desc(restaurantReservations.startsAt)).limit(20),
          orders: await tx.select().from(orders).where(eq(orders.guestId, g.id)).orderBy(desc(orders.createdAt)).limit(20),
          requests: await tx.select().from(serviceRequests).where(eq(serviceRequests.guestId, g.id)).orderBy(desc(serviceRequests.createdAt)).limit(20),
          experiences: await tx.select().from(experienceBookings).where(eq(experienceBookings.guestId, g.id)).orderBy(desc(experienceBookings.createdAt)).limit(20),
        },
      };
    });
  });

  app.patch('/admin/guests/:id', {
    preHandler: requireStaff('guests.write'),
    schema: { tags: ['guests'], params: z.object({ id: z.string().uuid() }), body: z.object({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), phone: z.string().max(30).nullable(), country: z.string().length(2).nullable(), notes: z.string().max(4000).nullable(), tags: z.array(z.string().max(30)).max(20), marketingOptIn: z.boolean() }).partial() },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [g] = await tx.update(guests).set(req.body).where(and(eq(guests.id, req.params.id), eq(guests.tenantId, t.id))).returning();
      if (!g) throw notFound('Guest');
      await audit(tx, req, { action: 'guest.update', entityType: 'guest', entityId: g.id, changes: req.body });
      return { data: { id: g.id } };
    });
  });

  // ----- Guest messaging inbox -----
  app.get('/admin/messages', { preHandler: requireStaff('messages.manage'), schema: { tags: ['guests'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const threads = await tx.execute(sql`
        select distinct on (m.guest_id) m.guest_id as "guestId", m.body, m.sender_type as "senderType", m.created_at as "createdAt",
          g.first_name || ' ' || g.last_name as "guestName",
          (select count(*)::int from guest_messages u where u.guest_id = m.guest_id and u.sender_type = 'guest' and u.read_at is null) as unread,
          (select r.number from stays s join rooms r on r.id = s.room_id where s.guest_id = m.guest_id and s.status = 'in_house' limit 1) as "roomNumber"
        from guest_messages m join guests g on g.id = m.guest_id
        where m.tenant_id = ${t.id}
        order by m.guest_id, m.created_at desc`);
      const list = [...(threads as unknown as { createdAt: string }[])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { data: list };
    });
  });

  app.get('/admin/messages/:guestId', { preHandler: requireStaff('messages.manage'), schema: { tags: ['guests'], params: z.object({ guestId: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await tx.update(guestMessages).set({ readAt: new Date() }).where(and(eq(guestMessages.guestId, req.params.guestId), eq(guestMessages.senderType, 'guest'), sql`${guestMessages.readAt} is null`));
      const rows = await tx.select({ m: guestMessages, staffName: users.name }).from(guestMessages).leftJoin(users, eq(users.id, guestMessages.senderUserId)).where(and(eq(guestMessages.tenantId, t.id), eq(guestMessages.guestId, req.params.guestId))).orderBy(guestMessages.createdAt);
      return { data: rows.map((r) => ({ ...r.m, staffName: r.staffName })) };
    });
  });

  app.post('/admin/messages/:guestId', { preHandler: requireStaff('messages.manage'), schema: { tags: ['guests'], params: z.object({ guestId: z.string().uuid() }), body: z.object({ body: z.string().min(1).max(2000) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const m = await withTenant(t.id, async (tx) => {
      const [g] = await tx.select().from(guests).where(and(eq(guests.id, req.params.guestId), eq(guests.tenantId, t.id)));
      if (!g) throw notFound('Guest');
      const [m] = await tx.insert(guestMessages).values({ tenantId: t.id, guestId: g.id, senderType: 'staff', senderUserId: actor.userId, body: req.body.body }).returning();
      await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: g.id }, templateKey: 'message.new', channels: ['in_app', 'push'], vars: { property: t.name, body: req.body.body } });
      return m;
    });
    return reply.status(201).send({ data: m });
  });
};
