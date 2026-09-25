'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type Instr =
  | { kind: 'upi_manual'; vpa: string; payeeName: string | null; amount: number; reference: string; upiUri: string; qrSvg: string; expiresAt: string | null; requireProof: boolean }
  | { kind: 'upi_gateway'; checkout: { provider: string; orderId: string; key?: string; amount: number }; reference: string; expiresAt: string | null };
type Data = {
  booking: { id: string; reference: string; status: string; paymentStatus: string; checkIn: string; checkOut: string; adults: number; children: number; total: number; holdExpiresAt: string | null; room: string; guestFirstName: string; guestEmail: string };
  payment: { id: string; method: string; status: string; reference: string; utr: string | null; rejectionReason: string | null; expiresAt: string | null } | null;
  instructions: Instr | null;
};
const inr = (m: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: m % 100 ? 2 : 0 }).format(m / 100);
const fmt = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return <span className="tabular-nums">{h ? `${h}h ` : ''}{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>;
}

export function PayView({ id, phone, portal }: { id: string; phone: string | null; portal: boolean }) {
  const token = useSearchParams().get('token') ?? '';
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [vpa, setVpa] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/public/bookings/${id}/payment?token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (!r.ok) return setErr(j.error?.message ?? 'We couldn’t load this booking');
    setD(j.data);
  }, [id, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d || !['pending_payment'].includes(d.booking.status)) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [d, load]);

  async function submitUtr(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    // Proof screenshots need a guest session; the anonymous flow sends the UTR only.
    const r = await fetch(`/api/v1/public/bookings/${id}/utr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, utr, payerVpa: vpa || undefined }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error?.message ?? 'Please check the reference and try again');
    setUtr('');
    void load();
  }
  async function mockPay() {
    if (!d?.payment) return;
    setBusy(true);
    await fetch(`/api/v1/public/payments/mock/${d.payment.id}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true }) });
    setBusy(false);
    void load();
  }

  if (err && !d) return <div><p className="display text-3xl">This link isn’t working</p><p className="t-muted mt-3">{err}. If you booked with us, check your email for the latest link{phone ? ` or call ${phone}` : ''}.</p></div>;
  if (!d) return <p className="t-muted">Loading your booking…</p>;
  const b = d.booking;
  const p = d.payment;
  const summary = (
    <aside className="t-surface p-6 text-sm">
      <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Booking {b.reference}</p>
      <p className="display mt-3 text-2xl">{b.room}</p>
      <p className="mt-2">{fmt(b.checkIn)} → {fmt(b.checkOut)}</p>
      <p className="t-muted">{b.adults} adult{b.adults > 1 ? 's' : ''}{b.children ? `, ${b.children} children` : ''}</p>
      <p className="mt-4 flex justify-between border-t t-line pt-3 text-base"><span>Total</span><span className="tabular-nums">{inr(b.total)}</span></p>
    </aside>
  );

  if (b.status === 'confirmed' || b.status === 'checked_in') {
    return (
      <div className="grid gap-10 md:grid-cols-[1fr_320px]" data-testid="confirmed">
        <div>
          <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Confirmed</p>
          <h1 className="display mt-3 text-4xl md:text-5xl">We look forward to welcoming you, {b.guestFirstName}.</h1>
          <p className="mt-5 text-lg t-muted">Your booking <strong className="font-medium text-[color:var(--t-ink)]">{b.reference}</strong> is confirmed{b.paymentStatus === 'paid' ? ' and paid in full' : ' — you’ll settle the bill at the hotel'}. A confirmation is on its way to {b.guestEmail}.</p>
          {portal && <p className="mt-8"><a className="t-btn" href="/stay">Open your stay</a><span className="ml-4 text-sm t-muted">Dining, requests and your bill — all in one place.</span></p>}
        </div>
        {summary}
      </div>
    );
  }
  if (b.status === 'expired' || b.status === 'cancelled') {
    return (
      <div className="grid gap-10 md:grid-cols-[1fr_320px]" data-testid="expired">
        <div><h1 className="display text-4xl">{b.status === 'expired' ? 'This hold has expired' : 'This booking was cancelled'}</h1><p className="t-muted mt-4">{b.status === 'expired' ? 'We didn’t receive a verified payment in time, so the room was released.' : 'Nothing further is due.'} You’re welcome to book again.</p><a className="t-btn mt-8" href="/book">Search again</a></div>
        {summary}
      </div>
    );
  }

  const i = d.instructions;
  return (
    <div className="grid gap-10 md:grid-cols-[1fr_320px]">
      <div>
        {p?.status === 'pending_verification' ? (
          <div data-testid="verifying">
            <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Payment received — checking</p>
            <h1 className="display mt-3 text-4xl">Thank you. We’re matching your payment.</h1>
            <p className="mt-4 t-muted">We’ve received UPI reference <span className="font-mono text-[color:var(--t-ink)]">{p.utr}</span>. The team confirms it against our account — usually within the hour. Your room is held{b.holdExpiresAt && <> for <Countdown until={b.holdExpiresAt} /></>} and this page updates by itself.</p>
          </div>
        ) : (
          <>
            <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Room held{b.holdExpiresAt && <> · <Countdown until={b.holdExpiresAt} /> left to pay</>}</p>
            <h1 className="display mt-3 text-4xl">Complete your payment</h1>
            {p?.status === 'rejected' && (
              <p role="alert" className="mt-5 border-l-2 border-red-700 pl-4 text-sm" data-testid="rejected"><strong className="font-medium">We couldn’t match reference {p.utr}.</strong><br />{p.rejectionReason} Please check and submit the correct reference.</p>
            )}
            {i?.kind === 'upi_manual' && (
              <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
                <div className="w-[200px] border t-line bg-white p-2" aria-label="UPI QR code" dangerouslySetInnerHTML={{ __html: i.qrSvg }} />
                <div>
                  <p className="text-sm t-muted">Pay exactly</p>
                  <p className="display text-4xl tabular-nums" data-testid="amount">{inr(i.amount)}</p>
                  <p className="mt-4 text-sm t-muted">to UPI ID</p>
                  <p className="flex items-center gap-3 font-mono text-lg" data-testid="vpa">{i.vpa}<button type="button" className="font-sans text-xs t-link" onClick={() => { navigator.clipboard?.writeText(i.vpa); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button></p>
                  {i.payeeName && <p className="text-sm t-muted">{i.payeeName}</p>}
                  <span className="mt-6 block md:hidden"><a href={i.upiUri} className="t-btn t-btn-accent">Pay with a UPI app</a></span>
                  <p className="mt-4 text-xs t-muted">Add <span className="font-mono">{i.reference}</span> as the note if your app allows.</p>
                </div>
              </div>
            )}
            {i?.kind === 'upi_manual' && (
              <form onSubmit={submitUtr} className="mt-10 border-t t-line pt-8">
                <h2 className="display text-2xl">Paid? Tell us the reference</h2>
                <p className="mt-2 text-sm t-muted">Find the 12-digit UTR / UPI reference number on the success screen of your UPI app.</p>
                <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <label><span className="t-label">UTR / reference number</span><input className="t-input font-mono tracking-wider" name="utr" inputMode="numeric" autoComplete="off" required minLength={10} maxLength={22} value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s+/g, ''))} placeholder="412345678901" /></label>
                  <label><span className="t-label">Your UPI ID (optional)</span><input className="t-input" name="payerVpa" value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@okicici" /></label>
                  <button className="t-btn self-end" disabled={busy || utr.length < 10}>{busy ? 'Sending…' : 'Submit'}</button>
                </div>
                {i.requireProof && <label className="mt-3 block"><span className="t-label">Payment screenshot</span><input type="file" accept="image/*" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />{proof && <span className="text-xs t-muted"> Attached</span>}</label>}
                {err && <p role="alert" className="mt-3 text-sm text-red-800" data-testid="utr-error">{err}</p>}
              </form>
            )}
            {i?.kind === 'upi_gateway' && (
              <div className="mt-8">
                <p className="display text-4xl tabular-nums">{inr(i.checkout.amount)}</p>
                <p className="mt-2 text-sm t-muted">You’ll be taken to our payment partner to pay by UPI. Your booking confirms automatically.</p>
                {i.checkout.provider === 'mock'
                  ? <button className="t-btn t-btn-accent mt-6" onClick={mockPay} disabled={busy}>Pay {inr(i.checkout.amount)} (test gateway)</button>
                  : <RazorpayButton checkout={i.checkout} bookingId={b.id} token={token} onDone={load} />}
              </div>
            )}
          </>
        )}
      </div>
      {summary}
    </div>
  );
}

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }
function RazorpayButton({ checkout, bookingId, token, onDone }: { checkout: { key?: string; orderId: string; amount: number }; bookingId: string; token: string; onDone: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.Razorpay) return setReady(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, []);
  return (
    <button className="t-btn t-btn-accent mt-6" disabled={!ready} onClick={() => new window.Razorpay!({
      key: checkout.key, order_id: checkout.orderId, amount: checkout.amount, currency: 'INR', method: { upi: true, card: false, netbanking: false, wallet: false },
      handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        await fetch(`/api/v1/public/bookings/${bookingId}/gateway-confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }) });
        onDone();
      },
    }).open()}>Pay by UPI</button>
  );
}
