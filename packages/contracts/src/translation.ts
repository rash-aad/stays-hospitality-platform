import { SECTION_LABELS, type PageDoc, type SectionType } from './page-schema';

/**
 * Content translation. Translations are keyed by a stable path to each piece of text (section id +
 * property path, e.g. `hero-1.heading` or `faq-2.items.0.a`) and remember the English source they were
 * made from. If the source text later changes, the translation is treated as stale and the English is
 * shown until someone updates it — layout, images and links are never duplicated per language.
 */
export const LOCALES = ['en', 'hi', 'ta', 'ml'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', ml: 'മലയാളം' };
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export type TextItem = { path: string; text: string; label: string };
export type TranslationMap = Record<string, { source: string; text: string }>;

/** Keys whose string values are settings, identifiers or links — never shown to guests as text. */
const NOT_TEXT = new Set(['layout', 'tone', 'align', 'imageSide', 'width', 'type', 'href', 'url', 'restaurantId', 'restaurantIds', 'roomTypeIds', 'kinds', 'id']);
const looksLikeText = (s: string) => /\p{L}/u.test(s) && !/^(https?:|mailto:|tel:|\/|#)/i.test(s.trim());
const human = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase());

function walk(value: unknown, path: string[], out: { path: string[]; text: string }[]) {
  if (typeof value === 'string') {
    const key = [...path].reverse().find((p) => !/^\d+$/.test(p));
    if (key && !NOT_TEXT.has(key) && looksLikeText(value)) out.push({ path, text: value });
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)], out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!NOT_TEXT.has(k)) walk(v, [...path, k], out);
}

function describe(path: string[]) {
  return path.map((p) => (/^\d+$/.test(p) ? `#${Number(p) + 1}` : human(p))).join(' › ');
}

/** Every guest-visible text in a page, in page order. */
export function pageTexts(doc: PageDoc): TextItem[] {
  const items: TextItem[] = [];
  for (const s of doc.sections) {
    const found: { path: string[]; text: string }[] = [];
    walk(s.props, [], found);
    for (const f of found) items.push({ path: [s.id, ...f.path].join('.'), text: f.text, label: `${SECTION_LABELS[s.type as SectionType] ?? s.type} › ${describe(f.path)}` });
  }
  return items;
}

/** Texts in any object (site menus/footer): paths relative to the object. */
export function objectTexts(obj: unknown): TextItem[] {
  const found: { path: string[]; text: string }[] = [];
  walk(obj, [], found);
  return found.map((f) => ({ path: f.path.join('.'), text: f.text, label: describe(f.path) }));
}

function setAt(root: unknown, path: string[], value: string) {
  let cur = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur?.[path[i]!];
    if (next === null || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  const last = path.at(-1)!;
  if (typeof cur?.[last] === 'string') cur[last] = value;
}

function getAt(root: unknown, path: string[]) {
  return path.reduce<unknown>((cur, p) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined), root);
}

/** Apply translations whose English source still matches (stale ones fall back to English). */
export function translatePage(doc: PageDoc, map: TranslationMap | null | undefined): PageDoc {
  if (!map || !Object.keys(map).length) return doc;
  const copy = structuredClone(doc);
  for (const s of copy.sections) {
    for (const [path, t] of Object.entries(map)) {
      const [sid, ...rest] = path.split('.');
      if (sid !== s.id || !t.text.trim()) continue;
      if (getAt(s.props, rest) === t.source) setAt(s.props, rest, t.text);
    }
  }
  return copy;
}

export function translateObject<T>(obj: T, map: TranslationMap | null | undefined): T {
  if (!map || !Object.keys(map).length || !obj) return obj;
  const copy = structuredClone(obj);
  for (const [path, t] of Object.entries(map)) {
    const parts = path.split('.');
    if (t.text.trim() && getAt(copy, parts) === t.source) setAt(copy, parts, t.text);
  }
  return copy;
}
