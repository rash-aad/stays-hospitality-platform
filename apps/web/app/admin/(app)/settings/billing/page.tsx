'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type B = { legalName: string | null; gstin: string | null; address: string | null; invoicePrefix: string; sacRoom: string; sacFood: string; sacService: string; footerNote: string | null };

export default function BillingSettings() {
  const { data, error, mutate } = useStaff<{ data: B }>('/admin/billing-settings');
  const can = useCan();
  const { busy, run } = useAction();
  const [f, setF] = useState<B | null>(null);
  useEffect(() => { if (data && !f) setF(data.data); }, [data, f]);
  if (!f) return <><PageHeader title="Billing & GST" /><ErrorNote error={error} /><Loading /></>;
  const editable = can.perm('tenant.settings');
  const set = (k: keyof B) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string | null) => (v && v.trim()) || null;
  async function save() {
    const r = await run(() => staffApi('/admin/billing-settings', { method: 'PUT', body: { ...f!, legalName: n(f!.legalName), gstin: n(f!.gstin)?.toUpperCase() ?? null, address: n(f!.address), footerNote: n(f!.footerNote), invoicePrefix: f!.invoicePrefix.toUpperCase() } }), 'Billing details saved');
    if (r) { setF(null); mutate(); }
  }
  return (
    <>
      <PageHeader title="Billing & GST" sub="What prints on your tax invoices. Issued invoices keep the details they were issued with." actions={editable && <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>} />
      <div className="max-w-3xl bg-panel">
        <Section title="Your business">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Legal name" hint="As registered for GST"><input className="input" disabled={!editable} value={f.legalName ?? ''} onChange={set('legalName')} /></Field>
            <Field label="GSTIN" hint="Leave blank if not registered — invoices then print without GST fields"><input className="input font-mono uppercase" maxLength={15} disabled={!editable} value={f.gstin ?? ''} onChange={set('gstin')} placeholder="27AAPFU0939F1ZV" /></Field>
            <Field label="Registered address" className="col-span-2"><input className="input" disabled={!editable} value={f.address ?? ''} onChange={set('address')} /></Field>
          </div>
        </Section>
        <Section title="Invoice numbering">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prefix" hint={`Next invoice: ${f.invoicePrefix || 'INV'}/2026-27/00001 — the series restarts each financial year`}><input className="input font-mono uppercase" maxLength={10} disabled={!editable} value={f.invoicePrefix} onChange={set('invoicePrefix')} /></Field>
          </div>
        </Section>
        <Section title="SAC codes">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Accommodation"><input className="input font-mono" maxLength={6} disabled={!editable} value={f.sacRoom} onChange={set('sacRoom')} /></Field>
            <Field label="Food & beverage"><input className="input font-mono" maxLength={6} disabled={!editable} value={f.sacFood} onChange={set('sacFood')} /></Field>
            <Field label="Other services"><input className="input font-mono" maxLength={6} disabled={!editable} value={f.sacService} onChange={set('sacService')} /></Field>
          </div>
          <p className="mt-2 text-[13px] text-muted">Defaults: 996311 accommodation, 996331 restaurant service, 999799 other services. Tax rates come from Rates, taxes & offers.</p>
        </Section>
        <Section title="Footer">
          <Field label="Note printed on every invoice"><textarea className="input" rows={2} disabled={!editable} value={f.footerNote ?? ''} onChange={set('footerNote')} placeholder="Thank you for staying with us." /></Field>
        </Section>
      </div>
    </>
  );
}
