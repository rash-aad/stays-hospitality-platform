'use client';

import { useState } from 'react';
import { dayTime, inr, Notice, PortalPay, Row, Sheet, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';
import { useStay } from '@/components/stay/shell';

type E = { id: string; kind: string; name: string; summary: string | null; images: { url: string; alt: string }[]; durationMinutes: number; price: number; pricePer: string; maxParticipants: number; location: string | null };
type Slot = { id: string; startsAt: string; remaining: number };

export default function Experiences() {
  const { home } = useStay();
  const { data } = useGuest<{ data: E[] }>('/public/experiences');
  const { data: mine, mutate } = useGuest<{ data: { id: string; experience: string; startsAt: string; participants: number; status: string; total: number }[] }>('/portal/experience-bookings');
  const [e, setE] = useState<E | null>(null);
  const { data: slots } = useGuest<{ data: Slot[] }>(e ? `/public/experiences/${e.id}/slots` : null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [n, setN] = useState(2);
  const [pay, setPay] = useState(home.stay?.inHouse ? 'room_charge' : 'upi_manual');
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  async function book() {
    setErr(null);
    try {
      const r = await guestApi<{ data: { booking: { id: string; status: string }; instructions: unknown } }>('/portal/experience-bookings', { idempotencyKey: key, body: { slotId: slot!.id, participants: n, paymentMode: e!.price === 0 ? 'free' : pay } });
      setKey(crypto.randomUUID());
      mutate();
      if (r.data.booking.status === 'pending_payment') {
        const inv = await guestApi<{ payments: { id: string; targetType: string; status: string }[] }>('/portal/invoices');
        setPending(inv.payments.find((p) => p.targetType === 'experience_booking' && p.status === 'awaiting_payment')?.id ?? null);
      } else { setDone(`${e!.name} is booked for ${dayTime(slot!.startsAt)}.`); setE(null); }
    } catch (x) { setErr((x as Error).message); setKey(crypto.randomUUID()); }
  }
  const up = mine?.data.filter((b) => ['confirmed', 'pending_payment'].includes(b.status)) ?? [];
  return (
    <>
      <Title back="/stay">Experiences</Title>
      {done && <Notice>{done}</Notice>}
      {up.length > 0 && <section className="mb-8">{up.map((b) => <Row key={b.id} title={b.experience} sub={`${dayTime(b.startsAt)} · ${b.participants} ${b.participants > 1 ? 'people' : 'person'}${b.status === 'pending_payment' ? ' · awaiting payment' : ''}`} right={<button className="t-link" onClick={async () => { try { await guestApi(`/portal/experience-bookings/${b.id}/cancel`, { method: 'POST' }); mutate(); } catch (x) { setErr((x as Error).message); } }}>Cancel</button>} />)}</section>}
      {data?.data.map((x) => (
        <button key={x.id} className="mb-8 block w-full text-left" onClick={() => { setE(x); setSlot(null); setN(Math.min(2, x.maxParticipants)); setErr(null); setPending(null); }}>
          {x.images[0] && <img src={x.images[0].url} alt={x.images[0].alt} className="aspect-[16/9] w-full object-cover" />}
          <p className="display mt-3 text-2xl">{x.name}</p>
          <p className="text-sm t-muted">{x.summary}</p>
          <p className="mt-1 text-sm">{x.price ? `${inr(x.price)}${x.pricePer === 'person' ? ' per person' : ''}` : 'Complimentary'} · {x.durationMinutes} min</p>
        </button>
      ))}
      <Sheet open={!!e} onClose={() => setE(null)} title={e?.name ?? ''}>
        {pending ? <PortalPay paymentId={pending} onDone={() => { mutate(); setDone('Payment received — you’re booked.'); setE(null); }} /> : e && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2" data-testid="exp-slots">
              {!slots ? <p className="t-muted">Loading times…</p> : slots.data.length === 0 ? <p className="col-span-2 t-muted">No sessions in the next two weeks.</p> : slots.data.slice(0, 16).map((s) => (
                <button key={s.id} disabled={s.remaining < 1} onClick={() => setSlot(s)} className="border px-3 py-2 text-left text-sm disabled:opacity-40" style={{ borderRadius: 'var(--t-radius)', borderColor: slot?.id === s.id ? 'var(--t-ink)' : 'var(--t-line)' }}>{dayTime(s.startsAt)}<span className="block text-xs t-muted">{s.remaining} left</span></button>
              ))}
            </div>
            <label className="block"><span className="t-label">People</span><select className="t-input" value={n} onChange={(ev) => setN(Number(ev.target.value))}>{Array.from({ length: e.maxParticipants }, (_, i) => i + 1).map((k) => <option key={k}>{k}</option>)}</select></label>
            {e.price > 0 && <fieldset><legend className="t-label">Payment</legend>{[...(home.stay?.inHouse ? ['room_charge'] : []), 'upi_manual', 'pay_at_property'].map((m) => <label key={m} className="flex items-center gap-3 border-b t-line py-3"><input type="radio" name="p" checked={pay === m} onChange={() => setPay(m)} />{m === 'room_charge' ? 'Charge to my room' : m === 'upi_manual' ? 'Pay now by UPI' : 'Pay at the property'}</label>)}</fieldset>}
            {err && <Notice tone="error">{err}</Notice>}
            <button className="t-btn w-full" disabled={!slot} onClick={book}>{slot ? `Book · ${inr(e.pricePer === 'person' ? e.price * n : e.price)}` : 'Choose a time'}</button>
          </div>
        )}
      </Sheet>
    </>
  );
}
