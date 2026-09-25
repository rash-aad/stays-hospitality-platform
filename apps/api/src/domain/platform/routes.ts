import { isModuleKey, MODULE_KEYS, type ModuleKey } from '@hp/contracts';
import { auditLogs, bookings, domains, tenants, users } from '@hp/db';
import { count, desc, eq, sql } from 'drizzle-orm';
import { outer } from '../../lib/sql.js';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requirePlatform } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { asSystem } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { createOneTimeToken } from '../auth/service.js';
import { notify } from '../notifications/notify.js';
import { listModules, setModule } from '../tenants/modules.js';
import { provisionTenant } from '../tenants/provision.js';
import { invalidateTenant } from '../tenants/tenant-cache.js';
import { purgeSite } from '../../lib/purge.js';

const slugRe = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Super Admin control plane. Every route requires a platform token; tenant ids come from the path. */
export const platformRoutes: Routes = async (app, { config }) => {
  app.addHook('preHandler', requirePlatform);

  app.get('/platform/tenants', { schema: { tags: ['platform'] } }, async () => {
    return asSystem(async (tx) => {
      const rows = await tx
        .select({
          id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, currency: tenants.currency, createdAt: tenants.createdAt,
          staff: sql<number>`(select count(*)::int from users u where u.tenant_id = ${outer(tenants.id)})`,
          bookings: sql<number>`(select count(*)::int from bookings b where b.tenant_id = ${outer(tenants.id)})`,
          modules: sql<string[]>`(select coalesce(array_agg(module_key order by module_key), '{}') from tenant_modules m where m.tenant_id = ${outer(tenants.id)} and m.enabled)`,
          domain: sql<string | null>`(select hostname from domains d where d.tenant_id = ${outer(tenants.id)} and d.is_primary limit 1)`,
        })
        .from(tenants)
        .orderBy(tenants.name);
      return { data: rows };
    });
  });

  app.post('/platform/tenants', {
    schema: {
      tags: ['platform'],
      body: z.object({
        name: z.string().min(2).max(120),
        slug: z.string().regex(slugRe, 'lowercase letters, digits and dashes'),
        currency: z.string().length(3).default('INR'),
        timezone: z.string().default('Asia/Kolkata'),
        ownerName: z.string().min(2),
        ownerEmail: z.string().email(),
        modules: z.array(z.string()).optional(),
        templateKey: z.string().optional(),
      }),
    },
  }, async (req, reply) => {
    const mods = req.body.modules?.filter(isModuleKey) as ModuleKey[] | undefined;
    const result = await asSystem(async (tx) => {
      const r = await provisionTenant(tx, {
        name: req.body.name, slug: req.body.slug, currency: req.body.currency, timezone: req.body.timezone, contactEmail: req.body.ownerEmail,
        modules: mods, templateKey: req.body.templateKey, rootDomain: config.PLATFORM_ROOT_DOMAIN,
        owner: { name: req.body.ownerName, email: req.body.ownerEmail },
      });
      const { properties, pages } = await import('@hp/db');
      await tx.insert(properties).values({ tenantId: r.tenant.id, name: req.body.name, slug: 'main', timezone: req.body.timezone });
      // A usable branded site from day one: starter pages from the chosen template, published.
      const { applyTemplate, publishPage } = await import('../content/site-service.js');
      await applyTemplate(tx, r.tenant.id, req.body.templateKey ?? 'luxury', r.ownerId!, { replaceContent: true });
      for (const p of await tx.select({ id: pages.id }).from(pages).where(eq(pages.tenantId, r.tenant.id))) await publishPage(tx, r.tenant.id, p.id, r.ownerId!, 'Launch');
      const token = await createOneTimeToken(tx, { kind: 'staff_invite', tenantId: r.tenant.id, userId: r.ownerId!, ttlMinutes: 7 * 24 * 60 });
      await notify(tx, {
        tenantId: r.tenant.id, recipient: { type: 'user', id: r.ownerId! }, templateKey: 'auth.staff_invite', channels: ['email'],
        vars: { name: req.body.ownerName, inviter: 'The platform team', property: req.body.name, link: `${config.WEB_PUBLIC_URL}/admin/accept-invite?token=${token}` },
      });
      await audit(tx, req, { action: 'platform.tenant.create', entityType: 'tenant', entityId: r.tenant.id, tenantId: r.tenant.id, changes: { slug: req.body.slug } });
      return r.tenant;
    });
    return reply.status(201).send({ data: result });
  });

  app.get('/platform/tenants/:id', { schema: { tags: ['platform'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    return asSystem(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!t) throw notFound('Tenant');
      const [staff] = await tx.select({ n: count() }).from(users).where(eq(users.tenantId, t.id));
      const [bk] = await tx.select({ n: count() }).from(bookings).where(eq(bookings.tenantId, t.id));
      const doms = await tx.select().from(domains).where(eq(domains.tenantId, t.id));
      const recent = await tx.select().from(auditLogs).where(eq(auditLogs.tenantId, t.id)).orderBy(desc(auditLogs.createdAt)).limit(20);
      return { data: { ...t, staffCount: staff!.n, bookingCount: bk!.n, domains: doms, modules: await listModules(tx, t.id), recentActivity: recent } };
    });
  });

  app.patch('/platform/tenants/:id', {
    schema: { tags: ['platform'], params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['active', 'suspended']).optional(), name: z.string().min(2).optional() }) },
  }, async (req) => {
    const t = await asSystem(async (tx) => {
      const [t] = await tx.update(tenants).set(req.body).where(eq(tenants.id, req.params.id)).returning();
      if (!t) throw notFound('Tenant');
      await audit(tx, req, { action: 'platform.tenant.update', entityType: 'tenant', entityId: t.id, tenantId: t.id, changes: req.body });
      return t;
    });
    await invalidateTenant(t.id);
    purgeSite(t.id); // suspended sites stop rendering immediately
    return { data: t };
  });

  app.put('/platform/tenants/:id/modules/:key', {
    schema: { tags: ['platform'], params: z.object({ id: z.string().uuid(), key: z.string() }), body: z.object({ enabled: z.boolean() }) },
  }, async (req) => {
    if (!isModuleKey(req.params.key)) throw badRequest('Unknown module');
    const key = req.params.key;
    const out = await asSystem(async (tx) => {
      const changed = await setModule(tx, req.params.id, key, req.body.enabled);
      await audit(tx, req, { action: req.body.enabled ? 'module.enable' : 'module.disable', entityType: 'module', entityId: key, tenantId: req.params.id, changes: { changed } });
      return { data: await listModules(tx, req.params.id) };
    });
    purgeSite(req.params.id);
    return out;
  });

  app.get('/platform/modules', { schema: { tags: ['platform'] } }, async () => ({ data: MODULE_KEYS }));
};
