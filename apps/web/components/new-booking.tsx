'use client';

import { useEffect, useState } from 'react';
import { newIdempotencyKey, staffApi } from '@/lib/api';
import { isoToday, money, nights } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { Drawer, Field, Section, useAction } from './ui';

type RT = { id: string; name: string; maxAdults: number; maxChildren: number; active: boolean };
type RP = { id: string; roomTypeId: string; name: string; active: boolean };
type Quote = { nights: { date: string; price: number }[]; subtotal: number; discount: number; taxTotal: number; total: number; couponError: string | null };

export function NewBooking({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: rts } = useStaff<{ data: RT[] }>(open ? '/admin/room-types' : null);
  const { data: rps } = useStaff<{ data: RP[] }>(open ? '/admin/rate-plans' : null);
  const [f, setF] = useState({ checkIn: isoToday(), checkOut: isoToday(1), adults: '2', children: '0', roomTypeId: '', ratePlanId: '', couponCode: '', email: '', firstName: '', lastName: '', phone: '', source: 'phone', paymentMethod: 'pay_at_property', specialRequests: '' });
  const [guestQ, setGuestQ] = useState('');
  const [guestId, setGuestId] = useState<string | null>(null);
  const { data: found } = useStaff<{ data: { id: string; firstName: string; lastName: string; email: string; phone: string | null }[] }>(guestQ.length > 1 && !guestId ? `/admin/guests?q=${encodeURIComponent(guestQ)}&pageSize=5` : null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const { busy, run } = useAction();
  const [key] = useState(newIdempotencyKey);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const plans = (rps?.data ?? []).filter((p) => p.roomTypeId === f.roomTypeId && p.active);

  useEffect(() => {
    if (!f.roomTypeId || !f.ratePlanId || f.checkOut <= f.checkIn) return setQuote(null);
    const t = setTimeout(() => {
      staffApi<{ data: { quote: Quote } }>('/public/booking/quote', { body: { roomTypeId: f.roomTypeId, ratePlanId: f.ratePlanId, checkIn: f.checkIn, checkOut: f.checkOut, adults: Number(f.adults), children: Number(f.children), couponCode: f.couponCode || null } })
        .then((r) => { setQuote(r.data.quote); setQErr(null); })
        .catch((e) => { setQuote(null); setQErr(e.message); });
    }, 250);
    return () => clearTimeout(t);
  }, [f.roomTypeId, f.ratePlanId, f.checkIn, f.checkOut, f.adults, f.children, f.couponCode]);

  async function submit() {
    const r = await run(() => staffApi<{ data: { booking: { id: string; reference: string } } }>('/admin/bookings', {
      idempotencyKey: key,
      body: {
        roomTypeId: f.roomTypeId, ratePlanId: f.ratePlanId, checkIn: f.checkIn, checkOut: f.checkOut, adults: Number(f.adults), children: Number(f.children),
        couponCode: f.couponCode || null, source: f.source, paymentMethod: f.paymentMethod, specialRequests: f.specialRequests || undefined,
        guest: guestId ? { guestId } : { email: f.email, firstName: f.firstName, lastName: f.lastName, phone: f.phone || undefined },
      },
    }), 'Reservation created');
    if (r) onCreated(r.data.booking.id);
  }

  return (
    <Drawer open={open} onClose={onClose} title="New reservation" width={640}
      footer={<><button className="btn" onClick={onClose}>Discard</button><button className="btn btn-primary" disabled={busy || !quote || (!guestId && (!f.email || !f.firstName || !f.lastName))} onClick={submit}>Create reservation{quote ? ` · ${money(quote.total)}` : ''}</button></>}>
      <Section title="Stay">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Arrival"><input className="input" type="date" value={f.checkIn} onChange={set('checkIn')} /></Field>
          <Field label="Departure"><input className="input" type="date" value={f.checkOut} onChange={set('checkOut')} /></Field>
          <Field label="Adults"><input className="input" type="number" min={1} max={16} value={f.adults} onChange={set('adults')} /></Field>
          <Field label="Children"><input className="input" type="number" min={0} max={10} value={f.children} onChange={set('children')} /></Field>
          <Field label="Room type" className="col-span-2"><select className="input" value={f.roomTypeId} onChange={(e) => setF((x) => ({ ...x, roomTypeId: e.target.value, ratePlanId: '' }))}><option value="">Choose…</option>{rts?.data.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Rate" className="col-span-2"><select className="input" value={f.ratePlanId} onChange={set('ratePlanId')} disabled={!f.roomTypeId}><option value="">Choose…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Coupon" className="col-span-2"><input className="input uppercase" value={f.couponCode} onChange={set('couponCode')} /></Field>
          <Field label="Source" className="col-span-2"><select className="input" value={f.source} onChange={set('source')}><option value="phone">Phone</option><option value="walk_in">Walk-in</option><option value="admin">Email / other</option><option value="agent">Travel agent</option><option value="ota">OTA</option></select></Field>
        </div>
        {qErr && <p className="mt-3 text-[13px] text-bad">{qErr}</p>}
        {quote && (
          <div className="mt-4 border border-line text-[13px]">
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-xs text-muted">
              {quote.nights.map((n) => <span key={n.date} className="num">{new Date(`${n.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} {money(n.price)}</span>)}
            </div>
            <div className="grid grid-cols-4 px-3 py-2">
              <span className="text-muted">{nights(f.checkIn, f.checkOut)} nights</span>
              <span className="num">{money(quote.subtotal)}</span>
              <span className="num text-muted">{quote.discount ? `−${money(quote.discount)} · ` : ''}tax {money(quote.taxTotal)}</span>
              <span className="num text-right font-medium">{money(quote.total)}</span>
            </div>
            {quote.couponError && <p className="px-3 pb-2 text-xs text-bad">{quote.couponError}</p>}
          </div>
        )}
      </Section>
      <Section title="Guest">
        {guestId ? (
          <p className="text-[13px]">Existing guest selected · <button className="underline" onClick={() => { setGuestId(null); setGuestQ(''); }}>change</button></p>
        ) : (
          <>
            <Field label="Find a returning guest"><input className="input" placeholder="Name, email or phone" value={guestQ} onChange={(e) => setGuestQ(e.target.value)} /></Field>
            {found && found.data.length > 0 && (
              <ul className="mt-1 divide-y divide-line border border-line text-[13px]">
                {found.data.map((g) => <li key={g.id}><button className="w-full px-3 py-2 text-left hover:bg-sunk" onClick={() => setGuestId(g.id)}>{g.firstName} {g.lastName} <span className="text-muted">· {g.email}</span></button></li>)}
              </ul>
            )}
            <p className="eyebrow mt-4 mb-2">Or a new guest</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name"><input className="input" value={f.firstName} onChange={set('firstName')} /></Field>
              <Field label="Last name"><input className="input" value={f.lastName} onChange={set('lastName')} /></Field>
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
              <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
            </div>
          </>
        )}
      </Section>
      <Section title="Payment & notes">
        <Field label="Payment"><select className="input" value={f.paymentMethod} onChange={set('paymentMethod')}><option value="pay_at_property">Pay at the property</option><option value="upi_manual">UPI to our ID — send payment link</option><option value="upi_gateway">UPI gateway — send payment link</option></select></Field>
        <Field label="Special requests" className="mt-3"><textarea className="input" rows={2} value={f.specialRequests} onChange={set('specialRequests')} /></Field>
      </Section>
    </Drawer>
  );
}
