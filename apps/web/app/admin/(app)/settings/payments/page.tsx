'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type S = { methodsEnabled: string[]; upiVpa: string | null; upiPayeeName: string | null; gatewayProvider: string | null; gatewayKeyId: string | null; gatewaySecretSet: boolean; gatewayWebhookSecretSet: boolean; manualPayWindowMinutes: number; verificationWindowHours: number; requireProofUpload: boolean; webhookUrl: string; paymentsModuleEnabled: boolean };
const METHODS = [
  { key: 'upi_manual', title: 'UPI to your own UPI ID', body: 'Guests pay your UPI ID by QR or app, then enter the UTR. Your team approves each payment after checking the bank or UPI app. No gateway fees.' },
  { key: 'upi_gateway', title: 'UPI through a payment gateway', body: 'Guests pay through Razorpay’s UPI checkout and bookings confirm automatically. Gateway fees apply.' },
  { key: 'room_charge', title: 'Charge to room', body: 'In-house guests add dining and experiences to their bill.' },
  { key: 'pay_at_property', title: 'Pay at the property', body: 'Confirm now, collect at check-in or checkout (cash, card, UPI at the desk).' },
];

export default function PaymentSettings() {
  const { data, error, mutate } = useStaff<{ data: S }>('/admin/payment-settings');
  const can = useCan();
  const { busy, run } = useAction();
  const [f, setF] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (data && !f) setF({ ...data.data, gatewaySecret: '', gatewayWebhookSecret: '' }); }, [data, f]);
  if (!data || !f) return <><PageHeader title="Payment methods" /><ErrorNote error={error} /><Loading /></>;
  const s = data.data;
  const on = (k: string) => (f.methodsEnabled as string[]).includes(k);
  const toggle = (k: string) => setF({ ...f, methodsEnabled: on(k) ? (f.methodsEnabled as string[]).filter((x) => x !== k) : [...(f.methodsEnabled as string[]), k] });
  const editable = can.perm('payments.settings');
  async function save() {
    const body: Record<string, unknown> = {
      methodsEnabled: f!.methodsEnabled, upiVpa: f!.upiVpa || null, upiPayeeName: f!.upiPayeeName || null, gatewayProvider: f!.gatewayProvider || null, gatewayKeyId: f!.gatewayKeyId || null,
      manualPayWindowMinutes: Number(f!.manualPayWindowMinutes), verificationWindowHours: Number(f!.verificationWindowHours), requireProofUpload: !!f!.requireProofUpload,
    };
    if (f!.gatewaySecret) body.gatewaySecret = f!.gatewaySecret;
    if (f!.gatewayWebhookSecret) body.gatewayWebhookSecret = f!.gatewayWebhookSecret;
    const r = await run(() => staffApi('/admin/payment-settings', { method: 'PUT', body }), 'Payment settings saved');
    if (r !== undefined) { setF(null); mutate(); }
  }
  return (
    <>
      <PageHeader title="Payment methods" sub="Choose how guests pay you. You can offer several — guests pick at checkout." actions={editable && <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>} />
      {!s.paymentsModuleEnabled && <p className="mx-6 mt-4 rounded-sm border border-line bg-sunk px-3 py-2 text-[13px]">The Payments module is off, so online UPI isn’t offered to guests. Pay-at-property still works. Enable it in Modules.</p>}
      <div className="max-w-3xl bg-panel">
        <Section title="Methods offered">
          <ul className="divide-y divide-line">
            {METHODS.map((m) => (
              <li key={m.key} className="py-3">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" disabled={!editable} checked={on(m.key)} onChange={() => toggle(m.key)} />
                  <span><span className="block text-[13px] font-medium">{m.title}</span><span className="block text-[13px] text-muted">{m.body}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </Section>
        {on('upi_manual') && (
          <Section title="Your UPI ID">
            <div className="grid grid-cols-2 gap-3">
              <Field label="UPI ID (VPA)" hint="As shown in your business UPI app, e.g. seabreeze@okhdfcbank"><input className="input font-mono" disabled={!editable} value={(f.upiVpa as string) ?? ''} onChange={(e) => setF({ ...f, upiVpa: e.target.value.trim() })} /></Field>
              <Field label="Payee name" hint="Shown to guests before they pay"><input className="input" disabled={!editable} value={(f.upiPayeeName as string) ?? ''} onChange={(e) => setF({ ...f, upiPayeeName: e.target.value })} /></Field>
              <Field label="Time to pay (minutes)" hint="The room is held this long while the guest pays"><input className="input num" type="number" min={10} disabled={!editable} value={String(f.manualPayWindowMinutes)} onChange={(e) => setF({ ...f, manualPayWindowMinutes: e.target.value })} /></Field>
              <Field label="Time to verify (hours)" hint="How long your team has to approve a submitted UTR"><input className="input num" type="number" min={1} disabled={!editable} value={String(f.verificationWindowHours)} onChange={(e) => setF({ ...f, verificationWindowHours: e.target.value })} /></Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" disabled={!editable} checked={!!f.requireProofUpload} onChange={(e) => setF({ ...f, requireProofUpload: e.target.checked })} /> Ask guests to attach a payment screenshot</label>
          </Section>
        )}
        {on('upi_gateway') && (
          <Section title="UPI gateway">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider"><select className="input" disabled={!editable} value={(f.gatewayProvider as string) ?? ''} onChange={(e) => setF({ ...f, gatewayProvider: e.target.value })}><option value="">Choose…</option><option value="razorpay">Razorpay</option><option value="mock">Test gateway (development)</option></select></Field>
              <Field label="Key ID"><input className="input font-mono" disabled={!editable} value={(f.gatewayKeyId as string) ?? ''} onChange={(e) => setF({ ...f, gatewayKeyId: e.target.value })} placeholder="rzp_live_…" /></Field>
              <Field label="Key secret" hint={s.gatewaySecretSet ? 'Saved — leave blank to keep' : 'Stored encrypted'}><input className="input font-mono" type="password" autoComplete="off" disabled={!editable} value={(f.gatewaySecret as string) ?? ''} onChange={(e) => setF({ ...f, gatewaySecret: e.target.value })} /></Field>
              <Field label="Webhook secret" hint={s.gatewayWebhookSecretSet ? 'Saved — leave blank to keep' : 'From your gateway dashboard'}><input className="input font-mono" type="password" autoComplete="off" disabled={!editable} value={(f.gatewayWebhookSecret as string) ?? ''} onChange={(e) => setF({ ...f, gatewayWebhookSecret: e.target.value })} /></Field>
            </div>
            <p className="mt-3 text-[13px]">Webhook URL for your gateway dashboard (events: <span className="font-mono">payment.captured</span>, <span className="font-mono">payment.failed</span>):</p>
            <p className="mt-1 select-all rounded-sm bg-sunk px-2 py-1.5 font-mono text-xs">{s.webhookUrl}</p>
          </Section>
        )}
      </div>
    </>
  );
}
