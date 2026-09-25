import { getTemplate, pageDocSchema, type PageDoc } from '@hp/contracts';
import { pages, pageVersions, siteSettings, themes } from '@hp/db';
import { and, desc, eq, max } from 'drizzle-orm';
import { ZodError } from 'zod';
import { AppError, badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';

/** Strip anything that looks like an HTML tag from every string (defence in depth — the renderer never uses HTML). */
export function stripTags<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/<\/?[a-zA-Z!][^>]*>/g, '') as T;
  if (Array.isArray(v)) return v.map(stripTags) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripTags(x)])) as T;
  return v;
}

export function validateDoc(doc: unknown): PageDoc {
  try {
    return stripTags(pageDocSchema.parse(doc)) as PageDoc;
  } catch (e) {
    if (e instanceof ZodError) throw new AppError(422, 'invalid_page', 'The page has invalid content', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    throw e;
  }
}

async function nextVersion(tx: Tx, pageId: string) {
  const [r] = await tx.select({ v: max(pageVersions.version) }).from(pageVersions).where(eq(pageVersions.pageId, pageId));
  return (r?.v ?? 0) + 1;
}

/** Autosave with optimistic concurrency: the client sends the revision it edited; stale saves are rejected. */
export async function saveDraft(tx: Tx, tenantId: string, pageId: string, input: { doc: unknown; seo?: Record<string, unknown>; title?: string; revision: number }) {
  const doc = validateDoc(input.doc);
  const [p] = await tx.select().from(pages).where(and(eq(pages.id, pageId), eq(pages.tenantId, tenantId))).for('update');
  if (!p) throw notFound('Page');
  if (p.draftRevision !== input.revision) throw conflict('This page was changed in another window. Reload to continue.', { currentRevision: p.draftRevision });
  const [u] = await tx.update(pages).set({ draftDoc: doc, draftSeo: stripTags(input.seo ?? p.draftSeo), title: input.title ?? p.title, draftRevision: p.draftRevision + 1, hasUnpublishedChanges: true }).where(eq(pages.id, p.id)).returning();
  return u!;
}

export async function publishPage(tx: Tx, tenantId: string, pageId: string, userId: string, note?: string) {
  const [p] = await tx.select().from(pages).where(and(eq(pages.id, pageId), eq(pages.tenantId, tenantId))).for('update');
  if (!p) throw notFound('Page');
  const doc = validateDoc(p.draftDoc);
  const [v] = await tx.insert(pageVersions).values({ tenantId, pageId: p.id, version: await nextVersion(tx, p.id), doc, seo: p.draftSeo, kind: 'publish', note, createdByUserId: userId }).returning();
  await tx.update(pages).set({ publishedVersionId: v!.id, hasUnpublishedChanges: false }).where(eq(pages.id, p.id));
  return v!;
}

/** Restore a version into the draft (and optionally publish it straight away). */
export async function rollback(tx: Tx, tenantId: string, pageId: string, versionId: string, userId: string, publish: boolean) {
  const [v] = await tx.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId), eq(pageVersions.tenantId, tenantId)));
  if (!v) throw notFound('Version');
  const [p] = await tx.select().from(pages).where(eq(pages.id, pageId)).for('update');
  await tx.insert(pageVersions).values({ tenantId, pageId, version: await nextVersion(tx, pageId), doc: p!.draftDoc, seo: p!.draftSeo, kind: 'snapshot', note: `Before restoring v${v.version}`, createdByUserId: userId });
  await tx.update(pages).set({ draftDoc: v.doc, draftSeo: v.seo, draftRevision: p!.draftRevision + 1, hasUnpublishedChanges: true }).where(eq(pages.id, pageId));
  if (publish) return publishPage(tx, tenantId, pageId, userId, `Rolled back to v${v.version}`);
  return v;
}

/**
 * Apply one of the ten starter templates. Existing drafts are snapshotted first so the change can be
 * rolled back; pages are created or replaced by slug; theme and navigation are switched.
 */
export async function applyTemplate(tx: Tx, tenantId: string, key: string, userId: string, opts: { replaceContent: boolean }) {
  const tpl = getTemplate(key);
  if (!tpl) throw badRequest('Unknown template');
  await tx.insert(themes).values({ tenantId, templateKey: key, tokens: tpl.tokens }).onConflictDoUpdate({ target: themes.tenantId, set: { templateKey: key, tokens: tpl.tokens } });
  if (!opts.replaceContent) return { pages: 0 };
  const existing = await tx.select().from(pages).where(eq(pages.tenantId, tenantId));
  let i = 0;
  for (const tp of tpl.pages) {
    const doc = validateDoc(tp.doc);
    const current = existing.find((p) => p.slug === tp.slug);
    if (current) {
      await tx.insert(pageVersions).values({ tenantId, pageId: current.id, version: await nextVersion(tx, current.id), doc: current.draftDoc, seo: current.draftSeo, kind: 'snapshot', note: `Before applying the ${tpl.name} template`, createdByUserId: userId });
      await tx.update(pages).set({ draftDoc: doc, draftSeo: tp.seo, title: tp.title, draftRevision: current.draftRevision + 1, hasUnpublishedChanges: true, sort: i }).where(eq(pages.id, current.id));
    } else {
      const [p] = await tx.insert(pages).values({ tenantId, slug: tp.slug, title: tp.title, draftDoc: doc, draftSeo: tp.seo, sort: i }).returning();
      await tx.insert(pageVersions).values({ tenantId, pageId: p!.id, version: 1, doc, seo: tp.seo, kind: 'template', note: `${tpl.name} template`, createdByUserId: userId });
    }
    i++;
  }
  await tx.insert(siteSettings).values({ tenantId, navigation: tpl.navigation }).onConflictDoUpdate({ target: siteSettings.tenantId, set: { navigation: tpl.navigation } });
  return { pages: tpl.pages.length };
}

export async function publishedPage(tx: Tx, tenantId: string, slug: string) {
  const [row] = await tx
    .select({ page: pages, version: pageVersions })
    .from(pages)
    .innerJoin(pageVersions, eq(pageVersions.id, pages.publishedVersionId))
    .where(and(eq(pages.tenantId, tenantId), eq(pages.slug, slug)));
  return row ?? null;
}

export async function versionsOf(tx: Tx, tenantId: string, pageId: string) {
  return tx.select({ id: pageVersions.id, version: pageVersions.version, kind: pageVersions.kind, note: pageVersions.note, createdAt: pageVersions.createdAt, createdByUserId: pageVersions.createdByUserId })
    .from(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.tenantId, tenantId))).orderBy(desc(pageVersions.version)).limit(100);
}
