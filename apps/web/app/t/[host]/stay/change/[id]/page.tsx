'use client';

import { use, useState } from 'react';
import { day, inr, Notice, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type B = { id: string; reference: string; checkIn: string; checkOut: string; status: string; total: number; adults: number; children: number };
type Q = { total: number; previousTotal: number; difference: number; balance: number };

export default function ChangeDates({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useGuest<{ data: B[] }>('/portal/bookings');
  const b = data?.data.find((x) => x.id === id);
  const [dates, setDates] = useState<{ checkIn: string; checkOut: string } | null>(null);
  const [quote, setQuote] = useState<Q | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone?: 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!data) return <p className="t-muted">Loading…</p>;
  if (!b) return <Notice tone="error">Booking not found.</Notice>;
  const d = dates ?? { checkIn: b.checkIn, checkOut: b.checkOut };
  const payload = { checkIn: d.checkIn, checkOut: d.checkOut };
  const call = async (path: string) => {
    setBusy(true); setMsg(null);
    try { return await guestApi<{ data: Q & { balance: number } }>(`/portal/bookings/${id}/${path}`, { body: payload }); }
    catch (e) { setMsg({ text: (e as Error).message, tone: 'error' }); setQuote(null); return null; }
    finally { setBusy(false); }
  };
  if (done) return <><Title back="/stay/more">Dates changed</Title><p>Your stay is now {day(d.checkIn)} – {day(d.checkOut)}. We’ve emailed the details.</p><a className="t-btn mt-6" href="/stay">Back to your stay</a></>;
  return (
    <>
      <Title back="/stay/more" sub={`Currently ${day(b.checkIn)} – ${day(b.checkOut)} · ${b.reference}`}>Change dates</Title>
      <p className="mb-4 text-sm t-muted">Changes are free up to 48 hours before arrival on flexible rates. You pay (or get back) only the difference in price.</p>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="t-label">Check-in</span><input className="t-input" type="date" value={d.checkIn} onChange={(e) => { setDates({ ...d, checkIn: e.target.value }); setQuote(null); }} /></label>
        <label><span className="t-label">Check-out</span><input className="t-input" type="date" min={d.checkIn} value={d.checkOut} onChange={(e) => { setDates({ ...d, checkOut: e.target.value }); setQuote(null); }} /></label>
      </div>
      {!quote ? (
        <button className="t-btn mt-5 w-full" disabled={busy || d.checkOut <= d.checkIn || (d.checkIn === b.checkIn && d.checkOut === b.checkOut)} onClick={async () => { const r = await call('change-dates/quote'); if (r) setQuote(r.data); }}>{busy ? 'Checking…' : 'Check availability & price'}</button>
      ) : (
        <section className="mt-5 border-y t-line py-4" data-testid="change-quote">
          <dl className="space-y-1">
            <div className="flex justify-between t-muted"><dt>Current total</dt><dd className="tabular-nums">{inr(quote.previousTotal)}</dd></div>
            <div className="flex justify-between"><dt>New total</dt><dd className="tabular-nums">{inr(quote.total)}</dd></div>
            <div className="flex justify-between font-medium"><dt>{quote.difference >= 0 ? 'Additional' : 'Refund'}</dt><dd className="tabular-nums">{inr(Math.abs(quote.difference))}</dd></div>
          </dl>
          <button className="t-btn mt-4 w-full" disabled={busy} onClick={async () => { const r = await call('change-dates'); if (r) setDone(true); }}>{busy ? 'Changing…' : 'Confirm new dates'}</button>
        </section>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </>
  );
}
