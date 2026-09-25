import { announcements, guidePages, properties } from '@hp/db';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { crud } from '../../http/crud.js';
import { requireModule, resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';

/** Guide content is structured plain text — rendered as text by clients, never as HTML. */
export const guideBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: z.string().max(4000) }),
  z.object({ type: z.literal('h'), text: z.string().max(200) }),
  z.object({ type: z.literal('list'), items: z.array(z.string().max(500)).max(50) }),
  z.object({ type: z.literal('kv'), rows: z.array(z.object({ k: z.string().max(100), v: z.string().max(500) })).max(50) }),
  z.object({ type: z.literal('callout'), tone: z.enum(['info', 'warning', 'emergency']), text: z.string().max(1000) }),
]);

export const guideRoutes: Routes = async (app) => {
  crud(app, {
    path: '/admin/guide-pages', entity: 'guide_page', table: guidePages, permission: 'content.manage', tag: 'guide', modules: ['guest_portal'], orderBy: guidePages.sort,
    body: z.object({
      propertyId: z.string().uuid(),
      category: z.enum(['about', 'dining', 'facilities', 'wifi', 'house_rules', 'emergency', 'nearby', 'transport', 'contact', 'faq', 'custom']),
      slug: z.string().regex(/^[a-z0-9-]{2,60}$/), title: z.string().min(2).max(120), summary: z.string().max(300).nullable().optional(),
      body: z.array(guideBlock).max(100).default([]), published: z.boolean().default(true), sort: z.number().int().default(0),
    }),
  });
  crud(app, {
    path: '/admin/announcements', entity: 'announcement', table: announcements, permission: 'content.manage', tag: 'guide', modules: ['guest_portal'], orderBy: announcements.createdAt,
    body: z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(1000), startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(), published: z.boolean().default(true) }),
  });

  const pre = [resolvePublicTenant, requireModule('guest_portal')];
  app.get('/public/guide', { preHandler: pre, schema: { tags: ['guide'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [p] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      const pages = await tx.select().from(guidePages).where(and(eq(guidePages.tenantId, t.id), eq(guidePages.published, true))).orderBy(asc(guidePages.sort));
      const now = new Date();
      const notices = await tx.select().from(announcements).where(and(
        eq(announcements.tenantId, t.id), eq(announcements.published, true),
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)), or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
      )).orderBy(desc(announcements.createdAt));
      return {
        data: {
          property: p && { name: p.name, phone: p.phone, email: p.email, addressLine: p.addressLine, city: p.city, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, latitude: p.latitude, longitude: p.longitude },
          pages, announcements: notices,
        },
      };
    });
  });
};
