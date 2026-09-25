import { SECTION_LABELS, SECTION_MODULES, SITE_TEMPLATES, themeTokensSchema } from '@hp/contracts';
import { domains, guestMessages, guests, pages, pageVersions, promotions, properties, roomTypes, siteSettings, tenants, themes } from '@hp/db';
import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, resolvePublicTenant, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { purgeSite } from '../../lib/purge.js';
import { afterCommit } from '../../infra/db.js';
import { addDomain, makePrimary, removeDomain, TXT_PREFIX, verifyDomain } from './domains.js';
import { applyTemplate, publishedPage, publishPage, rollback, saveDraft, stripTags, validateDoc, versionsOf } from './site-service.js';

const idParam = z.object({ id: z.string().uuid() });
const navLink = z.object({ label: z.string().min(1).max(40), href: z.string().max(300).refine((h) => /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/.test(h), 'Invalid link') });

export const siteRoutes: Routes = async (app, { config }) => {
  const edit = [requireStaff('content.manage'), requireModule('website_builder')];
  const pub = [requireStaff('content.publish'), requireModule('website_builder')];

  app.get('/admin/site/templates', { preHandler: edit, schema: { tags: ['website'] } }, async () => ({
    data: SITE_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, suitedFor: t.suitedFor, previewImage: t.previewImage, tokens: t.tokens, pages: t.pages.map((p) => ({ slug: p.slug, title: p.title, doc: p.doc })) })),
    sections: Object.entries(SECTION_LABELS).map(([type, label]) => ({ type, label, modules: SECTION_MODULES[type as keyof typeof SECTION_MODULES] ?? [] })),
  }));

  app.post('/admin/site/templates/:key/apply', {
    preHandler: edit,
    schema: { tags: ['website'], params: z.object({ key: z.string() }), body: z.object({ replaceContent: z.boolean().default(true) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const r = await applyTemplate(tx, t.id, req.params.key, staffActor(req).userId, req.body);
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'site.template_apply', entityType: 'site', entityId: t.id, changes: { template: req.params.key, ...req.body } });
      return { data: r };
    });
  });

  app.get('/admin/site', { preHandler: edit, schema: { tags: ['website'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [theme] = await tx.select().from(themes).where(eq(themes.tenantId, t.id));
      const [settings] = await tx.select().from(siteSettings).where(eq(siteSettings.tenantId, t.id));
      const ps = await tx.select({ id: pages.id, slug: pages.slug, title: pages.title, sort: pages.sort, updatedAt: pages.updatedAt, hasUnpublishedChanges: pages.hasUnpublishedChanges, published: sql<boolean>`${pages.publishedVersionId} is not null` }).from(pages).where(eq(pages.tenantId, t.id)).orderBy(asc(pages.sort));
      const ds = await tx.select().from(domains).where(eq(domains.tenantId, t.id));
      return { data: { theme, settings, pages: ps, domains: ds.map((d) => ({ ...d, txtRecord: d.kind === 'custom' ? { name: `${TXT_PREFIX}.${d.hostname}`, value: `stays-verify=${d.verificationToken}` } : null })), modules: [...t.modules] } };
    });
  });

  app.put('/admin/site/theme', {
    preHandler: edit,
    schema: { tags: ['website'], body: z.object({ tokens: themeTokensSchema, logoUrl: z.string().url().max(1000).nullable().optional(), faviconUrl: z.string().url().max(1000).nullable().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await tx.update(themes).set(req.body).where(eq(themes.tenantId, t.id));
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'site.theme', entityType: 'site', entityId: t.id });
      return { ok: true };
    });
  });

  app.put('/admin/site/settings', {
    preHandler: edit,
    schema: {
      tags: ['website'],
      body: z.object({
        navigation: z.array(navLink).max(8), navCta: navLink.nullable().optional(),
        footer: z.object({ columns: z.array(z.object({ title: z.string().max(40), links: z.array(navLink).max(10) })).max(4), note: z.string().max(300), social: z.array(navLink).max(8) }),
        seoDefaults: z.object({ title: z.string().max(70).optional(), description: z.string().max(170).optional(), ogImage: z.string().url().optional() }),
      }),
    },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      await tx.insert(siteSettings).values({ tenantId: t.id, ...stripTags(req.body) }).onConflictDoUpdate({ target: siteSettings.tenantId, set: stripTags(req.body) });
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'site.settings', entityType: 'site', entityId: t.id });
      return { ok: true };
    });
  });

  // ----- Pages -----
  app.post('/admin/pages', {
    preHandler: edit,
    schema: { tags: ['website'], body: z.object({ slug: z.string().regex(/^[a-z0-9-]{2,60}$/), title: z.string().min(1).max(120), copyFromId: z.string().uuid().optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const p = await withTenant(t.id, async (tx) => {
      let doc = { sections: [] as never[] };
      if (req.body.copyFromId) {
        const [src] = await tx.select().from(pages).where(and(eq(pages.id, req.body.copyFromId), eq(pages.tenantId, t.id)));
        if (!src) throw badRequest('Unknown page to copy');
        doc = src.draftDoc as never;
      }
      const [{ n }] = (await tx.execute(sql`select coalesce(max(sort), 0) + 1 as n from pages where tenant_id = ${t.id}`)) as unknown as [{ n: number }];
      const [p] = await tx.insert(pages).values({ tenantId: t.id, slug: req.body.slug, title: req.body.title, draftDoc: validateDoc(doc), sort: n }).returning();
      await audit(tx, req, { action: 'page.create', entityType: 'page', entityId: p!.id });
      return p!;
    });
    return reply.status(201).send({ data: p });
  });

  app.get('/admin/pages/:id', { preHandler: edit, schema: { tags: ['website'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(pages).where(and(eq(pages.id, req.params.id), eq(pages.tenantId, t.id)));
      if (!p) throw notFound('Page');
      return { data: { ...p, versions: await versionsOf(tx, t.id, p.id) } };
    });
  });

  app.put('/admin/pages/:id/draft', {
    preHandler: edit,
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
    schema: { tags: ['website'], params: idParam, body: z.object({ doc: z.unknown(), seo: z.object({ title: z.string().max(70).optional(), description: z.string().max(170).optional(), ogImage: z.string().optional(), noindex: z.boolean().optional() }).optional(), title: z.string().min(1).max(120).optional(), revision: z.number().int() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const p = await saveDraft(tx, t.id, req.params.id, req.body);
      return { data: { revision: p.draftRevision, updatedAt: p.updatedAt } };
    });
  });

  app.patch('/admin/pages/:id', {
    preHandler: edit,
    schema: { tags: ['website'], params: idParam, body: z.object({ slug: z.string().regex(/^[a-z0-9-]{2,60}$/).optional(), sort: z.number().int().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(pages).where(and(eq(pages.id, req.params.id), eq(pages.tenantId, t.id)));
      if (!p) throw notFound('Page');
      if (p.slug === 'home' && req.body.slug && req.body.slug !== 'home') throw badRequest('The home page slug cannot change');
      const [u] = await tx.update(pages).set(req.body).where(eq(pages.id, p.id)).returning();
      return { data: u };
    });
  });

  app.delete('/admin/pages/:id', { preHandler: pub, schema: { tags: ['website'], params: idParam } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(pages).where(and(eq(pages.id, req.params.id), eq(pages.tenantId, t.id)));
      if (!p) throw notFound('Page');
      if (p.slug === 'home') throw badRequest('The home page cannot be deleted');
      await tx.delete(pages).where(eq(pages.id, p.id));
      await audit(tx, req, { action: 'page.delete', entityType: 'page', entityId: p.id, changes: { slug: p.slug } });
    });
    return reply.status(204).send();
  });

  app.post('/admin/pages/:id/publish', { preHandler: pub, schema: { tags: ['website'], params: idParam, body: z.object({ note: z.string().max(200).optional() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const v = await publishPage(tx, t.id, req.params.id, staffActor(req).userId, req.body.note);
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'page.publish', entityType: 'page', entityId: req.params.id, changes: { version: v.version } });
      return { data: v };
    });
  });

  app.post('/admin/pages/publish-all', { preHandler: pub, schema: { tags: ['website'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const ps = await tx.select().from(pages).where(and(eq(pages.tenantId, t.id), eq(pages.hasUnpublishedChanges, true)));
      for (const p of ps) await publishPage(tx, t.id, p.id, staffActor(req).userId, 'Published with site');
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'site.publish', entityType: 'site', entityId: t.id, changes: { pages: ps.map((p) => p.slug) } });
      return { data: { published: ps.length } };
    });
  });

  app.get('/admin/pages/:id/versions/:versionId', { preHandler: edit, schema: { tags: ['website'], params: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [v] = await tx.select().from(pageVersions).where(and(eq(pageVersions.id, req.params.versionId), eq(pageVersions.pageId, req.params.id), eq(pageVersions.tenantId, t.id)));
      if (!v) throw notFound('Version');
      return { data: v };
    });
  });

  app.post('/admin/pages/:id/rollback', { preHandler: pub, schema: { tags: ['website'], params: idParam, body: z.object({ versionId: z.string().uuid(), publish: z.boolean().default(false) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const v = await rollback(tx, t.id, req.params.id, req.body.versionId, staffActor(req).userId, req.body.publish);
      afterCommit(tx, () => purgeSite(t.id));
      await audit(tx, req, { action: 'page.rollback', entityType: 'page', entityId: req.params.id, changes: req.body });
      return { data: v };
    });
  });

  // ----- Custom domains -----
  app.post('/admin/domains', { preHandler: [requireStaff('tenant.settings'), requireModule('website_builder')], schema: { tags: ['website'], body: z.object({ hostname: z.string().min(4).max(253) }) } }, async (req, reply) => {
    const t = tenantOf(req);
    const d = await withTenant(t.id, async (tx) => {
      const d = await addDomain(tx, t.id, req.body.hostname, config.PLATFORM_ROOT_DOMAIN);
      await audit(tx, req, { action: 'domain.add', entityType: 'domain', entityId: d.id, changes: { hostname: d.hostname } });
      return d;
    });
    return reply.status(201).send({ data: { ...d, txtRecord: { name: `${TXT_PREFIX}.${d.hostname}`, value: `stays-verify=${d.verificationToken}` }, cname: `sites.${config.PLATFORM_ROOT_DOMAIN}` } });
  });
  app.post('/admin/domains/:id/verify', { preHandler: [requireStaff('tenant.settings'), requireModule('website_builder')], schema: { tags: ['website'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const d = await verifyDomain(tx, t.id, req.params.id);
      await audit(tx, req, { action: 'domain.verify', entityType: 'domain', entityId: d.id });
      return { data: d };
    });
  });
  app.post('/admin/domains/:id/primary', { preHandler: [requireStaff('tenant.settings'), requireModule('website_builder')], schema: { tags: ['website'], params: idParam } }, async (req) => {
    const t = tenantOf(req);
    await withTenant(t.id, (tx) => makePrimary(tx, t.id, req.params.id));
    return { ok: true };
  });
  app.delete('/admin/domains/:id', { preHandler: [requireStaff('tenant.settings'), requireModule('website_builder')], schema: { tags: ['website'], params: idParam } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      await removeDomain(tx, t.id, req.params.id);
      await audit(tx, req, { action: 'domain.remove', entityType: 'domain', entityId: req.params.id });
    });
    return reply.status(204).send();
  });

  // ================= Public site =================
  app.get('/public/site', { preHandler: resolvePublicTenant, schema: { tags: ['website'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [theme] = await tx.select().from(themes).where(eq(themes.tenantId, t.id));
      const [settings] = await tx.select().from(siteSettings).where(eq(siteSettings.tenantId, t.id));
      const [prop] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      const published = await tx.select({ slug: pages.slug, title: pages.title }).from(pages).where(and(eq(pages.tenantId, t.id), sql`${pages.publishedVersionId} is not null`)).orderBy(asc(pages.sort));
      const [primary] = await tx.select({ hostname: domains.hostname }).from(domains).where(and(eq(domains.tenantId, t.id), eq(domains.isPrimary, true)));
      return {
        data: {
          tenant: { slug: t.slug, name: t.name, currency: t.currency, timezone: t.timezone, modules: [...t.modules] },
          theme: theme ?? null, settings: settings ?? null, pages: published, primaryHost: primary?.hostname ?? null,
          property: prop && { name: prop.name, tagline: prop.tagline, phone: prop.phone, email: prop.email, addressLine: prop.addressLine, city: prop.city, region: prop.region, country: prop.country, postalCode: prop.postalCode, latitude: prop.latitude, longitude: prop.longitude, checkInTime: prop.checkInTime, checkOutTime: prop.checkOutTime, starRating: prop.starRating, images: prop.images, amenities: prop.amenities },
        },
      };
    });
  });

  app.get('/public/pages/:slug', { preHandler: resolvePublicTenant, schema: { tags: ['website'], params: z.object({ slug: z.string().max(60) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const row = await publishedPage(tx, t.id, req.params.slug);
      if (!row) throw notFound('Page');
      return { data: { slug: row.page.slug, title: row.page.title, doc: row.version.doc, seo: row.version.seo, version: row.version.version, publishedAt: row.version.createdAt } };
    });
  });

  /** Staff preview of a draft rendered on the real site. */
  app.get('/public/pages/:slug/preview', { preHandler: [requireStaff('content.manage')], schema: { tags: ['website'], params: z.object({ slug: z.string().max(60) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(pages).where(and(eq(pages.tenantId, t.id), eq(pages.slug, req.params.slug)));
      if (!p) throw notFound('Page');
      return { data: { slug: p.slug, title: p.title, doc: p.draftDoc, seo: p.draftSeo, version: null, preview: true } };
    });
  });

  app.get('/public/room-types', { preHandler: resolvePublicTenant, schema: { tags: ['website'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const rts = await tx.select().from(roomTypes).where(and(eq(roomTypes.tenantId, t.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sort));
      const prices = await tx.execute(sql`select room_type_id as "roomTypeId", min(base_price)::int as "fromPrice" from rate_plans where tenant_id = ${t.id} and active group by room_type_id`);
      const pm = new Map((prices as unknown as { roomTypeId: string; fromPrice: number }[]).map((p) => [p.roomTypeId, p.fromPrice]));
      return { data: rts.map((r) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, images: r.images, amenities: r.amenities, bedConfig: r.bedConfig, sizeSqm: r.sizeSqm, view: r.view, maxOccupancy: r.maxOccupancy, fromPrice: pm.get(r.id) ?? null })) };
    });
  });

  app.get('/public/offers', { preHandler: [resolvePublicTenant, requireModule('offers')], schema: { tags: ['website'] } }, async (req) => {
    const t = tenantOf(req);
    const now = new Date();
    return withTenant(t.id, async (tx) => ({
      data: await tx.select({ id: promotions.id, title: promotions.title, summary: promotions.summary, body: promotions.body, image: promotions.image, endsAt: promotions.endsAt }).from(promotions)
        .where(and(eq(promotions.tenantId, t.id), eq(promotions.active, true), or(isNull(promotions.startsAt), lte(promotions.startsAt, now)), or(isNull(promotions.endsAt), gte(promotions.endsAt, now)))).orderBy(asc(promotions.sort)),
    }));
  });

  /** Website contact form → lands in the staff message inbox. */
  app.post('/public/contact', {
    preHandler: resolvePublicTenant,
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: { tags: ['website'], body: z.object({ name: z.string().min(2).max(120), email: z.string().email(), phone: z.string().max(30).optional(), topic: z.string().max(60).optional(), message: z.string().min(5).max(3000), website: z.string().max(0).optional() }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, async (tx) => {
      const [first, ...rest] = req.body.name.trim().split(/\s+/);
      const [existing] = await tx.select().from(guests).where(and(eq(guests.tenantId, t.id), eq(sql`lower(${guests.email})`, req.body.email.toLowerCase())));
      const g = existing ?? (await tx.insert(guests).values({ tenantId: t.id, email: req.body.email, firstName: first ?? 'Guest', lastName: rest.join(' ') || '-', phone: req.body.phone }).returning())[0]!;
      await tx.insert(guestMessages).values({ tenantId: t.id, guestId: g.id, senderType: 'guest', body: stripTags(`[Website — ${req.body.topic ?? 'General'}] ${req.body.message}`) });
    });
    return reply.status(202).send({ ok: true });
  });

  /** Caddy on-demand TLS `ask` hook: issue certificates only for hosts that resolve to an active tenant. */
  app.get('/public/tls-allowed', { schema: { hide: true, querystring: z.object({ domain: z.string().max(253) }) } }, async (req, reply) => {
    const { resolveHost } = await import('../tenants/tenant-cache.js');
    const id = await resolveHost(req.query.domain, config.PLATFORM_ROOT_DOMAIN);
    return reply.status(id ? 200 : 404).send({ ok: !!id });
  });

  /** Per-tenant PWA manifest so guests install *their* hotel's app. */
  app.get('/public/manifest', { preHandler: resolvePublicTenant, schema: { tags: ['website'] } }, async (req, reply) => {
    const t = tenantOf(req);
    const [theme] = await withTenant(t.id, (tx) => tx.select().from(themes).where(eq(themes.tenantId, t.id)));
    const tokens = (theme?.tokens ?? {}) as Record<string, string>;
    reply.header('content-type', 'application/manifest+json').header('cache-control', 'public, max-age=3600');
    return {
      name: t.name, short_name: t.name.length > 12 ? t.name.split(' ')[0] : t.name, start_url: '/stay?source=pwa', scope: '/', display: 'standalone',
      background_color: tokens.bg ?? '#FAF8F5', theme_color: tokens.inverseBg ?? tokens.ink ?? '#1C1A17', description: `Your stay at ${t.name}`,
      icons: [
        { src: theme?.faviconUrl ?? '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  });

  void tenants;
};
