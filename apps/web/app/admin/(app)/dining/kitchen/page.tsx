'use client';

import { useState } from 'react';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, money, time } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Order = { id: string; reference: string; status: string; priority: string; typeName: string; restaurantName: string; locationLabel: string; guestName: string | null; specialInstructions: string | null; kitchenNotes: string | null; createdAt: string; scheduledFor: string | null; estimatedReadyAt: string | null; total: number; paymentMode: string; paymentStatus: string; items: { id: string; name: string; quantity: number; options: { group: string; name: string }[]; notes: string | null }[] };
const COLS = [
  { status: 'new', title: 'New', next: 'accepted', action: 'Accept' },
  { status: 'accepted', title: 'Accepted', next: 'preparing', action: 'Start cooking' },
  { status: 'preparing', title: 'Preparing', next: 'ready', action: 'Ready' },
  { status: 'ready', title: 'Ready for pickup / runner', next: 'delivered', action: 'Delivered' },
];

export default function Kitchen() {
  const { data, error, mutate } = useStaff<{ data: Order[] }>('/admin/orders', { refreshInterval: 10_000 });
  const { busy, run } = useAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const move = (id: string, status: string, note?: string) => run(() => staffApi(`/admin/orders/${id}/status`, { body: { status, note } })).then(() => mutate());
  const late = (o: Order) => o.estimatedReadyAt && new Date(o.estimatedReadyAt) < new Date() && o.status !== 'ready';
  return (
    <>
      <PageHeader title="Kitchen" sub="Live orders. The screen refreshes every 10 seconds — keep it open on the pass." actions={<button className="btn" onClick={() => setMenuOpen(true)}>Sold out items</button>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No live orders">New in-room, poolside and takeaway orders land here instantly.</Empty> : (
        <div className="grid min-h-[calc(100dvh-86px)] grid-cols-1 gap-px bg-line md:grid-cols-2 xl:grid-cols-4">
          {COLS.map((c) => {
            const list = data.data.filter((o) => o.status === c.status);
            return (
              <section key={c.status} className="bg-canvas">
                <h2 className="sticky top-0 flex justify-between border-b border-line bg-canvas px-4 py-2 text-xs font-medium text-muted"><span>{c.title}</span><span className="num">{list.length}</span></h2>
                <div className="space-y-2 p-2">
                  {list.map((o) => (
                    <article key={o.id} className={cx('border bg-panel', o.priority === 'rush' ? 'border-bad' : late(o) ? 'border-warn' : 'border-line')}>
                      <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
                        <div>
                          <p className="text-[14px] font-semibold">{o.locationLabel}</p>
                          <p className="text-xs text-muted">{o.typeName} · <span className="font-mono">{o.reference}</span></p>
                        </div>
                        <div className="text-right text-xs">
                          <p className={cx(late(o) && 'font-medium text-warn')}>{o.scheduledFor ? `for ${time(o.scheduledFor)}` : ago(o.createdAt)}</p>
                          {o.priority !== 'normal' && <span className="chip chip-bad">{o.priority}</span>}
                        </div>
                      </header>
                      <ul className="px-3 py-2 text-[13px]">
                        {o.items.map((i) => (
                          <li key={i.id} className="py-0.5"><span className="num mr-2 font-semibold">{i.quantity}×</span>{i.name}
                            {i.options.length > 0 && <span className="block pl-6 text-xs text-muted">{i.options.map((x) => x.name).join(', ')}</span>}
                            {i.notes && <span className="block pl-6 text-xs text-warn">{i.notes}</span>}
                          </li>
                        ))}
                      </ul>
                      {o.specialInstructions && <p className="mx-3 mb-2 border-l-2 border-warn pl-2 text-xs">{o.specialInstructions}</p>}
                      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
                        <span className="text-xs text-muted">{money(o.total)} · {o.paymentMode === 'room_charge' ? 'room charge' : o.paymentStatus.replace('_', ' ')}</span>
                        <span className="flex gap-1">
                          {['new', 'accepted'].includes(o.status) && <button className="btn btn-sm btn-ghost text-bad" disabled={busy} onClick={() => { setCancelling(o); setReason(''); }}>Cancel</button>}
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => move(o.id, c.next)}>{c.action}</button>
                        </span>
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {menuOpen && <SoldOut onClose={() => setMenuOpen(false)} />}
      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.reference ?? ''}?`}
        footer={<><button className="btn" onClick={() => setCancelling(null)}>Keep order</button><button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => move(cancelling!.id, 'cancelled', reason).then(() => setCancelling(null))}>Cancel order</button></>}>
        <Field label="Reason — the guest will see this"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sorry — the prawns have run out tonight" /></Field>
        <p className="hint mt-2">Any room charge for this order is voided automatically.</p>
      </Modal>
    </>
  );
}

function SoldOut({ onClose }: { onClose: () => void }) {
  const { data: outlets } = useStaff<{ data: { id: string; name: string }[] }>('/admin/restaurants');
  const rid = outlets?.data[0]?.id;
  const { data, mutate } = useStaff<{ data: { id: string; name: string; available: boolean; categoryId: string }[] }>(rid ? `/admin/menu-items?restaurantId=${rid}` : null);
  const { run } = useAction();
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <section className="anim-drawer relative h-full w-full max-w-sm overflow-y-auto border-l border-line bg-panel">
        <header className="flex justify-between border-b border-line px-5 py-4"><h2 className="font-semibold">Item availability</h2><button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button></header>
        <ul className="divide-y divide-line">
          {data?.data.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
              <span className={cx(!i.available && 'text-muted line-through')}>{i.name}</span>
              <button className={cx('btn btn-sm', !i.available && 'btn-primary')} onClick={() => run(() => staffApi(`/admin/menu-items/${i.id}/availability`, { method: 'PUT', body: { available: !i.available } }), i.available ? `${i.name} marked sold out` : `${i.name} back on`).then(() => mutate())}>{i.available ? 'Sold out' : 'Back on'}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
