import { isLocale, LOCALES, objectTexts, pageTexts, translateObject, translatePage, type PageDoc, type TranslationMap } from '@hp/contracts';
import { contentTranslations, pages, siteSettings } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, notFound } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { afterCommit, withTenant, type Tx } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { purgeSite } from '../../lib/purge.js';

export async function translationMap(tx: Tx, tenantId: string, scope: string, locale: string | undefined): Promise<TranslationMap | null> {
  if (!locale || locale === 'en' || !isLocale(locale)) return null;
  const [row] = await tx.select({ strings: contentTranslations.strings }).from(contentTranslations).where(and(eq(contentTranslations.tenantId, tenantId), eq(contentTranslations.scope, scope), eq(contentTranslations.locale, locale)));
  return row?.strings ?? null;
}

/** Page translations cover the page texts plus its SEO title and description (`_seo.*`). */
export function localisePage(doc: PageDoc, seo: { title?: string; description?: string }, map: TranslationMap | null) {
  if (!map) return { doc, seo };
  return { doc: translatePage(doc, map), seo: translateObject({ _seo: seo }, map)._seo };
}

type ChromeLike = { navigation: unknown; navCta: unknown; footer: unknown };
export const siteChrome = (s: ChromeLike) => ({ navigation: s.navigation, navCta: s.navCta, footer: s.footer });

export const translationRoutes: Routes = async (app) => {
  const edit = [requireStaff('content.manage'), requireModule('website_builder')];
  const scopeParam = z.object({ scope: z.string().regex(/^(site|[0-9a-f-]{36})$/) });

  /** What there is to translate, with the current translation and whether English changed since. */
  async function itemsFor(tx: Tx, tenantId: string, scope: string) {
    if (scope === 'site') {
      const [s] = await tx.select().from(siteSettings).where(eq(siteSettings.tenantId, tenantId));
      return { title: 'Menus & footer', items: s ? objectTexts(siteChrome(s)) : [] };
    }
    const [p] = await tx.select().from(pages).where(and(eq(pages.id, scope), eq(pages.tenantId, tenantId)));
    if (!p) throw notFound('Page');
    const seo = p.draftSeo as { title?: string; description?: string };
    const seoItems = [seo.title && { path: '_seo.title', text: seo.title, label: 'Search › Title' }, seo.description && { path: '_seo.description', text: seo.description, label: 'Search › Description' }].filter(Boolean) as { path: string; text: string; label: string }[];
    return { title: p.title, items: [...pageTexts(p.draftDoc as PageDoc), ...seoItems] };
  }

  app.get('/admin/translations/:scope', { preHandler: edit, schema: { tags: ['website'], params: scopeParam, querystring: z.object({ locale: z.enum(LOCALES) }) } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const { title, items } = await itemsFor(tx, t.id, req.params.scope);
      const map = (await translationMap(tx, t.id, req.params.scope === 'site' ? 'site' : `page:${req.params.scope}`, req.query.locale)) ?? {};
      return { data: { title, items: items.map((i) => ({ ...i, translation: map[i.path]?.text ?? '', stale: !!map[i.path] && map[i.path]!.source !== i.text })) } };
    });
  });

  app.put('/admin/translations/:scope', {
    preHandler: edit,
    schema: { tags: ['website'], params: scopeParam, body: z.object({ locale: z.enum(LOCALES).refine((l) => l !== 'en', 'English is the source'), strings: z.record(z.string().max(300), z.string().max(4000)) }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const { items } = await itemsFor(tx, t.id, req.params.scope);
      const source = new Map(items.map((i) => [i.path, i.text]));
      const strings: TranslationMap = {};
      for (const [path, text] of Object.entries(req.body.strings)) {
        if (!source.has(path)) throw badRequest(`Unknown text: ${path}`);
        if (text.trim()) strings[path] = { source: source.get(path)!, text: text.trim() };
      }
      const scope = req.params.scope === 'site' ? 'site' : `page:${req.params.scope}`;
      await tx.insert(contentTranslations).values({ tenantId: t.id, scope, locale: req.body.locale, strings })
        .onConflictDoUpdate({ target: [contentTranslations.tenantId, contentTranslations.scope, contentTranslations.locale], set: { strings, updatedAt: new Date() } });
      await audit(tx, req, { action: 'translation.save', entityType: 'content', entityId: scope, changes: { locale: req.body.locale, count: Object.keys(strings).length } });
      afterCommit(tx, () => purgeSite(t.id));
      return { data: { saved: Object.keys(strings).length } };
    });
  });

  app.put('/admin/site-languages', { preHandler: [requireStaff('content.manage'), requireModule('website_builder')], schema: { tags: ['website'], body: z.object({ languages: z.array(z.enum(LOCALES)).max(LOCALES.length) }) } }, async (req) => {
    const t = tenantOf(req);
    const languages = ['en', ...new Set(req.body.languages.filter((l) => l !== 'en'))];
    await withTenant(t.id, async (tx) => {
      await tx.update(siteSettings).set({ languages }).where(eq(siteSettings.tenantId, t.id));
      await audit(tx, req, { action: 'site.languages', entityType: 'site_settings', entityId: t.id, changes: { languages } });
      afterCommit(tx, () => purgeSite(t.id));
    });
    return { data: { languages } };
  });
};
