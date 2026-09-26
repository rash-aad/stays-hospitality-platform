'use client';

import type { PageSection } from '@hp/contracts';
import { SECTION_MODULES } from '@hp/contracts';
import { Fragment, useState, type ReactNode } from 'react';
import { T, useEdit } from './edit';
import type { SiteData } from './types';
import { BookingBar, ContactForm, ReservationWidget, useHydrated } from './widgets';

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Img = { url: string; alt: string };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const inr = (m: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(m / 100);

function Photo({ img, className, treat, eager }: { img?: Img | null; className?: string; treat?: string; eager?: boolean }) {
  if (!img?.url) return <div className={`t-surface ${className ?? ''}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={img.url} alt={img.alt ?? ''} loading={eager ? 'eager' : 'lazy'} decoding="async" className={`${className ?? ''} treat-${treat ?? 'natural'} object-cover`} />;
}

const pad = 'px-5 sm:px-8 lg:px-14';
const vpad = 'py-[calc(4.5rem*var(--t-gap))] md:py-[calc(7rem*var(--t-gap))]';
function Wrap({ children, tone, id, className }: { children: ReactNode; tone?: string; id?: string; className?: string }) {
  const cls = tone === 'muted' ? 't-surface' : tone === 'inverse' ? 't-inverse' : tone === 'accent' ? 't-accent' : '';
  return <section id={id} className={`${cls} ${vpad} ${pad} ${className ?? ''}`}><div className="mx-auto max-w-[1240px]">{children}</div></section>;
}
function Eyebrow({ sid, value, path = 'eyebrow' }: { sid: string; value?: string; path?: string }) {
  const { editing } = useEdit();
  if (!value && !editing) return null;
  return <T sid={sid} path={path} value={value} as="p" className="mb-4 text-[12px] tracking-[0.16em] uppercase t-muted" placeholder="Eyebrow" />;
}
function Cta({ cta, variant = '' }: { cta?: { label: string; href: string }; variant?: string }) {
  const { editing } = useEdit();
  if (!cta?.label) return null;
  return <a href={editing ? undefined : cta.href} className={`t-btn ${variant}`}>{cta.label}</a>;
}

function Hero({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const { editing } = useEdit();
  const treat = d.site.theme?.tokens.imageTreatment;
  if (p.layout === 'minimal') {
    return (
      <section className={`${pad} pt-[calc(5rem*var(--t-gap))] pb-[calc(2.5rem*var(--t-gap))]`}>
        <div className="mx-auto max-w-[1240px]">
          <Eyebrow sid={s.id} value={p.eyebrow} />
          <T sid={s.id} path="heading" value={p.heading} as="h1" className="display block max-w-4xl text-[clamp(2.6rem,6vw,5rem)]" />
          <T sid={s.id} path="subheading" value={p.subheading} as="p" className="mt-5 block max-w-2xl text-lg t-muted" />
        </div>
      </section>
    );
  }
  if (p.layout === 'split') {
    return (
      <section className="grid min-h-[78vh] md:grid-cols-2">
        <div className={`flex flex-col justify-end ${pad} py-14`}>
          <Eyebrow sid={s.id} value={p.eyebrow} />
          <T sid={s.id} path="heading" value={p.heading} as="h1" className="display block text-[clamp(2.6rem,5.2vw,4.8rem)]" />
          <T sid={s.id} path="subheading" value={p.subheading} as="p" className="mt-5 block max-w-lg text-lg t-muted" />
          <div className="mt-8 flex flex-wrap gap-3"><Cta cta={p.primaryCta} /><Cta cta={p.secondaryCta} variant="t-btn-outline" /></div>
          {p.showBookingBar && d.site.tenant.modules.includes('room_booking') && <div className="mt-10"><BookingBar /></div>}
        </div>
        <Photo img={p.image} treat={treat} eager className="h-[48vh] w-full md:h-full" />
      </section>
    );
  }
  return (
    <section className="relative flex min-h-[92svh] flex-col justify-end overflow-hidden text-white">
      <Photo img={p.image} treat={treat} eager className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0" style={{ background: `linear-gradient(to top, rgba(0,0,0,${Math.min(0.85, (p.overlay ?? 0.3) + 0.35)}) 0%, rgba(0,0,0,${p.overlay ?? 0.3}) 45%, rgba(0,0,0,.12) 100%)` }} />
      <div className={`relative ${pad} pb-[calc(3.5rem*var(--t-gap))] pt-40`}>
        <div className="mx-auto max-w-[1240px]">
          {(p.eyebrow || editing) && <T sid={s.id} path="eyebrow" value={p.eyebrow} as="p" className="mb-5 block text-[12px] tracking-[0.18em] text-white/80 uppercase" />}
          <T sid={s.id} path="heading" value={p.heading} as="h1" className="display block max-w-5xl text-[clamp(2.8rem,7vw,6.2rem)]" />
          <T sid={s.id} path="subheading" value={p.subheading} as="p" className="mt-6 block max-w-2xl text-lg text-white/85 md:text-xl" />
          {(p.primaryCta || p.secondaryCta) && !p.showBookingBar && <div className="mt-8 flex flex-wrap gap-3"><Cta cta={p.primaryCta} variant="t-btn-accent" /><Cta cta={p.secondaryCta} variant="t-btn-outline" /></div>}
          {p.showBookingBar && d.site.tenant.modules.includes('room_booking') && <div className="mt-10 max-w-5xl"><BookingBar inverse /></div>}
        </div>
      </div>
    </section>
  );
}

function Intro({ s }: { s: PageSection }) {
  const p = s.props as P;
  const { editing } = useEdit();
  return (
    <Wrap tone={p.tone}>
      <div className={p.align === 'center' ? 'mx-auto max-w-3xl text-center' : 'grid gap-8 md:grid-cols-[1fr_1.4fr] md:gap-16'}>
        <div>
          <Eyebrow sid={s.id} value={p.eyebrow} />
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.4rem)]" />
        </div>
        <div className="md:pt-9">
          <T sid={s.id} path="body" value={p.body} as="p" className="block text-lg leading-relaxed whitespace-pre-line md:text-xl" />
          {(p.signature || editing) && <T sid={s.id} path="signature" value={p.signature} as="p" className="mt-6 block italic t-muted" placeholder="Signature" />}
        </div>
      </div>
    </Wrap>
  );
}

function Rooms({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const { editing } = useEdit();
  const list = (p.roomTypeIds?.length ? d.roomTypes.filter((r) => p.roomTypeIds.includes(r.id)) : d.roomTypes);
  const treat = d.site.theme?.tokens.imageTreatment;
  return (
    <Wrap>
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.4rem)]" />
          <T sid={s.id} path="intro" value={p.intro} as="p" className="mt-4 block text-lg t-muted" />
        </div>
        <Cta cta={p.cta} variant="t-btn-outline" />
      </div>
      {list.length === 0 && editing && <p className="t-muted">Your room types appear here automatically.</p>}
      {p.layout === 'grid' ? (
        <div className="grid gap-x-8 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
          {list.map((r) => (
            <a key={r.id} href={editing ? undefined : `/book?roomType=${r.id}`} className="group block">
              <Photo img={r.images[0]} treat={treat} className="aspect-[4/5] w-full" />
              <p className="display mt-5 text-2xl">{r.name}</p>
              <p className="mt-1 text-sm t-muted">{[r.sizeSqm && `${r.sizeSqm} m²`, r.bedConfig, `sleeps ${r.maxOccupancy}`].filter(Boolean).join(' · ')}</p>
              {r.fromPrice && <p className="mt-2 text-sm">From {inr(r.fromPrice)} a night</p>}
            </a>
          ))}
        </div>
      ) : (
        <div className="space-y-[calc(4rem*var(--t-gap))]">
          {list.map((r, i) => (
            <article key={r.id} className={`grid items-center gap-8 md:grid-cols-12 md:gap-12 ${i % 2 ? '' : ''}`}>
              <Photo img={r.images[0]} treat={treat} className={`aspect-[3/2] w-full md:col-span-7 ${i % 2 ? 'md:order-2' : ''}`} />
              <div className={`md:col-span-5 ${i % 2 ? 'md:order-1' : ''}`}>
                <p className="text-[12px] tracking-[0.16em] uppercase t-muted">{r.view ?? `Sleeps ${r.maxOccupancy}`}</p>
                <h3 className="display mt-3 text-[clamp(1.8rem,3vw,2.6rem)]">{r.name}</h3>
                {r.description && <p className="mt-4 leading-relaxed t-muted">{r.description}</p>}
                <dl className="mt-6 grid grid-cols-3 border-t t-line pt-4 text-sm">
                  <div><dt className="t-muted text-xs">Size</dt><dd>{r.sizeSqm ? `${r.sizeSqm} m²` : '—'}</dd></div>
                  <div><dt className="t-muted text-xs">Bed</dt><dd>{r.bedConfig ?? '—'}</dd></div>
                  <div><dt className="t-muted text-xs">From</dt><dd>{r.fromPrice ? inr(r.fromPrice) : '—'}</dd></div>
                </dl>
                <a href={editing ? undefined : `/book?roomType=${r.id}`} className="t-btn mt-7">Check dates</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </Wrap>
  );
}

function Offers({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const list = d.offers.slice(0, p.limit ?? 3);
  const { editing } = useEdit();
  if (!list.length && !editing) return null;
  return (
    <Wrap tone="muted" id="offers">
      <T sid={s.id} path="heading" value={p.heading} as="h2" className="display mb-10 block text-[clamp(2rem,4vw,3.2rem)]" />
      <div className="divide-y t-line border-y t-line">
        {list.map((o) => (
          <article key={o.id} className="grid gap-6 py-8 md:grid-cols-[220px_1fr_auto] md:items-center">
            <Photo img={o.image} treat={d.site.theme?.tokens.imageTreatment} className="aspect-[4/3] w-full md:w-[220px]" />
            <div><h3 className="display text-2xl">{o.title}</h3>{o.summary && <p className="mt-2 max-w-xl t-muted">{o.summary}</p>}</div>
            <a href={editing ? undefined : '/book'} className="t-btn t-btn-outline">Book this offer</a>
          </article>
        ))}
        {!list.length && <p className="py-8 t-muted">Active offers appear here.</p>}
      </div>
    </Wrap>
  );
}

function BookingSearch({ s }: { s: PageSection }) {
  const p = s.props as P;
  return (
    <Wrap tone={p.tone}>
      <T sid={s.id} path="heading" value={p.heading} as="h2" className="display mb-6 block text-[clamp(1.8rem,3vw,2.6rem)]" />
      <BookingBar />
      <T sid={s.id} path="note" value={p.note} as="p" className="mt-4 block text-sm t-muted" />
    </Wrap>
  );
}

function Hours({ hours }: { hours: SiteData['restaurants'][number]['hours'] }) {
  const services = [...new Set(hours.map((h) => h.service))];
  return (
    <dl className="mt-5 text-sm">
      {services.map((sv) => {
        const hs = hours.filter((h) => h.service === sv);
        const days = hs.length === 7 ? 'Daily' : hs.map((h) => DAYS[h.dayOfWeek]).join(', ');
        return <div key={sv} className="flex justify-between gap-4 border-b t-line py-2"><dt>{sv} <span className="t-muted">· {days}</span></dt><dd className="tabular-nums">{hs[0]!.opens.slice(0, 5)}–{hs[0]!.closes.slice(0, 5)}</dd></div>;
      })}
    </dl>
  );
}

function Restaurant({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const list = p.restaurantIds?.length ? d.restaurants.filter((r) => p.restaurantIds.includes(r.id)) : d.restaurants;
  const treat = d.site.theme?.tokens.imageTreatment;
  const { editing } = useEdit();
  return (
    <Wrap>
      <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:gap-16">
        <div>
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.4rem)]" />
          <T sid={s.id} path="intro" value={p.intro} as="p" className="mt-5 block text-lg leading-relaxed t-muted" />
          {p.image && <Photo img={p.image} treat={treat} className="mt-10 hidden aspect-[4/5] w-full md:block" />}
        </div>
        <div className="divide-y t-line border-t t-line">
          {list.map((r) => (
            <article key={r.id} className="py-8">
              <p className="text-[12px] tracking-[0.16em] uppercase t-muted">{r.cuisine}{r.location && ` · ${r.location}`}</p>
              <h3 className="display mt-2 text-3xl">{r.name}</h3>
              {r.description && <p className="mt-3 leading-relaxed t-muted">{r.description}</p>}
              {p.showHours && r.hours.length > 0 && <Hours hours={r.hours} />}
              {r.acceptsReservations && <a href={editing ? undefined : '/dining#reserve'} className="t-btn t-btn-outline mt-6">Reserve a table</a>}
            </article>
          ))}
          {!list.length && <p className="py-8 t-muted">Your restaurants appear here automatically.</p>}
        </div>
      </div>
    </Wrap>
  );
}

function Reserve({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  return (
    <Wrap tone={p.tone} id="reserve">
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
        <div>
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.2rem)]" />
          <T sid={s.id} path="intro" value={p.intro} as="p" className="mt-4 block t-muted" />
        </div>
        <ReservationWidget restaurants={d.restaurants} restaurantId={p.restaurantId} />
      </div>
    </Wrap>
  );
}

const DIET: Record<string, string> = { veg: 'V', vegan: 'VG', gluten_free: 'GF', jain: 'J', egg: 'E', dairy_free: 'DF' };
function Menu({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const rid = p.restaurantId ?? d.restaurants.find((r) => d.menus[r.id]?.length)?.id;
  const menu = rid ? d.menus[rid]?.[0] : undefined;
  const [cat, setCat] = useState(0);
  const ready = useHydrated();
  if (!menu) return <Wrap><T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-4xl" /><p className="mt-4 t-muted">The menu appears here once it is set up.</p></Wrap>;
  const c = menu.categories[cat];
  return (
    <Wrap tone="muted">
      <T sid={s.id} path="heading" value={p.heading} as="h2" className="display mb-8 block text-[clamp(2rem,4vw,3.2rem)]" />
      <nav className="mb-8 flex gap-6 overflow-x-auto border-b t-line text-sm">
        {menu.categories.map((x, i) => <button key={x.id} disabled={!ready} onClick={() => setCat(i)} className="-mb-px whitespace-nowrap border-b-2 pb-3" style={{ borderColor: i === cat ? 'var(--t-ink)' : 'transparent', opacity: i === cat ? 1 : 0.6 }}>{x.name}</button>)}
      </nav>
      <ul className="grid gap-x-16 md:grid-cols-2">
        {c?.items.map((i) => (
          <li key={i.id} className={`border-b t-line py-5 ${i.available ? '' : 'opacity-50'}`}>
            <p className="flex items-baseline justify-between gap-4">
              <span className="display text-xl">{i.name}{p.showDietary && i.dietary.filter((x) => DIET[x]).map((x) => <span key={x} className="ml-2 align-middle font-sans text-[10px] tracking-wide t-muted">{DIET[x]}</span>)}</span>
              {p.showPrices && <span className="shrink-0 tabular-nums">{inr(i.price)}</span>}
            </p>
            {i.description && <p className="mt-1 text-sm t-muted">{i.description}</p>}
            {p.showDietary && i.allergens.length > 0 && <p className="mt-1 text-xs t-muted">Contains {i.allergens.join(', ').replace(/_/g, ' ')}</p>}
          </li>
        ))}
      </ul>
      {p.showDietary && <p className="mt-6 text-xs t-muted">V vegetarian · VG vegan · GF gluten-free · J Jain · Please tell us about allergies when ordering.</p>}
    </Wrap>
  );
}

function Experiences({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const list = d.experiences.filter((e) => !p.kinds?.length || p.kinds.includes(e.kind)).slice(0, p.limit ?? 6);
  const treat = d.site.theme?.tokens.imageTreatment;
  const { editing } = useEdit();
  return (
    <Wrap>
      <div className="mb-12 max-w-2xl">
        <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.4rem)]" />
        <T sid={s.id} path="intro" value={p.intro} as="p" className="mt-4 block text-lg t-muted" />
      </div>
      <div className="grid gap-x-8 gap-y-12 md:grid-cols-3">
        {list.map((e, i) => (
          <article key={e.id} className={i === 0 && list.length % 3 !== 0 ? 'md:col-span-2' : ''}>
            <Photo img={e.images[0]} treat={treat} className={`w-full ${i === 0 && list.length % 3 !== 0 ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} />
            <p className="mt-4 text-[12px] tracking-[0.16em] uppercase t-muted">{Math.round(e.durationMinutes / 60 * 10) / 10 >= 1 ? `${Math.round(e.durationMinutes / 6) / 10} hours` : `${e.durationMinutes} min`}{e.price ? ` · ${inr(e.price)}${e.pricePer === 'person' ? ' pp' : ''}` : ''}</p>
            <h3 className="display mt-2 text-2xl">{e.name}</h3>
            {e.summary && <p className="mt-2 t-muted">{e.summary}</p>}
          </article>
        ))}
        {!list.length && editing && <p className="t-muted">Your experiences appear here automatically.</p>}
      </div>
    </Wrap>
  );
}

