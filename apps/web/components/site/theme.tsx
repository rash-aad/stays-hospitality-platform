import type { ThemeTokens } from '@hp/contracts';

const DENSITY = { airy: 1.25, balanced: 1, compact: 0.8 } as const;

export function themeVars(t: Partial<ThemeTokens> | undefined): React.CSSProperties {
  if (!t) return {};
  return {
    ['--t-bg' as string]: t.bg, ['--t-surface' as string]: t.surface, ['--t-ink' as string]: t.ink, ['--t-muted' as string]: t.muted,
    ['--t-line' as string]: t.line, ['--t-accent' as string]: t.accent, ['--t-accent-ink' as string]: t.accentInk,
    ['--t-inverse-bg' as string]: t.inverseBg, ['--t-inverse-ink' as string]: t.inverseInk, ['--t-radius' as string]: `${t.radius ?? 0}px`,
    ['--t-display' as string]: `"${t.fontDisplay}", Georgia, serif`, ['--t-body' as string]: `"${t.fontBody}", system-ui, sans-serif`,
    ['--t-heading-case' as string]: t.headingCase, ['--t-heading-weight' as string]: t.headingWeight, ['--t-gap' as string]: String(DENSITY[t.density ?? 'balanced']),
  };
}

export function fontHref(t: Partial<ThemeTokens> | undefined) {
  const fams = [...new Set([t?.fontDisplay, t?.fontBody].filter(Boolean) as string[])];
  if (!fams.length) return null;
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400`).join('&')}&display=swap`;
}
