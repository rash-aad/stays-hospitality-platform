'use client';

import { useEffect, useState } from 'react';
import type { SiteInfo } from './types';

export function SiteHeader({ site, overlay }: { site: SiteInfo; overlay?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const nav = site.settings?.navigation ?? [];
  const cta = site.settings?.navCta ?? (site.tenant.modules.includes('room_booking') ? { label: 'Book', href: '/book' } : null);
  const light = overlay && !scrolled && !open;
  return (
    <header className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${light ? 'text-white' : 'border-b t-line'}`} style={light ? undefined : { background: 'var(--t-bg)', color: 'var(--t-ink)' }}>
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-14">
        <a href="/" className="display truncate text-[22px]">{site.theme?.logoUrl ? <img src={site.theme.logoUrl} alt={site.tenant.name} className="h-8 w-auto" /> : site.tenant.name}</a>
        <nav className="hidden items-center gap-8 text-[14px] md:flex">
          {nav.map((l) => <a key={l.href} href={l.href} className="opacity-85 hover:opacity-100">{l.label}</a>)}
          {site.tenant.modules.includes('guest_portal') && <a href="/stay" className="opacity-85 hover:opacity-100">Your stay</a>}
          {cta && <a href={cta.href} className={`t-btn h-10 px-5 ${light ? 't-btn-outline' : ''}`}>{cta.label}</a>}
        </nav>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">{open ? 'Close' : 'Menu'}</button>
      </div>
      {open && (
        <nav className="anim-sheet border-t t-line px-5 pb-8 md:hidden" style={{ background: 'var(--t-bg)' }}>
          {[...nav, ...(site.tenant.modules.includes('guest_portal') ? [{ label: 'Your stay', href: '/stay' }] : [])].map((l) => <a key={l.href} href={l.href} className="display block border-b t-line py-4 text-2xl">{l.label}</a>)}
          {cta && <a href={cta.href} className="t-btn mt-6 w-full">{cta.label}</a>}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter({ site }: { site: SiteInfo }) {
  const f = site.settings?.footer;
  const p = site.property;
  return (
    <footer className="t-inverse px-5 pt-16 pb-10 sm:px-8 lg:px-14">
      <div className="mx-auto grid max-w-[1240px] gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <p className="display text-3xl">{site.tenant.name}</p>
          {p?.tagline && <p className="mt-2 opacity-70">{p.tagline}</p>}
          {p?.addressLine && <p className="mt-6 text-sm opacity-70">{[p.addressLine, p.city, p.postalCode].filter(Boolean).join(', ')}</p>}
        </div>
        {f?.columns.map((c) => (
          <div key={c.title}>
            <p className="text-[12px] tracking-[0.16em] uppercase opacity-60">{c.title}</p>
            <ul className="mt-4 space-y-2 text-sm">{c.links.map((l) => <li key={l.href + l.label}><a href={l.href} className="opacity-85 hover:opacity-100">{l.label}</a></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-[1240px] flex-wrap justify-between gap-4 border-t border-white/15 pt-6 text-xs opacity-60">
        <p>{f?.note}</p>
        <p className="flex gap-4">{f?.social.map((s) => <a key={s.href} href={s.href} rel="noreferrer" target="_blank">{s.label}</a>)}</p>
      </div>
    </footer>
  );
}
