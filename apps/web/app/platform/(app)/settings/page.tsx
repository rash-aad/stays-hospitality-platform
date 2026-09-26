'use client';

import { useEffect, useState } from 'react';
import { ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type S = { vpa: string | null; payeeName: string; legalName: string; gstin: string | null; address: string; stateCode: string | null; invoicePrefix: string; gstRateBps: number; sac: string; verifyPromise: string; graceDays: number; trialDays: number; email: string | null };

export default function PlatformSettings() {
  const { data, error, mutate } = useStaff<{ data: S }>('/platform/billing-settings');
  const [f, setF] = useState<S | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data && !f) setF(data.data); }, [data, f]);
  if (!f) return <><PageHeader title="Settings" /><ErrorNote error={error} /><Loading /></>;
  const set = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string | null) => (v && v.trim()) || null;
  return (
    <>
      <PageHeader title="Billing settings" sub="How properties pay bookEZ, and what prints on bookEZ’s tax invoices."
        actions={<button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/platform/billing-settings', { method: 'PUT', body: { ...f, gstin: n(f.gstin)?.toUpperCase() ?? null, stateCode: n(f.stateCode), email: n(f.email), vpa: f.vpa?.trim() ?? '', gstRateBps: Number(f.gstRateBps), graceDays: Number(f.graceDays), trialDays: Number(f.trialDays) } }), 'Billing settings saved').then((r) => { if (r) { setF(null); mutate(); } })}>Save</button>} />
      <div className="max-w-3xl bg-panel">
        <Section title="Payments">
          <div className="grid grid-cols-2 gap-3">
            <Field label="bookEZ UPI ID" hint="Properties pay this by QR"><input className="input font-mono" value={f.vpa ?? ''} onChange={set('vpa')} placeholder="bookez@okhdfcbank" /></Field>
            <Field label="Payee name"><input className="input" value={f.payeeName} onChange={set('payeeName')} /></Field>
            <Field label="Verification promise" className="col-span-2" hint="Shown after a property submits its UTR"><input className="input" value={f.verifyPromise} onChange={set('verifyPromise')} /></Field>
          </div>
        </Section>
        <Section title="Tax invoices">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Legal name"><input className="input" value={f.legalName} onChange={set('legalName')} /></Field>
            <Field label="GSTIN"><input className="input font-mono uppercase" maxLength={15} value={f.gstin ?? ''} onChange={set('gstin')} /></Field>
            <Field label="Registered address" className="col-span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
            <Field label="State code" hint="Taken from the GSTIN when set (e.g. 29 = Karnataka)"><input className="input num w-20" maxLength={2} value={f.stateCode ?? ''} onChange={set('stateCode')} /></Field>
            <Field label="Invoice prefix" hint={`e.g. ${f.invoicePrefix || 'BKZ'}/2026-27/00001`}><input className="input font-mono uppercase" maxLength={10} value={f.invoicePrefix} onChange={set('invoicePrefix')} /></Field>
            <Field label="GST rate (%)"><input className="input num w-24" type="number" value={f.gstRateBps / 100} onChange={(e) => setF({ ...f, gstRateBps: Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="SAC code"><input className="input font-mono" maxLength={6} value={f.sac} onChange={set('sac')} /></Field>
            <Field label="Billing email" className="col-span-2"><input className="input" type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
          </div>
        </Section>
        <Section title="Defaults for new properties">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Free days"><input className="input num" type="number" min={0} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) })} /></Field>
            <Field label="Grace days before suspension"><input className="input num" type="number" min={0} max={60} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: Number(e.target.value) })} /></Field>
          </div>
        </Section>
      </div>
    </>
  );
}
