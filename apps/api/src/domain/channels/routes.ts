import { randomBytes } from 'node:crypto';
import { externalBlocks, icalFeeds, roomTypes } from '@hp/db';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem, withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { todayIn } from '../../lib/dates.js';
import { runtimeConfig } from '../../runtime.js';
import { applyEvents, buildExport, parseIcal, releaseFeed, safeFetchText } from './ical.js';

const idParam = z.object({ id: z.string().uuid() });
const exportUrl = (token: string) => `${runtimeConfig().WEB_PUBLIC_URL}/api/v1/public/ical/${token}.ics`;

/** Pull one import feed and reconcile it; errors are stored on the feed rather than thrown. */
export async function syncFeed(tenantId: string, timezone: string, feedId: string, fetchText: (url: string) => Promise<string> = safeFetchText) {
  const [feed] = await withTenant(tenantId, (tx) => tx.select().from(icalFeeds).where(and(eq(icalFeeds.id, feedId), eq(icalFeeds.direction, 'import'))));
  if (!feed?.url) throw notFound('Feed');
  try {
    const events = parseIcal(await fetchText(feed.url));
    return await withTenant(tenantId, async (tx) => {
      await tx.select({ id: icalFeeds.id }).from(icalFeeds).where(eq(icalFeeds.id, feed.id)).for('update'); // one sync per feed at a time
      const r = await applyEvents(tx, feed, events, todayIn(timezone));
      await tx.update(icalFeeds).set({ lastSyncAt: new Date(), lastError: null }).where(eq(icalFeeds.id, feed.id));
      return r;
    });
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await withTenant(tenantId, (tx) => tx.update(icalFeeds).set({ lastSyncAt: new Date(), lastError: message }).where(eq(icalFeeds.id, feed.id)));
    throw badRequest(`Sync failed: ${message}`);
  }
}

/** Worker entry: sync every import feed of every active tenant with room booking enabled. */
export async function syncAllFeeds() {
  const feeds = await asSystem((tx) => tx.execute<{ id: string; tenant_id: string; timezone: string }>(sql`
    select f.id, f.tenant_id, t.timezone from ical_feeds f join tenants t on t.id = f.tenant_id
    join tenant_modules m on m.tenant_id = t.id and m.module_key = 'room_booking' and m.enabled
    where f.direction = 'import' and t.status = 'active'`));
  let ok = 0, failed = 0;
  for (const f of feeds) {
    try { await syncFeed(f.tenant_id, f.timezone, f.id); ok++; } catch { failed++; }
  }
  return { ok, failed };
}

export const channelAdminRoutes: Routes = async (admin) => {
  admin.addHook('preHandler', requireModule('room_booking'));

  admin.get('/admin/ical-feeds', { preHandler: requireStaff('bookings.read'), schema: { tags: ['channels'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const rows = await tx.select({
        f: icalFeeds, roomType: roomTypes.name,
        held: sql<number>`(select count(*)::int from external_blocks b where b.feed_id = ${icalFeeds.id} and b.status = 'held')`,
        conflicts: sql<number>`(select count(*)::int from external_blocks b where b.feed_id = ${icalFeeds.id} and b.status = 'conflict')`,
      }).from(icalFeeds).innerJoin(roomTypes, eq(roomTypes.id, icalFeeds.roomTypeId)).orderBy(desc(icalFeeds.createdAt));
      return { data: rows.map(({ f, ...r }) => { const { token, ...feed } = f; return { ...feed, ...r, exportUrl: token ? exportUrl(token) : null }; }) };
    });
  });

  admin.post('/admin/ical-feeds', {
    preHandler: requireStaff('property.manage'),
    schema: { tags: ['channels'], body: z.object({ roomTypeId: z.string().uuid(), direction: z.enum(['export', 'import']), name: z.string().trim().min(1).max(80), url: z.string().url().max(1000).nullish() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const { direction, url } = req.body;
    if (direction === 'import' && !url?.startsWith('https://')) throw badRequest('Paste the channel’s https calendar link');
    const feed = await withTenant(t.id, async (tx) => {
      const [rt] = await tx.select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.id, req.body.roomTypeId), eq(roomTypes.tenantId, t.id)));
      if (!rt) throw badRequest('Unknown room type');
      const [n] = await tx.select({ n: count() }).from(icalFeeds);
      if ((n?.n ?? 0) >= 50) throw badRequest('Feed limit reached');
      const [f] = await tx.insert(icalFeeds).values({
        tenantId: t.id, roomTypeId: rt.id, direction, name: req.body.name,
        url: direction === 'import' ? url! : null, token: direction === 'export' ? randomBytes(24).toString('base64url') : null,
      }).returning();
      await audit(tx, req, { action: 'ical_feed.create', entityType: 'ical_feed', entityId: f!.id, changes: { direction, name: req.body.name } });
      return f!;
    });
    const { token, ...rest } = feed;
    return reply.status(201).send({ data: { ...rest, exportUrl: token ? exportUrl(token) : null } });
  });

  admin.delete('/admin/ical-feeds/:id', { preHandler: requireStaff('property.manage'), schema: { tags: ['channels'], params: idParam } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [f] = await tx.select().from(icalFeeds).where(and(eq(icalFeeds.id, req.params.id), eq(icalFeeds.tenantId, t.id))).for('update');
      if (!f) throw notFound('Feed');
      await releaseFeed(tx, f.id);
      await tx.delete(icalFeeds).where(eq(icalFeeds.id, f.id));
      await audit(tx, req, { action: 'ical_feed.delete', entityType: 'ical_feed', entityId: f.id });
    });
    return reply.status(204).send();
  });

  admin.post('/admin/ical-feeds/:id/sync', { preHandler: requireStaff('property.manage'), schema: { tags: ['channels'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return { data: await syncFeed(t.id, t.timezone, req.params.id) };
  });

  admin.get('/admin/ical-feeds/:id/blocks', { preHandler: requireStaff('bookings.read'), schema: { tags: ['channels'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({
      data: await tx.select().from(externalBlocks).where(and(eq(externalBlocks.feedId, req.params.id), eq(externalBlocks.tenantId, t.id))).orderBy(externalBlocks.startDate),
    }));
  });
};

export const channelRoutes: Routes = async (app) => {
  // Public export for OTAs — the unguessable token is the credential.
  app.get('/public/ical/:file', { schema: { tags: ['channels'], params: z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{20,64}\.ics$/) }) } }, async (req, reply) => {
    const token = req.params.file.slice(0, -4);
    const [f] = await asSystem((tx) => tx.execute<{ tenant_id: string; room_type_id: string; name: string; timezone: string }>(sql`
      select f.tenant_id, f.room_type_id, f.name, t.timezone from ical_feeds f join tenants t on t.id = f.tenant_id
      where f.token = ${token} and f.direction = 'export' and t.status = 'active'`));
    if (!f) throw notFound('Calendar');
    const body = await withTenant(f.tenant_id, (tx) => buildExport(tx, f.room_type_id, f.name, todayIn(f.timezone)));
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('cache-control', 'private, max-age=300').send(body);
  });
};
