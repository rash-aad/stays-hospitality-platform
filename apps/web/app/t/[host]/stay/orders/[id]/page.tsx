'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { hm, inr, Notice, ORDER_LABEL, PortalPay, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type O = { id: string; reference: string; status: string; locationLabel: string; estimatedReadyAt: string | null; scheduledFor: string | null; subtotal: number; taxTotal: number; total: number; paymentMode: string; paymentStatus: string; cancelledReason: string | null; createdAt: string; items: { id: string; name: string; quantity: number; lineTotal: number; options: { name: string }[] }[]; history: { toValue: string | null; createdAt: string }[] };
const STEPS = ['new', 'accepted', 'preparing', 'ready', 'delivered'];

export default function OrderStatus() {
  const { id } = useParams<{ id: string }>();
  const { data, mutate } = useGuest<{ data: O }>(`/portal/orders/${id}`, { refreshInterval: 10_000 });
  const { data: list } = useGuest<{ data: { id: string; paymentId: string | null }[] }>('/portal/orders');
  const [err, setErr] = useState<string | null>(null);
  const o = data?.data;
  if (!o) return <p className="t-muted">Loading…</p>;
  const payId = list?.data.find((x) => x.id === o.id)?.paymentId;
  const idx = STEPS.indexOf(o.status);
  return (
    <div data-testid="order-status">
      <Title back="/stay" sub={`Order ${o.reference} · ${o.locationLabel}`}>{ORDER_LABEL[o.status] ?? o.status}</Title>
      {o.status === 'cancelled' && <Notice tone="error">This order was cancelled.{o.cancelledReason ? ` ${o.cancelledReason}` : ''}</Notice>}
      {o.status === 'pending_payment' && payId && <section className="mb-8"><PortalPay paymentId={payId} onDone={() => mutate()} /></section>}
      {idx >= 0 && (
        <ol className="mb-8 grid grid-cols-5 gap-1" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s} className="h-1" style={{ background: i <= idx ? 'var(--t-ink)' : 'var(--t-line)' }} title={ORDER_LABEL[s]} />)}
        </ol>
      )}
      {o.estimatedReadyAt && !['delivered', 'completed', 'cancelled'].includes(o.status) && <p className="mb-6">Expected around <strong className="font-medium">{hm(o.estimatedReadyAt)}</strong></p>}
      <ul>
        {o.items.map((i) => <li key={i.id} className="flex justify-between border-b t-line py-3"><span>{i.quantity}× {i.name}{i.options.length > 0 && <span className="block text-sm t-muted">{i.options.map((x) => x.name).join(', ')}</span>}</span><span className="tabular-nums">{inr(i.lineTotal)}</span></li>)}
      </ul>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between t-muted"><dt>Taxes</dt><dd className="tabular-nums">{inr(o.taxTotal)}</dd></div>
        <div className="flex justify-between text-base"><dt>Total</dt><dd className="tabular-nums" data-testid="order-total">{inr(o.total)}</dd></div>
        <div className="flex justify-between t-muted"><dt>Payment</dt><dd>{o.paymentMode === 'room_charge' ? (o.paymentStatus === 'charged_to_room' ? 'Charged to your room' : 'Room charge voided') : o.paymentStatus.replace(/_/g, ' ')}</dd></div>
      </dl>
      {['new', 'pending_payment'].includes(o.status) && (
        <button className="t-btn t-btn-outline mt-8 w-full" onClick={async () => { try { await guestApi(`/portal/orders/${o.id}/cancel`, { method: 'POST' }); mutate(); } catch (e) { setErr((e as Error).message); } }}>Cancel order</button>
      )}
      {err && <Notice tone="error">{err}</Notice>}
      <ol className="mt-8 space-y-1 text-sm t-muted">{o.history.map((h, i) => <li key={i}>{hm(h.createdAt)} · {ORDER_LABEL[h.toValue ?? ''] ?? h.toValue}</li>)}</ol>
    </div>
  );
}
