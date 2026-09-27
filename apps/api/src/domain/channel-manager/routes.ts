import { bookings, channelAriState, channelConnections, channelMappings, channelSyncLog, guests, ratePlans, roomTypes } from '@hp/db';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate } from '../../http/crud.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { encryptSecret } from '../../lib/crypto.js';
import { ADAPTERS, mockState } from './adapters.js';
import { connFor, syncConnection } from './service.js';

export const channelManagerRoutes: Routes = async (app, { config }) => {
  app.addHook('preHandler', requireModule('room_booking'));

  app.get('/admin/channel-manager', { preHandler: requireStaff('bookings.read'), schema: { tags: ['channels'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [c] = await tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1);
      const plans = await tx.select({ id: ratePlans.id, name: ratePlans.name, code: ratePlans.code, roomTypeId: ratePlans.roomTypeId, roomType: roomTypes.name })
        .from(ratePlans).innerJoin(roomTypes, eq(roomTypes.id, ratePlans.roomTypeId)).where(and(eq(ratePlans.tenantId, t.id), eq(ratePlans.active, true))).orderBy(roomTypes.sort, ratePlans.name);
      const issues = await tx.select({ id: bookings.id, reference: bookings.reference, channelIssue: bookings.channelIssue, channelName: bookings.channelName, checkIn: bookings.checkIn, checkOut: bookings.checkOut, guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}` })
        .from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId)).where(and(eq(bookings.tenantId, t.id), isNotNull(bookings.channelIssue), inArray(bookings.status, ['confirmed', 'checked_in'])));
      if (!c) return { data: { connection: null, mappings: [], plans, log: [], issues } };
      const { apiKeyEnc, ...rest } = c;
      const mappings = await tx.select().from(channelMappings).where(eq(channelMappings.connectionId, c.id));
      const log = await tx.select().from(channelSyncLog).where(eq(channelSyncLog.connectionId, c.id)).orderBy(desc(channelSyncLog.createdAt)).limit(30);
      return { data: { connection: { ...rest, apiKeySet: !!apiKeyEnc }, mappings, plans, log, issues } };
    });
  });

  app.put('/admin/channel-manager', {
    preHandler: requireStaff('property.manage'),
    schema: { tags: ['channels'], body: z.object({ provider: z.enum(['mock', 'channex']), environment: z.enum(['staging', 'production']).default('staging'), externalPropertyId: z.string().trim().min(1).max(100), apiKey: z.string().trim().min(8).max(300).optional(), horizonDays: z.number().int().min(30).max(730).default(365), status: z.enum(['active', 'paused']).default('active') }) },
  }, async (req) => {
    const t = tenantOf(req);
    if (req.body.provider === 'mock' && config.NODE_ENV === 'production') throw badRequest('The test channel manager is for development only');
    return withTenant(t.id, async (tx) => {
      const [existing] = await tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1);
      if (req.body.provider === 'channex' && !req.body.apiKey && !(existing?.provider === 'channex' && existing.apiKeyEnc)) throw badRequest('Paste your Channex API key');
      const values = { provider: req.body.provider, environment: req.body.environment, externalPropertyId: req.body.externalPropertyId, horizonDays: req.body.horizonDays, status: req.body.status, ...(req.body.apiKey ? { apiKeyEnc: encryptSecret(req.body.apiKey, config.SECRETS_MASTER_KEY) } : {}) };
      let c;
      if (existing && existing.provider === req.body.provider) [c] = await tx.update(channelConnections).set(values).where(eq(channelConnections.id, existing.id)).returning();
      else {
        if (existing) await tx.delete(channelConnections).where(eq(channelConnections.id, existing.id));
        [c] = await tx.insert(channelConnections).values({ ...values, tenantId: t.id }).returning();
      }
      await audit(tx, req, { action: 'channel_manager.connect', entityType: 'channel_connection', entityId: c!.id, changes: { provider: req.body.provider, environment: req.body.environment, externalPropertyId: req.body.externalPropertyId, apiKeyChanged: !!req.body.apiKey } });
      return { data: { id: c!.id } };
    });
  });

  app.delete('/admin/channel-manager', { preHandler: requireStaff('property.manage'), schema: { tags: ['channels'] } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [c] = await tx.delete(channelConnections).where(eq(channelConnections.tenantId, t.id)).returning();
      if (c) await audit(tx, req, { action: 'channel_manager.disconnect', entityType: 'channel_connection', entityId: c.id });
    });
    return reply.status(204).send();
  });

  app.put('/admin/channel-manager/mappings', {
    preHandler: requireStaff('property.manage'),
    schema: { tags: ['channels'], body: z.object({ mappings: z.array(z.object({ ratePlanId: z.string().uuid(), externalRoomTypeId: z.string().trim().min(1).max(100), externalRatePlanId: z.string().trim().min(1).max(100) })).max(200) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [c] = await tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1);
      if (!c) throw conflict('Connect a channel manager first');
      const ids = req.body.mappings.map((m) => m.ratePlanId);
      const plans = ids.length ? await tx.select({ id: ratePlans.id, roomTypeId: ratePlans.roomTypeId }).from(ratePlans).where(and(eq(ratePlans.tenantId, t.id), inArray(ratePlans.id, ids))) : [];
      if (plans.length !== new Set(ids).size) throw badRequest('Unknown rate plan');
      const ext = req.body.mappings.map((m) => m.externalRatePlanId);
      if (new Set(ext).size !== ext.length) throw badRequest('Each channel rate plan can be mapped once');
      // One channel room type per bookEZ room type.
      const byType = new Map<string, string>();
      for (const m of req.body.mappings) {
        const rt = plans.find((p) => p.id === m.ratePlanId)!.roomTypeId;
        if (byType.has(rt) && byType.get(rt) !== m.externalRoomTypeId) throw badRequest('Rate plans of one room type must map to the same channel room type');
        byType.set(rt, m.externalRoomTypeId);
      }
      await tx.delete(channelMappings).where(eq(channelMappings.connectionId, c.id));
      if (req.body.mappings.length) await tx.insert(channelMappings).values(req.body.mappings.map((m) => ({ ...m, tenantId: t.id, connectionId: c.id, roomTypeId: plans.find((p) => p.id === m.ratePlanId)!.roomTypeId })));
      await tx.delete(channelAriState).where(eq(channelAriState.connectionId, c.id)); // resend everything with the new mapping
      await audit(tx, req, { action: 'channel_manager.mappings', entityType: 'channel_connection', entityId: c.id, changes: { count: req.body.mappings.length } });
      return { data: { count: req.body.mappings.length } };
    });
  });

  app.post('/admin/channel-manager/test', { preHandler: requireStaff('property.manage'), schema: { tags: ['channels'] } }, async (req) => {
    const t = tenantOf(req);
    const [c] = await withTenant(t.id, (tx) => tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1));
    if (!c) throw notFound('Connection');
    try {
      const message = await ADAPTERS[c.provider].test(connFor(c));
      await withTenant(t.id, (tx) => tx.insert(channelSyncLog).values({ tenantId: t.id, connectionId: c.id, direction: 'test', ok: true, summary: message }));
      return { data: { ok: true, message } };
    } catch (e) {
      await withTenant(t.id, (tx) => tx.insert(channelSyncLog).values({ tenantId: t.id, connectionId: c.id, direction: 'test', ok: false, summary: (e as Error).message.slice(0, 300) }));
      throw badRequest(`Connection failed: ${(e as Error).message}`);
    }
  });

  app.post('/admin/channel-manager/sync', { preHandler: requireStaff('property.manage'), schema: { tags: ['channels'], body: z.object({ full: z.boolean().default(false) }).default({ full: false }) } }, async (req) => {
    const t = tenantOf(req);
    const [c] = await withTenant(t.id, (tx) => tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1));
    if (!c) throw notFound('Connection');
    if (req.body.full) await withTenant(t.id, (tx) => tx.delete(channelAriState).where(eq(channelAriState.connectionId, c.id)));
    try {
      return { data: await syncConnection(t, c.id) };
    } catch (e) {
      throw badRequest(`Sync failed: ${(e as Error).message}`);
    }
  });

  /** Test provider only: pretend an OTA sent a booking (to try the flow before connecting Channex). */
  app.post('/admin/channel-manager/simulate', {
    preHandler: requireStaff('property.manage'),
    schema: { tags: ['channels'], body: z.object({ externalRatePlanId: z.string().min(1), checkIn: isoDate, checkOut: isoDate, adults: z.number().int().min(1).max(8).default(2), status: z.enum(['new', 'modified', 'cancelled']).default('new'), externalId: z.string().max(60).optional(), channel: z.string().max(40).default('Booking.com'), guestName: z.string().max(80).default('Test Guest'), total: z.number().int().nullable().default(null) }) },
  }, async (req) => {
    const t = tenantOf(req);
    const [c] = await withTenant(t.id, (tx) => tx.select().from(channelConnections).where(eq(channelConnections.tenantId, t.id)).limit(1));
    if (!c || c.provider !== 'mock') throw conflict('Simulated bookings work with the test channel manager only');
    const [first, ...rest] = req.body.guestName.split(' ');
    const externalId = req.body.externalId ?? `SIM-${Date.now().toString(36).toUpperCase()}`;
    mockState(c.id).inbox.push({
      revisionId: `${externalId}-${Date.now()}`, externalId, status: req.body.status, channel: req.body.channel, externalRatePlanId: req.body.externalRatePlanId,
      checkIn: req.body.checkIn, checkOut: req.body.checkOut, adults: req.body.adults, children: 0,
      guest: { firstName: first || 'Test', lastName: rest.join(' ') || 'Guest', email: null, phone: null }, total: req.body.total, notes: null,
    });
    return { data: { externalId } };
  });

  app.post('/admin/bookings/:id/channel-issue/resolve', { preHandler: requireStaff('bookings.write'), schema: { tags: ['channels'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [b] = await tx.update(bookings).set({ channelIssue: null }).where(and(eq(bookings.id, req.params.id), eq(bookings.tenantId, t.id))).returning({ id: bookings.id });
      if (!b) throw notFound('Booking');
      await audit(tx, req, { action: 'booking.channel_issue_resolved', entityType: 'booking', entityId: b.id });
      return { ok: true };
    });
  });
};
