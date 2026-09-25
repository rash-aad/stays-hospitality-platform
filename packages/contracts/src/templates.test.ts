import { describe, expect, it } from 'vitest';
import { pageDocSchema, SITE_TEMPLATES, themeTokensSchema } from './index';

describe('site templates', () => {
  it('ships ten distinct templates', () => {
    expect(SITE_TEMPLATES).toHaveLength(10);
    expect(new Set(SITE_TEMPLATES.map((t) => t.key)).size).toBe(10);
  });
  it.each(SITE_TEMPLATES.map((t) => [t.key, t] as const))('%s validates against the page and theme schema', (_k, t) => {
    expect(() => themeTokensSchema.parse(t.tokens)).not.toThrow();
    expect(t.pages.map((p) => p.slug)).toEqual(['home', 'rooms', 'dining', 'experiences', 'contact']);
    for (const p of t.pages) {
      const r = pageDocSchema.safeParse(p.doc);
      expect(r.success, JSON.stringify(!r.success && r.error.issues.slice(0, 2))).toBe(true);
    }
  });
});

describe('page schema security', () => {
  const hero = (props: Record<string, unknown>) => ({ sections: [{ id: 'hero0001', type: 'hero', props: { heading: 'Hi', ...props } }] });
  it('rejects javascript: links and non-https images', () => {
    expect(pageDocSchema.safeParse(hero({ primaryCta: { label: 'x', href: 'javascript:alert(1)' } })).success).toBe(false);
    expect(pageDocSchema.safeParse(hero({ primaryCta: { label: 'x', href: '//evil.example' } })).success).toBe(false);
    expect(pageDocSchema.safeParse(hero({ image: { url: 'http://insecure.example/a.jpg', alt: '' } })).success).toBe(false);
    expect(pageDocSchema.safeParse(hero({ image: { url: 'data:text/html;base64,PHNjcmlwdD4=', alt: '' } })).success).toBe(false);
  });
  it('rejects unknown section types and duplicate ids', () => {
    expect(pageDocSchema.safeParse({ sections: [{ id: 'raw00001', type: 'html', props: { html: '<script>' } }] }).success).toBe(false);
    expect(pageDocSchema.safeParse({ sections: [{ id: 'aaaa1', type: 'cta', props: { heading: 'x', primary: { label: 'a', href: '/' } } }, { id: 'aaaa1', type: 'cta', props: { heading: 'y', primary: { label: 'a', href: '/' } } }] }).success).toBe(false);
  });
  it('strips unknown props so nothing unvalidated is stored', () => {
    const r = pageDocSchema.parse(hero({ onClick: 'alert(1)', dangerouslySetInnerHTML: { __html: '<b>' } }));
    expect(Object.keys(r.sections[0]!.props as object)).not.toContain('onClick');
    expect(Object.keys(r.sections[0]!.props as object)).not.toContain('dangerouslySetInnerHTML');
  });
});
