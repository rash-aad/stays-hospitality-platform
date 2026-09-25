'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { dayTime, Notice, Row, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type Outlet = { id: string; name: string; acceptsReservations: boolean; maxPartySize: number; areas: { id: string; name: string }[] };
type Slot = { time: string; startsAt: string; available: boolean };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function Reserve() {
  const pre = useSearchParams().get('r');
  const { data: outlets } = useGuest<{ data: Outlet[] }>('/public/restaurants');
  const { data: mine, mutate } = useGuest<{ data: { id: string; reference: string; restaurant: string; startsAt: string; partySize: number; status: string }[] }>('/portal/reservations');
  const list = outlets?.data.filter((o) => o.acceptsReservations) ?? [];
  const [rid, setRid] = useState(pre ?? '');
  const [date, setDate] = useState(today());
  const [party, setParty] = useState(2);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [occasion, setOccasion] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!rid && list[0]) setRid(list[0].id); }, [list, rid]);
  useEffect(() => {
    if (!rid) return;
    setSlots(null); setPick(null);
    guestApi<{ data: { slots: Slot[] } }>(`/public/restaurants/${rid}/slots?date=${date}&partySize=${party}`).then((r) => setSlots(r.data.slots)).catch(() => setSlots([]));
  }, [rid, date, party]);
  async function book(waitlist = false) {
    setErr(null);
    try {
      const r = await guestApi<{ data: { status: string; reference: string } }>('/portal/reservations', { body: { restaurantId: rid, startsAt: pick!.startsAt, partySize: party, occasion: occasion || undefined, specialRequests: notes || undefined, joinWaitlist: waitlist } });
      setMsg(r.data.status === 'waitlisted' ? `You’re on the waitlist (${r.data.reference}). We’ll message you if a table opens.` : `Booked — ${r.data.reference}. See you at ${pick!.time}.`);
      setPick(null); mutate();
    } catch (e) { setErr((e as Error).message); }
  }
  const upcoming = mine?.data.filter((x) => new Date(x.startsAt) > new Date() && ['confirmed', 'waitlisted', 'requested'].includes(x.status)) ?? [];
  return (
    <>
      <Title back="/stay/dining">Book a table</Title>
      {upcoming.length > 0 && <section className="mb-8">{upcoming.map((x) => <Row key={x.id} title={`${x.restaurant} · ${x.partySize} guests`} sub={`${dayTime(x.startsAt)}${x.status === 'waitlisted' ? ' · waitlist' : ''}`} right={<button className="t-link" onClick={async () => { await guestApi(`/portal/reservations/${x.id}/cancel`, { method: 'POST' }); mutate(); }}>Cancel</button>} />)}</section>}
      {msg && <Notice>{msg}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        {list.length > 1 && <label className="col-span-2"><span className="t-label">Where</span><select className="t-input" value={rid} onChange={(e) => setRid(e.target.value)}>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
        <label><span className="t-label">Date</span><input className="t-input" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="t-label">Guests</span><select className="t-input" value={party} onChange={(e) => setParty(Number(e.target.value))}>{Array.from({ length: list.find((o) => o.id === rid)?.maxPartySize ?? 8 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
      </div>
      <div className="mt-5">
        {!slots ? <p className="t-muted">Finding tables…</p> : slots.length === 0 ? <p className="t-muted">No times on this date.</p> : (
          <div className="grid grid-cols-4 gap-2" data-testid="slots">
            {slots.map((s) => <button key={s.startsAt} onClick={() => setPick(s)} className="h-11 border text-sm" disabled={!s.available && false} style={{ borderRadius: 'var(--t-radius)', borderColor: pick?.startsAt === s.startsAt ? 'var(--t-ink)' : 'var(--t-line)', background: pick?.startsAt === s.startsAt ? 'var(--t-ink)' : undefined, color: pick?.startsAt === s.startsAt ? 'var(--t-bg)' : undefined, opacity: s.available ? 1 : 0.4 }}>{s.time}</button>)}
          </div>
        )}
      </div>
      {pick && (
        <div className="mt-6 space-y-3">
          <label className="block"><span className="t-label">Occasion</span><input className="t-input" placeholder="Anniversary, birthday…" value={occasion} onChange={(e) => setOccasion(e.target.value)} /></label>
          <label className="block"><span className="t-label">Allergies or requests</span><input className="t-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {pick.available ? <button className="t-btn w-full" onClick={() => book(false)}>Book {pick.time} for {party}</button> : <button className="t-btn t-btn-outline w-full" onClick={() => book(true)}>Join the waitlist for {pick.time}</button>}
        </div>
      )}
      {err && <Notice tone="error">{err}</Notice>}
    </>
  );
}
export default function Page() { return <Suspense><Reserve /></Suspense>; }
