'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Pager, SearchInput, Status, Tabs, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, dateTime, human, money, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type P = { id: string; reference: string; method: string; status: string; amount: number; refundedAmount: number; currency: string; utr: string | null; payerVpa: string | null; proofFileId: string | null; submittedAt: string | null; createdAt: string; expiresAt: string | null; targetType: string; guestName: string | null; guestEmail: string | null; bookingReference: string | null; verifiedBy: string | null; rejectionReason: string | null; metadata: { amountMismatch?: number; needsRefund?: boolean } };
type Resp = { data: P[]; meta: { page: number; pages: number; total: number; pendingVerification: number } };

export default function Payments() {
  const [tab, setTab] = useState<'verify' | 'all' | 'refundable'>('verify');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const status = tab === 'verify' ? 'pending_verification' : tab === 'refundable' ? 'captured,partially_refunded' : '';
  const { data, error, mutate } = useStaff<Resp>(`/admin/payments?page=${page}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { refreshInterval: tab === 'verify' ? 15_000 : 0 });
  const can = useCan();
  const { busy, run } = useAction();
  const [reject, setReject] = useState<P | null>(null);
  const [refund, setRefund] = useState<P | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');

  return (
    <>
      <PageHeader title="Payments" sub="Direct UPI payments are confirmed only after you match the UTR against your bank or UPI app."
        actions={<SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="UTR, reference, guest email" />}>
        <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'verify', label: 'To verify', count: data?.meta.pendingVerification }, { value: 'all', label: 'All payments' }, { value: 'refundable', label: 'Refunds' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? (
        <Empty title={tab === 'verify' ? 'Nothing waiting for verification' : 'No payments'}>{tab === 'verify' ? 'When a guest pays to your UPI ID and submits the UTR, it appears here for you to check.' : undefined}</Empty>
      ) : tab === 'verify' ? (
        <ul className="divide-y divide-line bg-panel">
          {data.data.map((p) => (
            <li key={p.id} className="grid gap-4 px-6 py-4 md:grid-cols-[1fr_auto]">
              <div className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
                <p className="eyebrow sm:col-span-2">{human(p.targetType)} {p.bookingReference && <span className="font-mono normal-case">{p.bookingReference}</span>} · submitted {ago(p.submittedAt)}</p>
                <p className="num text-[22px] font-medium tracking-tight">{money(p.amount)}</p>
                <dl className="kv self-center">
                  <dt>UTR</dt><dd className="font-mono text-[14px] font-medium tracking-wide">{p.utr}</dd>
                  <dt>From</dt><dd>{p.guestName} {p.payerVpa && <span className="text-muted">· {p.payerVpa}</span>}</dd>
                  <dt>Reference</dt><dd className="font-mono text-xs">{p.reference}</dd>
                  {p.proofFileId && <><dt>Screenshot</dt><dd><a className="underline" href={`/api/v1/files/${p.proofFileId}`} target="_blank" rel="noreferrer">Open</a></dd></>}
                  <dt>Decide by</dt><dd>{dateTime(p.expiresAt)}</dd>
                </dl>
              </div>
              {can.perm('payments.verify') && (
                <div className="flex items-start gap-2">
                  <button className="btn btn-danger" disabled={busy} onClick={() => { setReject(p); setReason(''); }}>Not received</button>
                  <button className="btn btn-accent" disabled={busy} onClick={() => run(() => staffApi(`/admin/payments/${p.id}/verify`, { body: { decision: 'approve' } }), `Approved — ${p.bookingReference ?? p.reference} confirmed`).then(() => mutate())}>Received — approve</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Payment</th><th>Guest</th><th>For</th><th>Method</th><th>Status</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>{data.data.map((p) => (
              <tr key={p.id}>
                <td><p className="font-mono text-xs">{p.reference}</p><p className="text-xs text-muted">{dateTime(p.createdAt)}</p>{p.utr && <p className="font-mono text-xs text-muted">UTR {p.utr}</p>}</td>
                <td>{p.guestName}<p className="text-xs text-muted">{p.guestEmail}</p></td>
                <td>{human(p.targetType)} <span className="font-mono text-xs text-muted">{p.bookingReference}</span></td>
                <td>{human(p.method)}</td>
                <td><Status value={p.status} />{p.metadata?.needsRefund && <span className="chip chip-bad ml-1">Refund due</span>}{p.metadata?.amountMismatch && <span className="chip chip-bad ml-1">Amount mismatch</span>}{p.rejectionReason && <p className="mt-1 text-xs text-muted">{p.rejectionReason}</p>}{p.verifiedBy && <p className="mt-1 text-xs text-muted">by {p.verifiedBy}</p>}</td>
                <td className="num text-right">{money(p.amount)}{p.refundedAmount > 0 && <p className="text-xs text-muted">−{money(p.refundedAmount)}</p>}</td>
                <td className="text-right">{can.perm('payments.refund') && ['captured', 'partially_refunded'].includes(p.status) && <button className="btn btn-sm" onClick={() => { setRefund(p); setAmount(String((p.amount - p.refundedAmount) / 100)); setReason(''); }}>Refund</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager meta={data.meta} onPage={setPage} />
        </div>
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title="Payment not found"
        footer={<><button className="btn" onClick={() => setReject(null)}>Back</button><button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => run(() => staffApi(`/admin/payments/${reject!.id}/verify`, { body: { decision: 'reject', reason } }), 'Guest asked to check and resubmit').then((r) => { if (r) { setReject(null); mutate(); } })}>Tell the guest</button></>}>
        <p className="mb-3 text-muted">The guest is emailed your note and can resubmit a corrected UTR. Their room stays held for two more hours.</p>
        <Field label="Message to the guest"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="We couldn’t find a credit for this UTR. Please check the 12-digit reference in your UPI app." /></Field>
      </Modal>
      <Modal open={!!refund} onClose={() => setRefund(null)} title={`Refund ${refund?.reference ?? ''}`}
        footer={<><button className="btn" onClick={() => setRefund(null)}>Back</button><button className="btn btn-primary" disabled={busy || !amount} onClick={() => run(() => staffApi(`/admin/payments/${refund!.id}/refund`, { body: { amount: toMinor(amount), reason: reason || undefined } }), 'Refund recorded').then((r) => { if (r) { setRefund(null); mutate(); } })}>Refund</button></>}>
        <p className="mb-3 text-muted">{refund?.method === 'upi_gateway' ? 'The refund is sent through the gateway to the guest’s UPI account.' : 'Direct UPI and desk payments are refunded by you outside the platform — this records it against the booking.'}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cancellation" /></Field>
        </div>
      </Modal>
    </>
  );
}