function Amenities({ s }: { s: PageSection }) {
  const p = s.props as P;
  const { update } = useEdit();
  return (
    <Wrap tone={p.tone}>
      <T sid={s.id} path="heading" value={p.heading} as="h2" className="display mb-10 block text-[clamp(1.8rem,3.4vw,2.8rem)]" />
      <dl className={`grid gap-x-10 border-t t-line sm:grid-cols-2 ${p.columns === 4 ? 'lg:grid-cols-4' : p.columns === 2 ? '' : 'lg:grid-cols-3'}`}>
        {(p.items as { title: string; detail?: string }[]).map((it, i) => (
          <div key={i} className="border-b t-line py-5">
            <T sid={s.id} path={`items.${i}.title`} value={it.title} as="dt" className="block font-medium" />
            <T sid={s.id} path={`items.${i}.detail`} value={it.detail} as="dd" className="mt-1 block text-sm t-muted" />
          </div>
        ))}
      </dl>
      {void update}
    </Wrap>
  );
}

function Gallery({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const { editing } = useEdit();
  const imgs = p.images as Img[];
  const treat = d.site.theme?.tokens.imageTreatment;
  return (
    <section className={`${vpad}`}>
      {(p.heading || editing) && <div className={`${pad} mx-auto mb-10 max-w-[1240px]`}><T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(1.8rem,3.4vw,2.8rem)]" /></div>}
      {p.layout === 'strip' ? (
        <div className="flex snap-x gap-3 overflow-x-auto px-5 sm:px-8 lg:px-14">{imgs.map((im, i) => <Photo key={i} img={im} treat={treat} className="h-[52vh] w-[78vw] shrink-0 snap-start sm:w-[42vw]" />)}</div>
      ) : (
        <div className={`${pad} mx-auto grid max-w-[1400px] grid-cols-2 gap-3 md:grid-cols-4 md:grid-rows-2`}>
          {imgs.slice(0, 5).map((im, i) => <Photo key={i} img={im} treat={treat} className={`h-full w-full ${i === 0 ? 'col-span-2 row-span-2 aspect-square md:aspect-auto' : 'aspect-[4/3]'}`} />)}
        </div>
      )}
    </section>
  );
}

function ImageText({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  return (
    <section className={p.tone === 'muted' ? 't-surface' : p.tone === 'inverse' ? 't-inverse' : ''}>
      <div className="grid md:grid-cols-2">
        <Photo img={p.image} treat={d.site.theme?.tokens.imageTreatment} className={`aspect-[4/3] w-full md:aspect-auto md:min-h-[640px] ${p.imageSide === 'right' ? 'md:order-2' : ''}`} />
        <div className={`flex flex-col justify-center ${pad} ${vpad}`}>
          <div className="max-w-xl">
            <Eyebrow sid={s.id} value={p.eyebrow} />
            <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,3.6vw,3.2rem)]" />
            <T sid={s.id} path="body" value={p.body} as="p" className="mt-6 block text-lg leading-relaxed whitespace-pre-line opacity-85" />
            {p.cta && <div className="mt-8"><Cta cta={p.cta} variant="t-btn-outline" /></div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Testimonials({ s }: { s: PageSection }) {
  const p = s.props as P;
  const { editing } = useEdit();
  const items = p.items as { quote: string; author: string; detail?: string }[];
  return (
    <Wrap>
      {(p.heading || editing) && <T sid={s.id} path="heading" value={p.heading} as="p" className="mb-10 block text-[12px] tracking-[0.16em] uppercase t-muted" />}
      <div className="grid gap-14 md:grid-cols-2">
        {items.map((t, i) => (
          <figure key={i} className="border-l t-line pl-6">
            <blockquote><T sid={s.id} path={`items.${i}.quote`} value={t.quote} as="p" className="display block text-[clamp(1.4rem,2.4vw,2rem)] leading-snug" /></blockquote>
            <figcaption className="mt-5 text-sm"><T sid={s.id} path={`items.${i}.author`} value={t.author} /> {t.detail && <span className="t-muted">· <T sid={s.id} path={`items.${i}.detail`} value={t.detail} /></span>}</figcaption>
          </figure>
        ))}
      </div>
    </Wrap>
  );
}

function Faq({ s }: { s: PageSection }) {
  const p = s.props as P;
  const { editing } = useEdit();
  return (
    <Wrap>
      <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(1.8rem,3.4vw,2.8rem)]" />
        <div className="border-t t-line">
          {(p.items as { q: string; a: string }[]).map((it, i) => (
            <details key={i} className="group border-b t-line py-5" open={editing}>
              <summary className="flex cursor-pointer list-none justify-between gap-6 text-lg"><T sid={s.id} path={`items.${i}.q`} value={it.q} /><span className="t-muted transition-transform group-open:rotate-45">+</span></summary>
              <T sid={s.id} path={`items.${i}.a`} value={it.a} as="p" className="mt-3 block leading-relaxed t-muted" />
            </details>
          ))}
        </div>
      </div>
    </Wrap>
  );
}

function Location({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  const pr = d.site.property;
  const addr = p.address ?? [pr?.addressLine, pr?.city, pr?.region, pr?.postalCode].filter(Boolean).join(', ');
  const lat = pr?.latitude; const lng = pr?.longitude;
  return (
    <Wrap tone="muted">
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(1.8rem,3.4vw,2.8rem)]" />
          <T sid={s.id} path="body" value={p.body} as="p" className="mt-5 block text-lg leading-relaxed t-muted" />
          {addr && <p className="mt-6">{addr}</p>}
          {pr?.phone && <p className="mt-1"><a className="t-link" href={`tel:${pr.phone}`}>{pr.phone}</a></p>}
          <dl className="mt-8 border-t t-line">
            {(p.directions as { from: string; detail: string }[]).map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.2fr] gap-4 border-b t-line py-3 text-sm"><T sid={s.id} path={`directions.${i}.from`} value={x.from} as="dt" /><T sid={s.id} path={`directions.${i}.detail`} value={x.detail} as="dd" className="t-muted" /></div>
            ))}
          </dl>
        </div>
        {p.showMap && lat != null && lng != null && (
          <iframe title="Map" className="aspect-square w-full border t-line md:aspect-auto md:h-full" loading="lazy" referrerPolicy="no-referrer"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.02}%2C${lat - 0.012}%2C${lng + 0.02}%2C${lat + 0.012}&layer=mapnik&marker=${lat}%2C${lng}`} />
        )}
      </div>
    </Wrap>
  );
}

function CtaBlock({ s, d }: { s: PageSection; d: SiteData }) {
  const p = s.props as P;
  if (p.image) {
    return (
      <section className="relative overflow-hidden text-white">
        <Photo img={p.image} treat={d.site.theme?.tokens.imageTreatment} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 bg-black/45" />
        <div className={`relative ${pad} py-[calc(8rem*var(--t-gap))] text-center`}>
          <T sid={s.id} path="heading" value={p.heading} as="h2" className="display mx-auto block max-w-3xl text-[clamp(2.2rem,5vw,4.2rem)]" />
          <T sid={s.id} path="body" value={p.body} as="p" className="mx-auto mt-5 block max-w-xl text-lg text-white/85" />
          <div className="mt-9 flex flex-wrap justify-center gap-3"><Cta cta={p.primary} variant="t-btn-accent" /><Cta cta={p.secondary} variant="t-btn-outline" /></div>
        </div>
      </section>
    );
  }
  return (
    <Wrap tone={p.tone}>
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-2xl"><T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.4rem)]" /><T sid={s.id} path="body" value={p.body} as="p" className="mt-4 block text-lg opacity-80" /></div>
        <div className="flex gap-3"><Cta cta={p.primary} variant="t-btn-accent" /><Cta cta={p.secondary} variant="t-btn-outline" /></div>
      </div>
    </Wrap>
  );
}

function Contact({ s }: { s: PageSection }) {
  const p = s.props as P;
  return (
    <Wrap>
      <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
        <div><T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(1.8rem,3.4vw,2.8rem)]" /><T sid={s.id} path="intro" value={p.intro} as="p" className="mt-4 block t-muted" /></div>
        <ContactForm topics={p.topics} />
      </div>
    </Wrap>
  );
}

function RichText({ s }: { s: PageSection }) {
  const p = s.props as P;
  return (
    <Wrap>
      <div className={`${p.width === 'wide' ? 'max-w-4xl' : 'max-w-2xl'} mx-auto space-y-5 text-lg leading-relaxed`}>
        {(p.blocks as { type: string; text?: string; items?: string[]; cite?: string }[]).map((b, i) => (
          <Fragment key={i}>
            {b.type === 'p' && <T sid={s.id} path={`blocks.${i}.text`} value={b.text} as="p" className="block whitespace-pre-line" />}
            {b.type === 'h2' && <T sid={s.id} path={`blocks.${i}.text`} value={b.text} as="h2" className="display block pt-6 text-3xl" />}
            {b.type === 'h3' && <T sid={s.id} path={`blocks.${i}.text`} value={b.text} as="h3" className="block pt-3 text-xl font-medium" />}
            {b.type === 'quote' && <blockquote className="display border-l-2 pl-6 text-2xl" style={{ borderColor: 'var(--t-accent)' }}><T sid={s.id} path={`blocks.${i}.text`} value={b.text} />{b.cite && <cite className="mt-2 block font-sans text-sm not-italic t-muted">— {b.cite}</cite>}</blockquote>}
            {b.type === 'list' && <ul className="list-disc space-y-1 pl-6">{b.items?.map((it, j) => <li key={j}><T sid={s.id} path={`blocks.${i}.items.${j}`} value={it} /></li>)}</ul>}
          </Fragment>
        ))}
      </div>
    </Wrap>
  );
}

function GuestServices({ s }: { s: PageSection }) {
  const p = s.props as P;
  return (
    <Wrap tone="inverse">
      <div className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div><T sid={s.id} path="heading" value={p.heading} as="h2" className="display block text-[clamp(2rem,4vw,3.2rem)]" /><T sid={s.id} path="intro" value={p.intro} as="p" className="mt-4 block max-w-xl text-lg opacity-80" /></div>
        <div className="md:text-right"><Cta cta={p.cta ?? { label: 'Open your stay', href: '/stay' }} variant="t-btn-accent" /></div>
      </div>
    </Wrap>
  );
}

const MAP: Record<string, (x: { s: PageSection; d: SiteData }) => ReactNode> = {
  hero: Hero, intro: Intro, rooms: Rooms, offers: Offers, booking_search: BookingSearch, restaurant: Restaurant, restaurant_reservation: Reserve,
  menu: Menu, experiences: Experiences, amenities: Amenities, gallery: Gallery, image_text: ImageText, testimonials: Testimonials, faq: Faq,
  location: Location, cta: CtaBlock, contact_form: Contact, rich_text: RichText, guest_services: GuestServices,
};

/** A section is shown only if the modules it depends on are enabled for the tenant. */
export function sectionEnabled(type: string, modules: string[]) {
  const req = SECTION_MODULES[type as keyof typeof SECTION_MODULES];
  return !req || req.every((m) => modules.includes(m));
}

export function Section({ s, d }: { s: PageSection; d: SiteData }) {
  const C = MAP[s.type];
  return C ? <C s={s} d={d} /> : null;
}

export function PageBody({ sections, d }: { sections: PageSection[]; d: SiteData }) {
  return <>{sections.filter((s) => !s.hidden && sectionEnabled(s.type, d.site.tenant.modules)).map((s) => <Section key={s.id} s={s} d={d} />)}</>;
}
