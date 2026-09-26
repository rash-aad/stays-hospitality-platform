'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type Quote = { nights: { date: string; price: number }[]; roomSubtotal: number; addOns: { id: string; name: string; amount: number }[]; discount: number; taxes: { name: string; amount: number }[]; subtotal: number; taxTotal: number; total: number; couponApplied: string | null; couponError: string | null };
type Rate = { ratePlanId: string; name: string; description?: string | null; mealPlan?: string; refundable?: boolean; cancellationPolicy?: { label: string }; quote?: Quote; unavailableReason?: string };
type Result = { roomType: { id: string; name: string; description: string | null; images: { url: string; alt: string }[]; amenities: string[]; bedConfig: string | null; sizeSqm: number | null; view: string | null; maxOccupancy: number }; available: boolean; unitsLeft: number | null; fitsParty: boolean; minStay: number | null; rates: Rate[] };
type Search = { property: { name: string; checkInTime: string; checkOutTime: string }; results: Result[]; addOns: { id: string; name: string; description: string | null; price: number; per: string }[]; paymentMethods: string[] };

const inr = (m: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: m % 100 ? 2 : 0 }).format(m / 100);
const fmt = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const today = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); };
const MEAL: Record<string, string> = { room_only: 'Room only', breakfast: 'Breakfast included', half_board: 'Breakfast & dinner', full_board: 'All meals', all_inclusive: 'All inclusive' };
const PAY: Record<string, { title: string; body: string }> = {
  upi_manual: { title: 'Pay now by UPI', body: 'Scan or tap to pay our UPI ID, then enter the transaction reference. We confirm as soon as we see it.' },
  upi_gateway: { title: 'Pay now — UPI checkout', body: 'Instant confirmation through our secure payment partner.' },
  pay_at_property: { title: 'Pay at the hotel', body: 'Nothing to pay now. Settle your bill when you stay.' },
};

