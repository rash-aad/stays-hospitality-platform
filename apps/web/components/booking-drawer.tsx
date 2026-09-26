'use client';

import { useState } from 'react';
import { staffApi } from '@/lib/api';
import { date, dateTime, human, money, nights, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { useCan } from './admin-context';
import { Drawer, Field, Loading, Modal, Section, Status, useAction } from './ui';

type Detail = {
  booking: { precheckin: null | { arrivalTime: string | null; travellingBy: string | null; nationality: string | null; idType: string | null; idNumberLast4: string | null; idFileId: string | null; address: string | null; purposeOfVisit: string | null; guestNames: string[]; specialRequests: string | null }; precheckinAt: string | null; id: string; reference: string; status: string; paymentStatus: string; checkIn: string; checkOut: string; adults: number; children: number; source: string; currency: string; subtotal: number; discount: number; taxTotal: number; total: number; amountPaid: number; specialRequests: string | null; arrivalTime: string | null; holdExpiresAt: string | null; cancellationFee: number | null; cancellationReason: string | null; createdAt: string };
  guest: { id: string; firstName: string; lastName: string; email: string; phone: string | null; country: string | null; notes: string | null; tags: string[] };
  items: { id: string; kind: string; description: string; quantity: number; amount: number; taxAmount: number }[];
  stay: { status: string; roomNumber: string | null } | null;
  payments: { id: string; reference: string; method: string; status: string; amount: number; refundedAmount: number; utr: string | null; createdAt: string; rejectionReason: string | null }[];
  folio: { id: string; description: string; amount: number; taxAmount: number; createdAt: string; sourceType: string }[];
  invoice: { id: string; number: string; status: string; total: number; amountPaid: number } | null;
  history: { id: string; toValue: string | null; body: string | null; createdAt: string }[];
  assignableRooms: { id: string; number: string; housekeepingStatus: string }[];
};

export function BookingDrawer({ id, onClose, onChanged, onMove }: { id: string | null; onClose: () => void; onChanged: () => void; onMove?: () => void }) {
  const { data, mutate } = useStaff<{ data: Detail }>(id ? `/admin/bookings/${id}` : null);
  const { busy, run } = useAction();
  const can = useCan();
  const [modal, setModal] = useState<null | 'cancel' | 'modify' | 'pay' | 'charge' | 'refund'>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [roomId, setRoomId] = useState('');
  const d = data?.data;
  const b = d?.booking;
  const refresh = () => { mutate(); onChanged(); };
  const act = (path: string, body: unknown, ok: string) => run(() => staffApi(`/admin/bookings/${id}/${path}`, { body }), ok).then((r) => { if (r) { refresh(); setModal(null); } return r; });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const charges = d ? d.folio.reduce((s, c) => s + c.amount + c.taxAmount, 0) : 0;
  const balance = b ? b.total + charges - b.amountPaid : 0;
  const write = can.perm('bookings.write');

  return (
    <Drawer open={!!id} onClose={onClose} width={620}
      title={d ? `${d.guest.firstName} ${d.guest.lastName}` : 'Reservation'}
      sub={b && <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{b.reference}</span><Status value={b.status} /><Status value={b.paymentStatus} /></span>}
      footer={b && write && (
        <>
          {onMove && ['confirmed', 'pending_payment', 'checked_in'].includes(b.status) && <button className="btn" onClick={onMove}>Move / extend</button>}
          {!onMove && b.status === 'confirmed' && <button className="btn" onClick={() => setModal('modify')}>Change dates</button>}
          {['confirmed', 'pending_payment'].includes(b.status) && <button className="btn btn-danger" onClick={() => setModal('cancel')}>Cancel booking</button>}
          {b.status === 'confirmed' && b.checkIn <= new Date().toISOString().slice(0, 10) && <button className="btn" disabled={busy} onClick={() => act('no-show', {}, 'Marked as no-show')}>No-show</button>}
          {b.status === 'confirmed' && (
            <span className="flex gap-1">
              <select className="input w-40" value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room">
                <option value="">Best available room</option>
                {d!.assignableRooms.map((r) => <option key={r.id} value={r.id}>Room {r.number} · {human(r.housekeepingStatus)}</option>)}
              </select>
              <button className="btn btn-primary" disabled={busy} onClick={() => act('check-in', roomId ? { roomId } : {}, 'Checked in')}>Check in</button>
            </span>
          )}
          {b.status === 'checked_in' && <button className="btn btn-primary" disabled={busy} onClick={() => act('check-out', {}, 'Checked out — invoice issued')}>Check out</button>}
        </>
      )}>
      {!d || !b ? <Loading /> : (
        <>
          <Section title="Stay">
            <dl className="kv">
              <dt>Dates</dt><dd>{date(b.checkIn)} → {date(b.checkOut)} <span className="text-muted">· {nights(b.checkIn, b.checkOut)} nights</span></dd>
              <dt>Room</dt><dd>{d.items.find((i) => i.kind === 'room')?.description}{d.stay?.roomNumber && <strong className="ml-2">Room {d.stay.roomNumber}</strong>}</dd>
              <dt>Guests</dt><dd>{b.adults} adult{b.adults > 1 ? 's' : ''}{b.children ? `, ${b.children} child${b.children > 1 ? 'ren' : ''}` : ''}</dd>
              <dt>Source</dt><dd>{human(b.source)} · booked {dateTime(b.createdAt)}</dd>
              {b.arrivalTime && <><dt>Arrival</dt><dd>{b.arrivalTime}</dd></>}
              {b.holdExpiresAt && <><dt>Held until</dt><dd className="text-warn">{dateTime(b.holdExpiresAt)}</dd></>}
              {b.cancellationReason && <><dt>Cancelled</dt><dd>{b.cancellationReason}{b.cancellationFee ? ` · fee ${money(b.cancellationFee)}` : ''}</dd></>}
            </dl>
            {b.specialRequests && <p className="mt-3 border-l-2 border-warn pl-3 text-[13px]">{b.specialRequests}</p>}
          </Section>
          <Section title="Guest">
            <dl className="kv">
              <dt>Email</dt><dd><a className="hover:underline" href={`mailto:${d.guest.email}`}>{d.guest.email}</a></dd>
              <dt>Phone</dt><dd>{d.guest.phone ? <a className="hover:underline" href={`tel:${d.guest.phone}`}>{d.guest.phone}</a> : '—'}</dd>
              {d.guest.notes && <><dt>Notes</dt><dd>{d.guest.notes}</dd></>}
            </dl>
            <div className="mt-3 flex gap-2">
              <a className="btn btn-sm" href={`/admin/guests?id=${d.guest.id}`}>Guest profile</a>
              {write && ['confirmed', 'checked_in'].includes(b.status) && <button className="btn btn-sm" disabled={busy} onClick={() => act('send-access-link', {}, 'Portal link sent to the guest')}>Send portal link</button>}
            </div>
          </Section>
          <Section title="Folio" actions={write && ['confirmed', 'checked_in'].includes(b.status) && <button className="btn btn-sm" onClick={() => { setForm({}); setModal('charge'); }}>Add charge</button>}>
            <table className="w-full text-[13px]">
              <tbody>
                {d.items.map((i) => <tr key={i.id}><td className="py-1">{i.description}{i.kind === 'room' && <span className="text-muted"> × {i.quantity} nights</span>}</td><td className="num py-1 text-right">{money(i.amount)}</td></tr>)}
                {d.folio.map((c) => (
                  <tr key={c.id}><td className="py-1">{c.description} <span className="text-xs text-muted">{dateTime(c.createdAt)}</span></td>
                    <td className="num py-1 text-right">{money(c.amount)}{write && c.sourceType === 'manual' && <button className="ml-2 text-xs text-muted hover:text-bad" onClick={() => run(() => staffApi(`/admin/bookings/${id}/charges/${c.id}`, { method: 'DELETE' }), 'Charge voided').then(refresh)}>void</button>}</td></tr>
                ))}
                {b.discount > 0 && <tr><td className="py-1 text-muted">Discount</td><td className="num py-1 text-right">−{money(b.discount)}</td></tr>}
                <tr><td className="py-1 text-muted">Taxes</td><td className="num py-1 text-right">{money(b.taxTotal + d.folio.reduce((s, c) => s + c.taxAmount, 0))}</td></tr>
                <tr className="border-t border-line font-medium"><td className="pt-2">Total</td><td className="num pt-2 text-right">{money(b.total + charges)}</td></tr>
                <tr><td className="py-1 text-muted">Paid</td><td className="num py-1 text-right">{money(b.amountPaid)}</td></tr>
                <tr className="font-medium"><td>Balance</td><td className={`num text-right ${balance > 0 ? 'text-warn' : ''}`}>{money(balance)}</td></tr>
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-2">
              {write && balance > 0 && !['cancelled', 'expired'].includes(b.status) && <button className="btn btn-sm" onClick={() => { setForm({ amount: String(balance / 100) }); setModal('pay'); }}>Record payment</button>}
              <button className="btn btn-sm" disabled={busy} onClick={() => act('invoice', { issue: false }, 'Invoice updated')}>{d.invoice ? `Refresh ${d.invoice.number}` : 'Draft invoice'}</button>
              {d.invoice && <a className="btn btn-sm" href={`/admin/invoice/${d.invoice.id}`} target="_blank" rel="noreferrer">Open invoice</a>}
            </div>
          </Section>
          {b.precheckin && (
            <Section title="Online check-in" actions={<span className="text-xs text-muted">{b.precheckinAt && dateTime(b.precheckinAt)}</span>}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]" data-testid="precheckin-details">
                {([['Arriving', b.precheckin.arrivalTime], ['By', b.precheckin.travellingBy && human(b.precheckin.travellingBy)], ['Nationality', b.precheckin.nationality], ['Purpose', b.precheckin.purposeOfVisit && human(b.precheckin.purposeOfVisit)],
                  ['ID', b.precheckin.idType && `${human(b.precheckin.idType)} ····${b.precheckin.idNumberLast4 ?? ''}`], ['Address', b.precheckin.address], ['With', b.precheckin.guestNames.join(', ')], ['Requests', b.precheckin.specialRequests]] as const)
                  .filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
              </dl>
              {b.precheckin.idFileId && <p className="mt-2 text-[13px] text-muted">A copy of the ID was uploaded — verify the original at the desk.</p>}
            </Section>
          )}
          <Section title="Payments">
            {d.payments.length === 0 ? <p className="text-[13px] text-muted">No payments yet.</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p>{human(p.method)} · <span className="font-mono text-xs">{p.reference}</span></p>
                      <p className="text-xs text-muted">{dateTime(p.createdAt)}{p.utr && <> · UTR <span className="font-mono">{p.utr}</span></>}{p.rejectionReason && <> · {p.rejectionReason}</>}</p>
                    </div>
                    <div className="text-right"><p className="num">{money(p.amount)}</p><Status value={p.status} />{p.refundedAmount > 0 && <p className="text-xs text-muted">refunded {money(p.refundedAmount)}</p>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {d.history.length > 0 && (
            <Section title="History">
              <ul className="space-y-1 text-[13px]">{d.history.map((h) => <li key={h.id} className="flex gap-3"><span className="w-28 shrink-0 text-xs text-muted">{dateTime(h.createdAt)}</span><span>{h.toValue ? human(h.toValue) : ''} {h.body}</span></li>)}</ul>
            </Section>
          )}
        </>
      )}
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel this booking?"
        footer={<><button className="btn" onClick={() => setModal(null)}>Keep booking</button><button className="btn btn-primary" disabled={busy} onClick={() => act('cancel', { reason: form.reason || undefined, waiveFee: form.waive === '1' }, 'Booking cancelled')}>Cancel booking</button></>}>
        <p className="mb-3 text-muted">The room is released immediately. The rate’s cancellation policy decides any fee; refunds are issued from Payments.</p>
        <Field label="Reason"><input className="input" value={form.reason ?? ''} onChange={set('reason')} placeholder="Guest changed plans" /></Field>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={form.waive === '1'} onChange={(e) => setForm((f) => ({ ...f, waive: e.target.checked ? '1' : '' }))} /> Waive the cancellation fee</label>
      </Modal>
      <Modal open={modal === 'modify'} onClose={() => setModal(null)} title="Change dates or guests"
        footer={<><button className="btn" onClick={() => setModal(null)}>Close</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/bookings/${id}`, { method: 'PATCH', body: { checkIn: form.checkIn || b!.checkIn, checkOut: form.checkOut || b!.checkOut, adults: Number(form.adults || b!.adults), children: Number(form.children ?? b!.children) } }), 'Booking updated — price recalculated').then((r) => { if (r) { refresh(); setModal(null); } })}>Save changes</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrival"><input className="input" type="date" defaultValue={b?.checkIn} onChange={set('checkIn')} /></Field>
          <Field label="Departure"><input className="input" type="date" defaultValue={b?.checkOut} onChange={set('checkOut')} /></Field>
          <Field label="Adults"><input className="input" type="number" min={1} defaultValue={b?.adults} onChange={set('adults')} /></Field>
          <Field label="Children"><input className="input" type="number" min={0} defaultValue={b?.children} onChange={set('children')} /></Field>
        </div>
        <p className="hint mt-3">Availability is re-checked and the stay is re-priced at current rates.</p>
      </Modal>
      <Modal open={modal === 'pay'} onClose={() => setModal(null)} title="Record a payment"
        footer={<><button className="btn" onClick={() => setModal(null)}>Close</button><button className="btn btn-primary" disabled={busy || !form.amount} onClick={() => run(() => staffApi(`/admin/bookings/${id}/payments`, { body: { amount: toMinor(form.amount!), note: form.note || undefined, utr: form.utr || undefined } }), 'Payment recorded').then((r) => { if (r) { refresh(); setModal(null); } })}>Record</button></>}>
        <p className="mb-3 text-muted">For money taken at the desk — cash, card terminal, or UPI paid directly to the property.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><input className="input num" inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} /></Field>
          <Field label="UPI UTR (optional)"><input className="input font-mono" value={form.utr ?? ''} onChange={set('utr')} /></Field>
        </div>
        <Field label="Note" className="mt-3"><input className="input" value={form.note ?? ''} onChange={set('note')} placeholder="Card, terminal 2" /></Field>
      </Modal>
      <Modal open={modal === 'charge'} onClose={() => setModal(null)} title="Add a folio charge"
        footer={<><button className="btn" onClick={() => setModal(null)}>Close</button><button className="btn btn-primary" disabled={busy || !form.description || !form.amount} onClick={() => act('charges', { description: form.description, amount: toMinor(form.amount!), taxAmount: toMinor(form.tax || '0') }, 'Charge added')}>Add</button></>}>
        <Field label="Description"><input className="input" value={form.description ?? ''} onChange={set('description')} placeholder="Minibar — 2 soft drinks" /></Field>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><input className="input num" inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} /></Field>
          <Field label="Tax (₹)"><input className="input num" inputMode="decimal" value={form.tax ?? ''} onChange={set('tax')} /></Field>
        </div>
      </Modal>
    </Drawer>
  );
}
