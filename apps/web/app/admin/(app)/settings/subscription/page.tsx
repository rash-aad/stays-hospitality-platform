'use client';

import { useState } from 'react';
import { useMe } from '@/components/admin-context';
import { inr, SubStatus, type SubState } from '@/components/subscription-bits';
import { BillToForm } from '@/components/tax-invoice';
import { ErrorNote, Field, Loading, PageHeader, Section, Status, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, dateTime, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Opt = { cycle: 'monthly' | 'yearly'; amount: number; tax: number; total: number; saving: number };
type Inv = { id: string; number: string; status: string; cycle: string; periodStart: string; periodEnd: string; amount: number; total: number; issuedAt: string };
type Overview = {
  state: SubState; status: string; coveredUntil: string; daysLeft: number; graceLeft: number; trialEndsAt: string; paidUntil: string | null; pendingVerification: boolean;
  options: Opt[]; gstRateBps: number; verifyPromise: string; nextPeriodStart: string; billTo: { name: string; company?: string | null; gstin?: string | null; address?: string | null } | null;
  openInvoice: null | (Inv & { pay: null | { vpa: string; payeeName: string; amount: number; uri: string; qr: string }; rejection: string | null });
  invoices: Inv[]; payments: { id: string; amount: number; utr: string; status: string; submittedAt: string; rejectionReason: string | null }[];
};

function statusLine(o: Overview) {
  switch (o.state) {
    case 'trial': return `Free trial — ${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'} left (until ${date(o.coveredUntil)})`;
    case 'active': return `Active — paid until ${date(o.coveredUntil)}`;
    case 'due': return `Renewal due — your cover ends ${date(o.coveredUntil)} (${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'})`;
    case 'overdue': case 'lapsed': return `Payment overdue since ${date(o.coveredUntil)} — your workspace will be suspended in ${Math.max(0, o.graceLeft)} day${o.graceLeft === 1 ? '' : 's'}`;
    case 'suspended': return 'Suspended for non-payment. Pay below — everything comes back as soon as we verify it.';
    case 'comp': return 'Complimentary — nothing to pay.';
    case 'cancelled': return 'Billing cancelled — contact bookEZ.';
  }
}

export default function Subscription() {
  const me = useMe();
  const { data, error, mutate } = useStaff<{ data: Overview }>('/admin/subscription', { refreshInterval: 60_000 });
  const { busy, run } = useAction();
  const [cycle, setCycle] = useState<'monthly' | 'yearly' | null>(null);
  const [utr, setUtr] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [done, setDone] = useState(false);
  if (!data) return <><PageHeader title="Subscription" /><ErrorNote error={error} /><Loading /></>;
  const o = data.data;
  const chosen = cycle ?? o.openInvoice?.cycle ?? (o.options.find((x) => x.cycle === 'yearly') ? 'yearly' : o.options[0]?.cycle) ?? null;
  const opt = o.options.find((x) => x.cycle === chosen);
  const inv = o.openInvoice;
  const billable = o.state !== 'comp' && o.state !== 'cancelled';
  const pctGst = o.gstRateBps / 100;

  async function submit() {
    let proofFileId: string | undefined;
    if (proof) { const fd = new FormData(); fd.append('file', proof); proofFileId = (await staffApi<{ data: { id: string } }>('/files?purpose=payment_proof', { form: fd })).data.id; }
    await staffApi(`/admin/subscription/invoice/${inv!.id}/payment`, { body: { utr, proofFileId } });
    return true;
  }

  return (
    <>
      <PageHeader title="Subscription" sub={`Your bookEZ plan for ${me.tenant.name}.`} actions={<SubStatus state={o.state} />} />
      <div className="max-w-3xl bg-panel">
        <Section>
          <p className={cx('text-[15px]', ['overdue', 'lapsed', 'suspended'].includes(o.state) && 'font-medium text-bad')} data-testid="sub-status-line">{statusLine(o)}</p>
          {o.pendingVerification && <p className="mt-2 rounded-sm bg-accent-soft px-3 py-2 text-[13px] text-accent" data-testid="sub-pending">Payment received — {o.verifyPromise.replace(/^./, (c) => c.toLowerCase())} You stay fully active while we check it.</p>}
        </Section>

        {billable && !o.pendingVerification && (
          o.options.length === 0 ? <Section><p className="text-[13px] text-muted">Pricing hasn’t been set for your property yet — contact bookEZ.</p></Section> : (
            <Section title={inv ? `Invoice ${inv.number}` : 'Renew or pay'}>
              {!inv || inv.status !== 'open' || cycle && cycle !== inv.cycle ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Billing period">
                    {o.options.map((x) => (
                      <label key={x.cycle} className={cx('cursor-pointer rounded-sm border p-4', chosen === x.cycle ? 'border-accent bg-accent-soft/40' : 'border-line')}>
                        <input type="radio" className="sr-only" name="cycle" checked={chosen === x.cycle} onChange={() => setCycle(x.cycle)} aria-label={x.cycle === 'monthly' ? 'Monthly' : 'Yearly'} />
                        <span className="block text-[13px] font-medium">{x.cycle === 'monthly' ? 'Monthly' : 'Yearly'}</span>
                        <span className="num mt-1 block text-2xl">{inr(x.total)}</span>
                        <span className="block text-xs text-muted">{inr(x.amount)} + {pctGst}% GST {inr(x.tax)}</span>
                        {x.saving > 0 && <span className="mt-1 block text-xs font-medium text-ok">Save {inr(x.saving)} vs paying monthly</span>}
                      </label>
                    ))}
                  </div>
                  <p className="mt-3 text-[13px] text-muted">Your next period starts {date(o.nextPeriodStart)} — paying early never loses days.</p>
                  <button className="btn btn-primary mt-3" disabled={busy || !opt} onClick={() => run(() => staffApi('/admin/subscription/invoice', { body: { cycle: chosen } })).then((r) => { if (r) { setCycle(null); setDone(false); mutate(); } })}>Pay {opt ? inr(opt.total) : ''}</button>
                </>
              ) : (
                <div className="grid gap-6 sm:grid-cols-[240px_1fr]" data-testid="pay-panel">
                  <div>
                    {inv.pay ? <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={inv.pay.qr} alt={`UPI QR code to pay ${inr(inv.total)} to ${inv.pay.payeeName}`} width={240} height={240} className="border border-line" />
                      <a className="btn mt-2 w-full justify-center sm:hidden" href={inv.pay.uri}>Open UPI app</a>
                    </> : <p className="text-[13px] text-muted">bookEZ hasn’t set up its UPI ID yet — contact support.</p>}
                  </div>
                  <div className="space-y-3 text-[13px]">
                    <div>
                      <p className="text-muted">Pay exactly</p>
                      <p className="num text-3xl" data-testid="pay-total">{inr(inv.total)}</p>
                      <p className="text-xs text-muted">{human(inv.cycle)} · {date(inv.periodStart)} – {date(inv.periodEnd)} · includes {pctGst}% GST</p>
                      {inv.pay && <p className="mt-1">to <span className="select-all font-mono">{inv.pay.vpa}</span> ({inv.pay.payeeName}), note <span className="font-mono">{inv.number}</span></p>}
                      <a className="mt-1 hidden text-xs underline sm:inline" href={inv.pay?.uri}>Open in a UPI app</a>
                    </div>
                    {inv.rejection && <p className="rounded-sm bg-bad-soft px-3 py-2 text-bad">We couldn’t confirm your last payment: {inv.rejection}. Check the reference and submit again.</p>}
                    {done ? <p className="rounded-sm bg-ok-soft px-3 py-2 text-ok">Payment received — {o.verifyPromise}</p> : (
                      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await run(submit, 'Payment submitted'); if (r !== undefined) { setDone(true); setUtr(''); setProof(null); mutate(); } }}>
                        <Field label="UPI reference (UTR)" hint="The 12-digit number in your payment app after paying"><input className="input font-mono" inputMode="numeric" maxLength={12} value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))} /></Field>
                        <Field label="Screenshot (optional)"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} /></Field>
                        <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={busy || utr.length !== 12}>I’ve paid — submit</button>
                          <button type="button" className="text-xs text-muted underline" onClick={() => run(() => staffApi(`/admin/subscription/invoice/${inv.id}`, { method: 'DELETE' }), 'Invoice cancelled').then(() => mutate())}>Cancel this invoice</button>
                          {o.options.length > 1 && <button type="button" className="text-xs text-muted underline" onClick={() => setCycle(inv.cycle === 'monthly' ? 'yearly' : 'monthly')}>Switch to {inv.cycle === 'monthly' ? 'yearly' : 'monthly'}</button>}
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </Section>
          )
        )}

        <Section title="Invoices & payments">
          {o.invoices.length === 0 ? <p className="text-[13px] text-muted">No invoices yet.</p> : (
            <table className="tbl" data-testid="sub-invoices"><thead><tr><th>Invoice</th><th>Period</th><th className="text-right">Total</th><th>Status</th><th /></tr></thead>
              <tbody>{o.invoices.map((i) => (
                <tr key={i.id}><td className="font-mono text-xs">{i.number}</td><td className="text-muted">{date(i.periodStart)} – {date(i.periodEnd)}</td><td className="num text-right">{inr(i.total)}</td>
                  <td><Status value={i.status === 'paid' ? 'paid' : i.status === 'pending_verification' ? 'pending_verification' : 'awaiting_payment'} label={human(i.status)} /></td>
                  <td className="text-right"><a className="btn btn-sm" href={`/admin/subscription-invoice/${i.id}`} target="_blank" rel="noreferrer">{i.status === 'paid' ? 'Tax invoice' : 'View'}</a></td></tr>
              ))}</tbody></table>
          )}
          {o.payments.length > 0 && <ul className="mt-3 space-y-0.5 text-xs text-muted">{o.payments.map((p) => <li key={p.id}>{dateTime(p.submittedAt)} · UTR <span className="font-mono">{p.utr}</span> · {inr(p.amount)} · {p.status === 'verified' ? 'confirmed' : human(p.status)}{p.rejectionReason && ` — ${p.rejectionReason}`}</li>)}</ul>}
        </Section>

        <Section title="Billing details">
          <p className="mb-3 text-[13px] text-muted">For a GST invoice in your company’s name (to claim input tax credit). Applies to your next invoice.</p>
          <BillToForm initial={o.billTo} busy={busy} onSave={(v) => run(() => staffApi('/admin/subscription/bill-to', { method: 'PUT', body: v }), 'Billing details saved').then(() => mutate())} />
        </Section>
      </div>
    </>
  );
}
