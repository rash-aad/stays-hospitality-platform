'use client';

import Link from 'next/link';
import { useState } from 'react';
import { inr } from '@/components/subscription-bits';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Segmented, Status, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, dateTime, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type P = { id: string; tenantId: string; tenant: string; invoiceNumber: string; invoiceId: string; cycle: string; periodStart: string; periodEnd: string; amount: number; utr: string; proofFileId: string | null; status: string; submittedAt: string; ageHours: number; overdue: boolean; rejectionReason: string | null };

export default function PaymentsQueue() {
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const { data, error, mutate } = useStaff<{ data: P[] }>(`/platform/payments?status=${view}`, { refreshInterval: 30_000 });
  const { busy, run } = useAction();
  const [reject, setReject] = useState<P | null>(null);
  const [reason, setReason] = useState('');
  return (
    <>
      <PageHeader title="Payments to verify" sub="Check each UTR against the bookEZ bank/UPI statement, then approve or reject. Target: within 12 hours.">
        <div className="mt-3"><Segmented value={view} onChange={setView} items={[{ value: 'pending', label: 'Waiting' }, { value: 'all', label: 'All' }]} /></div>
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="Nothing waiting">New UPI payments from properties appear here.</Empty> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl" data-testid="payments-queue">
            <thead><tr><th>Property</th><th>Invoice</th><th className="text-right">Amount</th><th>UTR</th><th>Submitted</th><th>Waiting</th><th /></tr></thead>
            <tbody>{data.data.map((p) => (
              <tr key={p.id} className={cx(p.overdue && p.status === 'pending_verification' && 'bg-bad-soft/60')}>
                <td><Link className="font-medium hover:underline" href={`/platform/tenants/${p.tenantId}`}>{p.tenant}</Link></td>
                <td><a className="font-mono text-xs hover:underline" href={`/platform/invoices/${p.invoiceId}`} target="_blank" rel="noreferrer">{p.invoiceNumber}</a><span className="block text-xs text-muted">{human(p.cycle)} · {date(p.periodStart, 'short')} – {date(p.periodEnd, 'short')}</span></td>
                <td className="num text-right font-medium">{inr(p.amount)}</td>
                <td className="font-mono">{p.utr}{p.proofFileId && <button className="ml-2 font-sans text-xs underline" onClick={async () => { const res = await staffApi<Response>(`/platform/payments/${p.id}/proof`, { raw: true }); window.open(URL.createObjectURL(await res.blob()), '_blank'); }}>screenshot</button>}</td>
                <td className="text-muted">{dateTime(p.submittedAt)}</td>
                <td className={cx('num', p.overdue && p.status === 'pending_verification' && 'font-semibold text-bad')}>{p.status === 'pending_verification' ? `${p.ageHours} h` : <Status value={p.status === 'verified' ? 'paid' : p.status} label={human(p.status)} />}</td>
                <td className="text-right">{p.status === 'pending_verification' && <span className="flex justify-end gap-1">
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => staffApi<{ data: { paidUntil: string; reactivated: boolean } }>(`/platform/payments/${p.id}/approve`, { body: {} })).then((r) => { if (r) { mutate(); } })}>Approve</button>
                  <button className="btn btn-sm" onClick={() => { setReject(p); setReason(''); }}>Reject</button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title={reject ? `Reject ${reject.utr}?` : ''}
        footer={reject && <button className="btn btn-danger" disabled={busy || reason.trim().length < 5} onClick={() => run(() => staffApi(`/platform/payments/${reject.id}/reject`, { body: { reason } }), 'Rejected — the property has been told why').then((r) => { if (r) { setReject(null); mutate(); } })}>Reject payment</button>}>
        <Field label="Reason (shown to the property)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No credit with this UTR in our statement" /></Field>
      </Modal>
    </>
  );
}
