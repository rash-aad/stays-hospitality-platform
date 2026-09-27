import { describe, expect, it } from 'vitest';
import type { PageDoc } from './page-schema';
import { objectTexts, pageTexts, translateObject, translatePage } from './translation';

const doc = {
  sections: [
    { id: 'hero-1', type: 'hero', props: { heading: 'Wake to the tide', layout: 'full_bleed', image: { url: 'https://x/y.jpg', alt: 'Beach at dawn' }, primaryCta: { label: 'Book', href: '/book' }, overlay: 0.3, showBookingBar: true } },
    { id: 'faq-1', type: 'faq', props: { heading: 'Questions', items: [{ q: 'Pets?', a: 'Small dogs welcome.' }] } },
    { id: 'rt-1', type: 'rich_text', props: { width: 'narrow', blocks: [{ type: 'p', text: 'Hello' }] } },
  ],
} as unknown as PageDoc;

describe('content translation', () => {
  it('finds guest-visible texts only, with stable paths and readable labels', () => {
    const items = pageTexts(doc);
    expect(items.map((i) => i.path)).toEqual(['hero-1.heading', 'hero-1.image.alt', 'hero-1.primaryCta.label', 'faq-1.heading', 'faq-1.items.0.q', 'faq-1.items.0.a', 'rt-1.blocks.0.text']);
    expect(items[4]!.label).toBe('FAQ › Items › #1 › Q');
  });
  it('applies translations whose source still matches and falls back to English when it changed', () => {
    const out = translatePage(doc, {
      'hero-1.heading': { source: 'Wake to the tide', text: 'लहरों के साथ जागिए' },
      'faq-1.items.0.a': { source: 'Dogs welcome.', text: 'कुत्तों का स्वागत है।' }, // stale source
      'hero-1.image.url': { source: 'https://x/y.jpg', text: 'https://evil' }, // not a text field — ignored below
    });
    const s = out.sections as unknown as { props: Record<string, unknown> }[];
    expect(s[0]!.props.heading).toBe('लहरों के साथ जागिए');
    expect((s[1]!.props.items as { a: string }[])[0]!.a).toBe('Small dogs welcome.');
    expect((doc.sections[0] as unknown as { props: { heading: string } }).props.heading).toBe('Wake to the tide'); // original untouched
    expect(pageTexts(doc).some((i) => i.path === 'hero-1.image.url')).toBe(false);
  });
  it('translates site menus and footers the same way', () => {
    const nav = { navigation: [{ label: 'Rooms', href: '/rooms' }], footer: { note: '© Seabreeze', columns: [] } };
    expect(objectTexts(nav).map((i) => i.path)).toEqual(['navigation.0.label', 'footer.note']);
    expect(translateObject(nav, { 'navigation.0.label': { source: 'Rooms', text: 'कमरे' } }).navigation[0]!.label).toBe('कमरे');
  });
});
