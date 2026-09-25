'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { guestApi } from '@/lib/api';

export const inr = (m: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: m % 100 ? 2 : 0 }).format(m / 100);
export const hm = (d: string | Date) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(d));
export const day = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: d.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(new Date(d.length === 10 ? `${d}T00:00:00Z` : d));
export const dayTime = (d: string) => `${day(d)}, ${hm(d)}`;

export const ORDER_LABEL: Record<string, string> = { pending_payment: 'Waiting for payment', new: 'Sent to the kitchen', accepted: 'Accepted', preparing: 'Being prepared', ready: 'Ready — on its way', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' };

export function Title({ children, sub, back }: { children: ReactNode; sub?: ReactNode; back?: string }) {
  return (
    <div className="mb-6">
      {back && <a href={back} className="mb-3 inline-block text-sm t-muted">← Back</a>}
      <h1 className="display text-[2.1rem] leading-tight">{children}</h1>
      {sub && <p className="mt-2 t-muted">{sub}</p>}
    </div>
  );
}

export function Row({ href, onClick, title, sub, right }: { href?: string; onClick?: () => void; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const body = (
    <span className="flex min-h-14 items-center justify-between gap-4 border-b t-line py-3.5">
      <span className="min-w-0"><span className="block">{title}</span>{sub && <span className="mt-0.5 block text-sm t-muted">{sub}</span>}</span>
      <span className="shrink-0 text-sm t-muted">{right ?? (href || onClick ? '→' : null)}</span>
    </span>
  );
  if (href) return <a href={href} className="block">{body}</a>;
  if (onClick) return <button onClick={onClick} className="block w-full text-left">{body}</button>;
  return body;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <section className="anim-sheet relative max-h-[92dvh] w-full max-w-xl overflow-y-auto px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]" style={{ background: 'var(--t-bg)', borderTopLeftRadius: 'calc(var(--t-radius) + 8px)', borderTopRightRadius: 'calc(var(--t-radius) + 8px)' }}>
        <div className="mb-4 flex items-center justify-between"><h2 className="display text-2xl">{title}</h2><button onClick={onClose} className="text-sm t-muted">Close</button></div>
        {children}
      </section>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return <p role={tone === 'error' ? 'alert' : undefined} className="my-4 border-l-2 pl-3 text-sm" style={{ borderColor: tone === 'error' ? '#9b2c1f' : 'var(--t-accent)', color: tone === 'error' ? '#9b2c1f' : undefined }}>{children}</p>;
}

type Instr = { kind: 'upi_manual'; vpa: string; payeeName: string | null; amount: number; reference: string; upiUri: string; qrSvg: string } | { kind: 'upi_gateway'; checkout: { provider: string; amount: number } };

/** Pay an order / experience inside the portal (own-UPI with UTR, or gateway). */
export function PortalPay({ paymentId, onDone }: { paymentId: string; onDone: () => void }) {
  const [p, setP] = useState<{ status: string; amount: number; utr: string | null; rejectionReason: string | null; instructions: Instr | null } | null>(null);
  const [utr, setUtr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => guestApi<{ data: NonNullable<typeof p> }>(`/portal/payments/${paymentId}`).then((r) => setP(r.data));
  useEffect(() => { void load(); }, [paymentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <p className="t-muted">Loading payment…</p>;
  if (p.status === 'captured') return <Notice>Paid — thank you.</Notice>;
  if (p.status === 'pending_verification') return <Notice>We’ve received reference {p.utr} and are confirming it.</Notice>;
  const i = p.instructions;
  if (!i) return <Notice>This payment is {p.status.replace('_', ' ')}.</Notice>;
  if (i.kind === 'upi_gateway') return <button className="t-btn t-btn-accent w-full" disabled={busy} onClick={async () => { setBusy(true); await fetch(`/api/v1/public/payments/mock/${paymentId}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setBusy(false); onDone(); }}>Pay {inr(i.checkout.amount)} by UPI</button>;
  return (
    <div>
      {p.status === 'rejected' && <Notice tone="error">{p.rejectionReason}</Notice>}
      <div className="flex gap-4">
        <div className="w-32 shrink-0 bg-white p-1" dangerouslySetInnerHTML={{ __html: i.qrSvg }} />
        <div className="text-sm"><p className="display text-3xl tabular-nums">{inr(i.amount)}</p><p className="mt-1 font-mono">{i.vpa}</p><a href={i.upiUri} className="t-btn t-btn-accent mt-3 h-10 px-4">Open UPI app</a></div>
      </div>
      <form className="mt-5 flex gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await guestApi(`/portal/payments/${paymentId}/utr`, { body: { utr } }); onDone(); void load(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }}>
        <input className="t-input font-mono" placeholder="12-digit UTR" inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s+/g, ''))} required minLength={10} />
        <button className="t-btn" disabled={busy}>Submit</button>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}
