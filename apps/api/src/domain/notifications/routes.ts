import { notifications, notificationTemplates, pushSubscriptions } from '@hp/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { unauthorized } from '../../http/errors.js';
import { requireModule, requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { DEFAULT_TEMPLATES, render } from './templates.js';

export const notificationRoutes: Routes = async (app, { config }) => {
  app.get('/public/push/key', { schema: { tags: ['notifications'] } }, async () => ({ data: { publicKey: config.VAPID_PUBLIC_KEY ?? null } }));

  /** Register this device for web push (guest portal or staff app). */
  app.post('/push/subscribe', {
    schema: { tags: ['notifications'], body: z.object({ endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'https only'), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) },
  }, async (req, reply) => {
    const a = req.actor;
    if (a.type !== 'guest' && a.type !== 'staff') throw unauthorized();
    const t = tenantOf(req);
    const row = { tenantId: t.id, recipientType: a.type === 'guest' ? ('guest' as const) : ('user' as const), recipientId: a.type === 'guest' ? a.guestId : a.userId, endpoint: req.body.endpoint, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.headers['user-agent']?.slice(0, 200) };
    await withTenant(t.id, (tx) => tx.insert(pushSubscriptions).values(row).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row }));
    return reply.status(201).send({ ok: true });
  });

  app.post('/push/unsubscribe', { schema: { tags: ['notifications'], body: z.object({ endpoint: z.string().max(1000) }) } }, async (req) => {
    const t = tenantOf(req);
    await withTenant(t.id, (tx) => tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, t.id), eq(pushSubscriptions.endpoint, req.body.endpoint))));
    return { ok: true };
  });

  // ----- Staff in-app notifications -----
  app.get('/admin/notifications', { preHandler: requireStaff(), schema: { tags: ['notifications'] } }, async (req) => {
    const t = tenantOf(req);
    const a = staffActor(req);
    return withTenant(t.id, async (tx) => ({
      data: await tx.select({ id: notifications.id, subject: notifications.subject, body: notifications.body, relatedType: notifications.relatedType, relatedId: notifications.relatedId, readAt: notifications.readAt, createdAt: notifications.createdAt })
        .from(notifications).where(and(eq(notifications.tenantId, t.id), eq(notifications.recipientType, 'user'), eq(notifications.recipientId, a.userId), eq(notifications.channel, 'in_app'))).orderBy(desc(notifications.createdAt)).limit(50),
    }));
  });
  app.post('/admin/notifications/read', { preHandler: requireStaff(), schema: { tags: ['notifications'] } }, async (req) => {
    const t = tenantOf(req);
    const a = staffActor(req);
    await withTenant(t.id, (tx) => tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.recipientType, 'user'), eq(notifications.recipientId, a.userId), isNull(notifications.readAt))));
    return { ok: true };
  });

  // ----- Tenant-editable templates -----
  const guard = [requireStaff('tenant.settings'), requireModule('notifications')];
  app.get('/admin/notification-templates', { preHandler: guard, schema: { tags: ['notifications'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const overrides = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.tenantId, t.id));
      return {
        data: Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => ({
          key, default: def, variables: [...new Set([...(def.subject + def.body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))],
          overrides: overrides.filter((o) => o.key === key),
        })),
      };
    });
  });
  app.put('/admin/notification-templates/:key/:channel', {
    preHandler: guard,
    schema: { tags: ['notifications'], params: z.object({ key: z.string().max(60), channel: z.enum(['email', 'sms', 'whatsapp', 'push']) }), body: z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().min(1).max(5000), active: z.boolean().default(true) }) },
  }, async (req) => {
    const t = tenantOf(req);
    if (!DEFAULT_TEMPLATES[req.params.key]) return { error: 'unknown template' };
    return withTenant(t.id, async (tx) => {
      const row = { tenantId: t.id, key: req.params.key, channel: req.params.channel, subject: req.body.subject ?? null, body: req.body.body.replace(/<[^>]*>/g, ''), active: req.body.active };
      await tx.insert(notificationTemplates).values(row).onConflictDoUpdate({ target: [notificationTemplates.tenantId, notificationTemplates.key, notificationTemplates.channel], set: row });
      await audit(tx, req, { action: 'notification_template.update', entityType: 'notification_template', entityId: `${req.params.key}:${req.params.channel}` });
      return { data: { preview: render(row.body, { name: 'Asha', property: t.name, reference: 'BK-7K3Q9M' }) } };
    });
  });
  app.delete('/admin/notification-templates/:key/:channel', { preHandler: guard, schema: { tags: ['notifications'], params: z.object({ key: z.string(), channel: z.enum(['email', 'sms', 'whatsapp', 'push']) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, (tx) => tx.delete(notificationTemplates).where(and(eq(notificationTemplates.tenantId, t.id), eq(notificationTemplates.key, req.params.key), eq(notificationTemplates.channel, req.params.channel))));
    return reply.status(204).send();
  });
};
