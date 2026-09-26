'use client';

import { useEffect, useState } from 'react';
import { staffApi } from '@/lib/api';
import { date, dateTime, human, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { inr, rupees, SubStatus, type SubState } from './subscription-bits';
import { Field, Loading, Modal, Section, Status, useAction } from './ui';

type Detail = {
  status: string; state: SubState; startedAt: string; trialEndsAt: string; paidUntil: string | null; coveredUntil: string; daysLeft: number; graceLeft: number;
  monthlyFee: number | null; yearlyFee: number | null; graceDays: number | null; effectiveGraceDays: number; platformGraceDays: number; freeDays: number; cycle: string | null;
  invoices: { id: string; number: string; status: string; cycle: string; periodStart: string; periodEnd: string; total: number; issuedAt: string }[];
  payments: { id: string; utr: string; amount: number; status: string; submittedAt: string; rejectionReason: string | null }[];
};

/** Super admin: price, free days, grace and manual actions for one property. */
export function PlatformSubscription({ tenantId }: { tenantId: string }) {
  const { data, mutate } = useStaff<{ data: Detail }>(`/platform/tenants/${tenantId}/subscription`);
  const { busy, run } = useAction();
  const [f, setF] = useState<{ freeDays: string; monthly: string; yearly: string; grace: string } | null>(null);
  const [extend, setExtend] = useState<null | { days: string; note: string }>(null);
  const d = data?.data;
  useEffect(() => { if (d && !f) setF({ freeDays: String(d.freeDays), monthly: rupees(d.monthlyFee), yearly: rupees(d.yearlyFee), grace: d.graceDays == null ? '' : String(d.graceDays) }); }, [d, f]);
  if (!d || !f) return <Section title="Subscription"><Loading rows={3} /></Section>;
  const save = () => run(() => staffApi(`/platform/tenants/${tenantId}/subscription`, { method: 'PUT', body: { freeDays: Number(f.freeDays || 0), monthlyFee: f.monthly ? toMinor(f.monthly) : null, yearlyFee: f.yearly ? toMinor(f.yearly) : null, graceDays: f.grace === '' ? null : Number(f.grace) } }), 'Subscription saved — new prices apply from the next invoice').then((r) => { if (r) { setF(null); mutate(); } });
  const setStatus = (status: 'comp' | 'cancelled' | 'billing', msg: string) => run(() => staffApi(`/platform/tenants/${tenantId}/subscription/status`, { method: 'PUT', body: { status } }), msg).then(() => mutate());
  return (
    <>
      <Section title="Subscription" actions={<SubStatus state={d.state} />}>
        <p className="mb-3 text-[13px] text-muted" data-testid="sub-summary">
          {d.state === 'comp' ? 'Complimentary — no billing.' : d.state === 'cancelled' ? 'Billing cancelled.' : d.paidUntil ? `Paid until ${date(d.paidUntil)}` : `Free trial until ${date(d.trialEndsAt)}`}
          {d.daysLeft < 0 && d.state !== 'comp' && d.state !== 'cancelled' && ` · ${-d.daysLeft} days overdue, ${Math.max(0, d.graceLeft)} days of grace left`}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Free days" hint={`From ${date(d.startedAt)} → trial ends ${date(new Date(Date.parse(`${d.startedAt}T00:00:00Z`) + Number(f.freeDays || 0) * 86400000).toISOString().slice(0, 10))}`}><input className="input num" type="number" min={0} value={f.freeDays} onChange={(e) => setF({ ...f, freeDays: e.target.value })} /></Field>
          <Field label="Grace days" hint={`Empty = platform default (${d.platformGraceDays})`}><input className="input num" type="number" min={0} max={60} value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></Field>
          <Field label="Monthly fee (₹, excl. GST)" hint="Empty = not offered"><input className="input num" inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></Field>
          <Field label="Yearly fee (₹, excl. GST)" hint="Empty = not offered"><input className="input num" inputMode="decimal" value={f.yearly} onChange={(e) => setF({ ...f, yearly: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={save}>Save pricing</button>
          <button className="btn" onClick={() => setExtend({ days: '7', note: '' })}>Extend by days…</button>
          {d.status !== 'comp' ? <button className="btn" disabled={busy} onClick={() => setStatus('comp', 'Marked complimentary')}>Make complimentary</button> : <button className="btn" disabled={busy} onClick={() => setStatus('billing', 'Billing resumed')}>Resume billing</button>}
          {d.status !== 'cancelled' ? <button className="btn btn-danger" disabled={busy} onClick={() => setStatus('cancelled', 'Billing cancelled')}>Cancel billing</button> : <button className="btn" disabled={busy} onClick={() => setStatus('billing', 'Billing resumed')}>Resume billing</button>}
        </div>
      </Section>
      <Section title="Invoices">
        {d.invoices.length === 0 ? <p className="text-[13px] text-muted">None yet.</p> : (
          <ul className="divide-y divide-line text-[13px]">{d.invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-1.5">
              <a className="font-mono text-xs hover:underline" href={`/platform/invoices/${i.id}`} target="_blank" rel="noreferrer">{i.number}</a>
              <span className="text-muted">{human(i.cycle)} · {date(i.periodStart)} – {date(i.periodEnd)}</span>
              <span className="num">{inr(i.total)}</span><Status value={i.status === 'pending_verification' ? 'pending_verification' : i.status === 'paid' ? 'paid' : i.status === 'void' ? 'cancelled' : 'awaiting_payment'} label={human(i.status)} />
            </li>
          ))}</ul>
        )}
        {d.payments.length > 0 && <ul className="mt-3 space-y-0.5 text-xs text-muted">{d.payments.map((p) => <li key={p.id}>{dateTime(p.submittedAt)} · UTR <span className="font-mono">{p.utr}</span> · {inr(p.amount)} · {human(p.status)}{p.rejectionReason && ` — ${p.rejectionReason}`}</li>)}</ul>}
      </Section>
      <Modal open={!!extend} onClose={() => setExtend(null)} title="Extend cover"
        footer={extend && <button className="btn btn-primary" disabled={busy || !extend.days || extend.note.trim().length < 2} onClick={() => run(() => staffApi(`/platform/tenants/${tenantId}/subscription/extend`, { body: { days: Number(extend.days), note: extend.note } }), 'Cover extended').then((r) => { if (r) { setExtend(null); setF(null); mutate(); } })}>Extend</button>}>
        {extend && <div className="space-y-3"><p className="text-[13px] text-muted">Adds days to the {d.paidUntil ? 'paid-until date' : 'free trial'} at no charge. If the property was suspended for non-payment and is covered again, it's reactivated.</p><Field label="Days"><input className="input num w-28" type="number" min={1} max={366} value={extend.days} onChange={(e) => setExtend({ ...extend, days: e.target.value })} /></Field><Field label="Reason (audit log)"><input className="input" value={extend.note} onChange={(e) => setExtend({ ...extend, note: e.target.value })} placeholder="Goodwill — onboarding took longer" /></Field></div>}
      </Modal>
    </>
  );
}
