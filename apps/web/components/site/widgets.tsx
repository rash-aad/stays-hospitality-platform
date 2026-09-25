'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** False during SSR and until hydration: submit buttons stay disabled so early taps aren't lost. */
export function useHydrated() {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}
import { useEdit } from './edit';
import type { RestaurantCard } from './types';

const today = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); };

/** Date + guests bar that hands off to the booking flow. */
export function BookingBar({ inverse }: { inverse?: boolean }) {
  const { editing } = useEdit();
  const router = useRouter();
  const [f, setF] = useState({ checkIn: today(1), checkOut: today(3), adults: '2', children: '0' });
  const ready = useHydrated();
  return (
    <form
      className={`grid grid-cols-2 gap-px border md:grid-cols-[1fr_1fr_110px_110px_auto] ${inverse ? 'border-white/25 bg-white/25' : 't-line'}`}
      style={inverse ? undefined : { background: 'var(--t-line)' }}
      onSubmit={(e) => { e.preventDefault(); if (!editing) router.push(`/book?checkIn=${f.checkIn}&checkOut=${f.checkOut}&adults=${f.adults}&children=${f.children}`); }}
    >
      {([['checkIn', 'Arrive', 'date'], ['checkOut', 'Depart', 'date'], ['adults', 'Adults', 'number'], ['children', 'Children', 'number']] as const).map(([k, label, type]) => (
        <label key={k} className="block px-4 py-2.5" style={{ background: inverse ? 'rgba(0,0,0,.35)' : 'var(--t-bg)', backdropFilter: inverse ? 'blur(6px)' : undefined }}>
          <span className={`block text-[11px] tracking-wide uppercase ${inverse ? 'text-white/75' : 't-muted'}`}>{label}</span>
          <input className={`w-full bg-transparent text-[15px] outline-none ${inverse ? 'text-white [color-scheme:dark]' : ''}`} type={type} min={type === 'number' ? (k === 'adults' ? 1 : 0) : f.checkIn && k === 'checkOut' ? f.checkIn : today()} max={type === 'number' ? 12 : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required />
        </label>
      ))}
      <button className="t-btn t-btn-accent col-span-2 h-auto min-h-12 md:col-span-1" style={{ borderRadius: 0 }} disabled={!ready}>Check availability</button>
    </form>
  );
}

type Slot = { time: string; startsAt: string; service: string; available: boolean };

export function ReservationWidget({ restaurants, restaurantId }: { restaurants: RestaurantCard[]; restaurantId?: string }) {
  const { editing } = useEdit();
  const options = restaurants.filter((r) => r.acceptsReservations);
  const [rid, setRid] = useState(restaurantId ?? options[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [party, setParty] = useState(2);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [f, setF] = useState({ guestName: '', guestEmail: '', guestPhone: '', occasion: '', specialRequests: '' });
  const [done, setDone] = useState<{ reference: string; status: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = useHydrated();
  useEffect(() => {
    if (editing || !rid) return;
    setSlots(null); setPick(null);
    fetch(`/api/v1/public/restaurants/${rid}/slots?date=${date}&partySize=${party}`).then((r) => r.json()).then((j) => { setSlots(j.data?.slots ?? []); setClosed(j.data?.closedNote ?? null); }).catch(() => setSlots([]));
  }, [rid, date, party, editing]);
  if (!options.length) return <p className="t-muted">Reservations are not open online.</p>;
  if (done) return (
    <div className="border t-line p-6">
      <p className="display text-3xl">{done.status === 'waitlisted' ? 'You’re on the waitlist' : 'Your table is booked'}</p>
      <p className="t-muted mt-2">Reference {done.reference}. A confirmation is on its way to {f.guestEmail}.</p>
    </div>
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pick) return;
    setBusy(true); setErr(null);
    const r = await fetch(`/api/v1/public/restaurants/${rid}/reservations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startsAt: pick.startsAt, partySize: party, ...f, occasion: f.occasion || undefined, specialRequests: f.specialRequests || undefined }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error?.message ?? 'Could not book');
    setDone(j.data);
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {options.length > 1 && <label className="col-span-2 md:col-span-1"><span className="t-label">Restaurant</span><select className="t-input" value={rid} onChange={(e) => setRid(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
        <label><span className="t-label">Date</span><input className="t-input" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="t-label">Guests</span><select className="t-input" value={party} onChange={(e) => setParty(Number(e.target.value))}>{Array.from({ length: options.find((o) => o.id === rid)?.maxPartySize ?? 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>)}</select></label>
      </div>
      <div>
        <span className="t-label">Time</span>
        {editing ? <p className="t-muted text-sm">Available times appear here on the live site.</p> : !slots ? <p className="t-muted text-sm">Finding tables…</p> : slots.length === 0 ? <p className="t-muted text-sm">{closed ?? 'Nothing available'} — try another date.</p> : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <button type="button" key={s.startsAt} disabled={!s.available} onClick={() => setPick(s)}
                className="h-10 min-w-[4.5rem] border px-3 text-sm disabled:opacity-30"
                style={{ borderRadius: 'var(--t-radius)', borderColor: pick?.startsAt === s.startsAt ? 'var(--t-ink)' : 'var(--t-line)', background: pick?.startsAt === s.startsAt ? 'var(--t-ink)' : 'transparent', color: pick?.startsAt === s.startsAt ? 'var(--t-bg)' : undefined }}>
                {s.time}
              </button>
            ))}
          </div>
        )}
      </div>
      {pick && (
        <div className="grid gap-3 md:grid-cols-3">
          <label><span className="t-label">Name</span><input className="t-input" required value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} autoComplete="name" /></label>
          <label><span className="t-label">Email</span><input className="t-input" type="email" required value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} autoComplete="email" /></label>
          <label><span className="t-label">Phone</span><input className="t-input" type="tel" required value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} autoComplete="tel" /></label>
          <label className="md:col-span-3"><span className="t-label">Allergies, celebrations, anything we should know</span><input className="t-input" value={f.specialRequests} onChange={(e) => setF({ ...f, specialRequests: e.target.value })} /></label>
        </div>
      )}
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button className="t-btn" disabled={!ready || !pick || busy}>{busy ? 'Booking…' : pick ? `Book ${pick.time} for ${party}` : 'Choose a time'}</button>
    </form>
  );
}

export function ContactForm({ topics }: { topics: string[] }) {
  const { editing } = useEdit();
  const [f, setF] = useState({ name: '', email: '', phone: '', topic: topics[0] ?? 'General', message: '', website: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const ready = useHydrated();
  if (state === 'sent') return <p className="display text-3xl">Thank you — we’ll reply shortly.</p>;
  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); if (editing) return; setState('busy');
      const r = await fetch('/api/v1/public/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, website: f.website || undefined }) });
      setState(r.ok ? 'sent' : 'error');
    }}>
      <label><span className="t-label">Name</span><input className="t-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label><span className="t-label">Email</span><input className="t-input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label><span className="t-label">Phone</span><input className="t-input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <label><span className="t-label">About</span><select className="t-input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>{topics.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="md:col-span-2"><span className="t-label">Message</span><textarea className="t-input" rows={5} required minLength={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} aria-hidden />
      {state === 'error' && <p className="text-sm text-red-700 md:col-span-2">Something went wrong — please try again or call us.</p>}
      <div className="md:col-span-2"><button className="t-btn" disabled={!ready || state === 'busy'}>{state === 'busy' ? 'Sending…' : 'Send message'}</button></div>
    </form>
  );
}
