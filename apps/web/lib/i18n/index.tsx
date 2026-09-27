'use client';

import { LOCALE_NAMES, type Locale } from '@hp/contracts';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { MESSAGES } from './messages';

/**
 * Guest-facing interface language. Keys are the English text itself, so anything not yet translated
 * simply shows in English. `{name}` placeholders are filled from `vars`.
 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>) {
  const s = locale === 'en' ? key : (MESSAGES[locale]?.[key] ?? key);
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s;
}

const Ctx = createContext<{ locale: Locale; languages: Locale[] }>({ locale: 'en', languages: ['en'] });

export function LocaleProvider({ locale, languages, children }: { locale: Locale; languages: Locale[]; children: ReactNode }) {
  return <Ctx.Provider value={{ locale, languages }}><div lang={locale} className="contents">{children}</div></Ctx.Provider>;
}

export const useLocale = () => useContext(Ctx);

export function useT() {
  const { locale } = useContext(Ctx);
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

/** Pick a language: remembered in a cookie for this site, then the page reloads in it. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, languages } = useLocale();
  if (languages.length < 2) return null;
  return (
    <select aria-label="Language" className={`bg-transparent text-[14px] ${className}`} value={locale}
      onChange={(e) => { document.cookie = `bz_lang=${e.target.value}; path=/; max-age=31536000; samesite=lax`; location.reload(); }}>
      {languages.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
    </select>
  );
}