export function BookingFlow({ propertyName }: { propertyName: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState({ checkIn: sp.get('checkIn') ?? today(1), checkOut: sp.get('checkOut') ?? today(3), adults: sp.get('adults') ?? '2', children: sp.get('children') ?? '0' });
  const [search, setSearch] = useState<Search | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<{ r: Result; rate: Rate } | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [g, setG] = useState({ firstName: '', lastName: '', email: '', phone: '', specialRequests: '', arrivalTime: '' });
  const [pay, setPay] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())));
  const focusRoom = sp.get('roomType');

  async function run() {
    setErr(null); setPick(null); setLoading(true);
    if (q.checkOut <= q.checkIn) { setErr('Your departure date must be after your arrival date.'); setLoading(false); return; }
    const r = await fetch(`/api/v1/public/stay-search?${new URLSearchParams(q)}`);
    const j = await r.json();
    setLoading(false);
    if (!r.ok) { setSearch(null); setErr(j.error?.message ?? 'Search failed'); return; }
    setSearch(j.data);
    setPay(j.data.paymentMethods[0] ?? 'pay_at_property');
  }
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pick) return setQuote(null);
    const t = setTimeout(async () => {
      const r = await fetch('/api/v1/public/booking/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomTypeId: pick.r.roomType.id, ratePlanId: pick.rate.ratePlanId, checkIn: q.checkIn, checkOut: q.checkOut, adults: Number(q.adults), children: Number(q.children), couponCode: coupon || null, addOnIds: extras }) });
      const j = await r.json();
      if (r.ok) setQuote(j.data.quote);
    }, 250);
    return () => clearTimeout(t);
  }, [pick, extras, coupon, q]);

  const results = useMemo(() => (search?.results ?? []).slice().sort((a, b) => Number(b.roomType.id === focusRoom) - Number(a.roomType.id === focusRoom) || Number(b.available) - Number(a.available)), [search, focusRoom]);
  const nights = Math.round((Date.parse(q.checkOut) - Date.parse(q.checkIn)) / 86400000);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!pick) return;
    setBusy(true); setErr(null);
    const r = await fetch('/api/v1/public/bookings', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ roomTypeId: pick.r.roomType.id, ratePlanId: pick.rate.ratePlanId, checkIn: q.checkIn, checkOut: q.checkOut, adults: Number(q.adults), children: Number(q.children), couponCode: coupon || null, addOnIds: extras, paymentMethod: pay, guest: { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone }, specialRequests: g.specialRequests || undefined, arrivalTime: g.arrivalTime || undefined }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? 'We couldn’t complete the booking'); if (r.status === 409) void run(); return; }
    router.push(`/book/pay/${j.data.id}?token=${encodeURIComponent(j.data.payToken)}`);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div>
        <h1 className="display text-4xl md:text-5xl">Book your stay</h1>
        <form className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_100px_100px_auto]" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <label><span className="t-label">Arrive</span><input className="t-input" type="date" min={today()} value={q.checkIn} onChange={(e) => setQ({ ...q, checkIn: e.target.value, checkOut: e.target.value >= q.checkOut ? (() => { const d = new Date(`${e.target.value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })() : q.checkOut })} required /></label>
          <label><span className="t-label">Depart</span><input className="t-input" type="date" min={q.checkIn} value={q.checkOut} onChange={(e) => setQ({ ...q, checkOut: e.target.value })} required /></label>
          <label><span className="t-label">Adults</span><input className="t-input" type="number" min={1} max={12} value={q.adults} onChange={(e) => setQ({ ...q, adults: e.target.value })} required /></label>
          <label><span className="t-label">Children</span><input className="t-input" type="number" min={0} max={8} value={q.children} onChange={(e) => setQ({ ...q, children: e.target.value })} /></label>
          <button className="t-btn col-span-2 self-end md:col-span-1">Search</button>
        </form>
        {err && <p role="alert" className="mt-4 border-l-2 border-red-700 pl-3 text-sm text-red-800">{err}</p>}
        {loading && <p className="t-muted mt-8">Checking availability…</p>}
        {search && !loading && (
          <div className="mt-8 space-y-6" data-testid="results">
            <p className="text-sm t-muted">{fmt(q.checkIn)} – {fmt(q.checkOut)} · {nights} night{nights > 1 ? 's' : ''} · {q.adults} adult{Number(q.adults) > 1 ? 's' : ''}{Number(q.children) ? `, ${q.children} children` : ''}</p>
            {results.every((r) => !r.available) && <p className="display text-2xl">Nothing is free for those dates — try moving them a day or two.</p>}
            {results.map((r) => (
              <article key={r.roomType.id} className={`grid gap-5 border-t t-line pt-6 md:grid-cols-[220px_1fr] ${r.available ? '' : 'opacity-50'}`}>
                {r.roomType.images[0] ? <img src={r.roomType.images[0].url} alt={r.roomType.images[0].alt} className="aspect-[4/3] w-full object-cover" /> : <div className="t-surface aspect-[4/3]" />}
                <div>
                  <h2 className="display text-2xl">{r.roomType.name}</h2>
                  <p className="mt-1 text-sm t-muted">{[r.roomType.sizeSqm && `${r.roomType.sizeSqm} m²`, r.roomType.bedConfig, r.roomType.view, `sleeps ${r.roomType.maxOccupancy}`].filter(Boolean).join(' · ')}</p>
                  {r.unitsLeft ? <p className="mt-2 inline-block text-sm font-medium" style={{ color: 'var(--t-accent)' }} data-testid="units-left">Only {r.unitsLeft} {r.unitsLeft === 1 ? 'room' : 'rooms'} left for your dates</p> : null}
                  {!r.fitsParty && <p className="mt-2 text-sm">Too small for your party.</p>}
                  {r.fitsParty && !r.available && <p className="mt-2 text-sm">{r.minStay ? `Minimum stay ${r.minStay} nights on these dates.` : 'Sold out for these dates.'}</p>}
                  <ul className="mt-4 divide-y t-line border-y t-line">
                    {r.rates.filter((x) => x.quote).map((rate) => {
                      const selected = pick?.rate.ratePlanId === rate.ratePlanId;
                      return (
                        <li key={rate.ratePlanId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="font-medium">{rate.name}</p>
                            <p className="text-xs t-muted">{MEAL[rate.mealPlan ?? 'room_only']} · {rate.cancellationPolicy?.label}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <p className="text-right"><span className="block tabular-nums">{inr(rate.quote!.total)}</span><span className="block text-xs t-muted">incl. taxes · {inr(Math.round(rate.quote!.total / nights))}/night</span></p>
                            <button type="button" className={`t-btn h-10 px-4 ${selected ? '' : 't-btn-outline'}`} onClick={() => { setPick({ r, rate }); setTimeout(() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth' }), 50); }} aria-pressed={selected}>{selected ? 'Selected' : 'Select'}</button>
                          </div>
                        </li>
                      );
                    })}
                    {r.rates.filter((x) => x.unavailableReason).map((rate) => <li key={rate.ratePlanId} className="py-3 text-sm t-muted">{rate.name} — {rate.unavailableReason}</li>)}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        )}
        {pick && search && (
          <form id="details" onSubmit={book} className="mt-12 space-y-10 border-t t-line pt-10">
            {search.addOns.length > 0 && (
              <fieldset>
                <legend className="display mb-4 text-2xl">Add to your stay</legend>
                <div className="divide-y t-line border-y t-line">
                  {search.addOns.map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center justify-between gap-4 py-3">
                      <span className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={extras.includes(a.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, a.id] : extras.filter((x) => x !== a.id))} /><span><span className="block">{a.name}</span>{a.description && <span className="block text-sm t-muted">{a.description}</span>}</span></span>
                      <span className="shrink-0 tabular-nums">{inr(a.price)}{a.per !== 'stay' && <span className="text-xs t-muted"> /{a.per.replace('_', ' ')}</span>}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="display mb-4 text-2xl">Your details</legend>
              <label><span className="t-label">First name</span><input className="t-input" required autoComplete="given-name" name="firstName" value={g.firstName} onChange={(e) => setG({ ...g, firstName: e.target.value })} /></label>
              <label><span className="t-label">Last name</span><input className="t-input" required autoComplete="family-name" name="lastName" value={g.lastName} onChange={(e) => setG({ ...g, lastName: e.target.value })} /></label>
              <label><span className="t-label">Email</span><input className="t-input" type="email" required autoComplete="email" name="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></label>
              <label><span className="t-label">Mobile</span><input className="t-input" type="tel" required minLength={6} autoComplete="tel" name="phone" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></label>
              <label><span className="t-label">Expected arrival time</span><input className="t-input" name="arrivalTime" placeholder="Around 3 pm" value={g.arrivalTime} onChange={(e) => setG({ ...g, arrivalTime: e.target.value })} /></label>
              <label><span className="t-label">Promo code</span><input className="t-input uppercase" name="coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.trim())} /></label>
              {quote?.couponError && coupon && <p className="text-sm text-red-800 md:col-span-2">{quote.couponError}</p>}
              <label className="md:col-span-2"><span className="t-label">Anything we should know?</span><textarea className="t-input" rows={3} name="specialRequests" value={g.specialRequests} onChange={(e) => setG({ ...g, specialRequests: e.target.value })} /></label>
            </fieldset>
            <fieldset>
              <legend className="display mb-4 text-2xl">Payment</legend>
              <div className="divide-y t-line border-y t-line">
                {search.paymentMethods.map((m) => (
                  <label key={m} className="flex cursor-pointer items-start gap-3 py-4">
                    <input type="radio" name="pay" className="mt-1.5" value={m} checked={pay === m} onChange={() => setPay(m)} />
                    <span><span className="block font-medium">{PAY[m]?.title ?? m}</span><span className="block text-sm t-muted">{PAY[m]?.body}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="t-btn t-btn-accent w-full md:w-auto" disabled={busy || !quote || (!!coupon && !!quote.couponError)}>{busy ? 'Reserving…' : pay === 'pay_at_property' ? `Confirm booking · ${quote ? inr(quote.total) : ''}` : `Continue to payment · ${quote ? inr(quote.total) : ''}`}</button>
            <p className="text-xs t-muted">By booking you agree to the rate’s cancellation policy: {pick.rate.cancellationPolicy?.label}.</p>
          </form>
        )}
      </div>
      <aside className="lg:sticky lg:top-8 lg:self-start">
        <div className="t-surface p-6" data-testid="summary">
          <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Your stay at {propertyName}</p>
          {!pick ? <p className="mt-4 text-sm t-muted">Choose a room and rate to see your total.</p> : (
            <>
              <p className="display mt-3 text-2xl">{pick.r.roomType.name}</p>
              <p className="text-sm t-muted">{pick.rate.name}</p>
              <p className="mt-3 text-sm">{fmt(q.checkIn)} → {fmt(q.checkOut)}</p>
              {quote && (
                <dl className="mt-5 space-y-1.5 border-t t-line pt-4 text-sm">
                  <div className="flex justify-between"><dt>{nights} night{nights > 1 ? 's' : ''}</dt><dd className="tabular-nums">{inr(quote.roomSubtotal)}</dd></div>
                  {quote.addOns.map((a) => <div key={a.id} className="flex justify-between"><dt>{a.name}</dt><dd className="tabular-nums">{inr(a.amount)}</dd></div>)}
                  {quote.discount > 0 && <div className="flex justify-between"><dt>Promo {quote.couponApplied}</dt><dd className="tabular-nums">−{inr(quote.discount)}</dd></div>}
                  {quote.taxes.map((t) => <div key={t.name} className="flex justify-between t-muted"><dt>{t.name}</dt><dd className="tabular-nums">{inr(t.amount)}</dd></div>)}
                  <div className="flex justify-between border-t t-line pt-3 text-base font-medium"><dt>Total</dt><dd className="tabular-nums" data-testid="total">{inr(quote.total)}</dd></div>
                </dl>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
