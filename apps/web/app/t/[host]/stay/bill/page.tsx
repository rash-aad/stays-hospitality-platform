'use client';

import { useState } from 'react';
import { day, inr, PortalPay, Title } from '@/components/stay/bits';
import { useGuest } from '@/lib/hooks';

type Inv = { id: string; number: string; status: string; lines: { description: string; date?: string; quantity: number; amount: number; taxAmount: number }[]; subtotal: number; taxTotal: number; total: number; amountPaid: number; issuedAt: string | null; createdAt: string };
type Pay = { id: string; reference: string; method: string; status: string; amount: number; refundedAmount: number; createdAt: string; targetType: string; utr: string | null; rejectionReason: string | null };
const METHOD: Record<string, string> = { upi_manual: 'UPI', upi_gateway: 'UPI (online)', pay_at_property: 'At the hotel', room_charge: 'Room charge' };
const STATUS: Record<string, string> = { captured: 'Paid', pending_verification: 'Being verified', awaiting_payment: 'Awaiting payment', rejected: 'Not matched — resubmit', expired: 'Expired', cancelled: 'Cancelled', refunded: 'Refunded', partially_refunded: 'Part refunded' };

export default function Bill() {
  const { data, mutate } = useGuest<{ data: Inv[]; payments: Pay[] }>('/portal/invoices');
  const [paying, setPaying] = useState<string | null>(null);
  if (!data) return <p className="t-muted">Loading your bill…</p>;
  const current = data.data[0];
  return (
    <>
      <Title sub="Room, dining and everything charged to your room.">Your bill</Title>
      {!current ? <p className="t-muted">Your bill appears here once your stay begins.</p> : (
        <section data-testid="invoice">
          <p className="text-sm t-muted">{current.status === 'draft' ? 'Running total' : `Invoice ${current.number}`}{current.issuedAt ? ` · ${day(current.issuedAt)}` : ''}</p>
          <ul className="mt-3">
            {current.lines.map((l, i) => <li key={i} className="flex justify-between gap-4 border-b t-line py-3"><span>{l.description}{l.date && <span className="block text-xs t-muted">{day(l.date)}</span>}</span><span className="shrink-0 tabular-nums">{inr(l.amount)}</span></li>)}
          </ul>
          <dl className="mt-3 space-y-1">
            <div className="flex justify-between text-sm t-muted"><dt>Taxes</dt><dd className="tabular-nums">{inr(current.taxTotal)}</dd></div>
            <div className="flex justify-between text-lg"><dt>Total</dt><dd className="tabular-nums" data-testid="bill-total">{inr(current.total)}</dd></div>
            <div className="flex justify-between text-sm t-muted"><dt>Paid</dt><dd className="tabular-nums">{inr(current.amountPaid)}</dd></div>
            <div className="flex justify-between font-medium"><dt>Balance</dt><dd className="tabular-nums">{inr(Math.max(0, current.total - current.amountPaid))}</dd></div>
          </dl>
          <a className="t-btn t-btn-outline mt-6 w-full" href={`/stay/invoice/${current.id}`} data-testid="open-invoice">{current.status === 'draft' ? 'Invoice preview & company details' : 'View GST invoice'}</a>
        </section>
      )}
      {data.payments.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">Payments</h2>
          {data.payments.map((p) => (
            <div key={p.id} className="border-b t-line py-3">
              <p className="flex justify-between"><span>{METHOD[p.method] ?? p.method} · {STATUS[p.status] ?? p.status}</span><span className="tabular-nums">{inr(p.amount)}</span></p>
              <p className="text-xs t-muted">{day(p.createdAt)} · {p.reference}{p.utr ? ` · UTR ${p.utr}` : ''}</p>
              {['awaiting_payment', 'rejected'].includes(p.status) && (paying === p.id ? <div className="mt-3"><PortalPay paymentId={p.id} onDone={() => { setPaying(null); mutate(); }} /></div> : <button className="t-link mt-1 text-sm" onClick={() => setPaying(p.id)}>Pay now</button>)}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
