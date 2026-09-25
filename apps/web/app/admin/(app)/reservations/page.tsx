'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { BookingDrawer } from '@/components/booking-drawer';
import { NewBooking } from '@/components/new-booking';
import { useCan } from '@/components/admin-context';
import { Empty, ErrorNote, Loading, PageHeader, Pager, SearchInput, Status, Tabs } from '@/components/ui';
import { date, money, nights } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Row = { id: string; reference: string; status: string; paymentStatus: string; checkIn: string; checkOut: string; adults: number; children: number; total: number; amountPaid: number; guestName: string; guestPhone: string | null; roomType: string | null; roomNumber: string | null; source: string };
type Resp = { data: Row[]; meta: { page: number; pages: number; total: number } };
const VIEWS = [
  { value: 'arrivals', label: 'Arrivals' }, { value: 'departures', label: 'Departures' }, { value: 'in_house', label: 'In house' },
  { value: 'upcoming', label: 'Upcoming' }, { value: 'pending_payment', label: 'Awaiting payment' }, { value: 'all', label: 'All' },
] as const;
type View = (typeof VIEWS)[number]['value'];

function Reservations() {
  const sp = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const view = (sp.get('view') as View) ?? 'arrivals';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(sp.get('id'));
  const [creating, setCreating] = useState(false);
  const { data, error, mutate } = useStaff<Resp>(`/admin/bookings?view=${q ? 'all' : view}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHeader title="Reservations" actions={<><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Guest, reference, phone" />{can.perm('bookings.write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>New reservation</button>}</>}>
        <Tabs value={q ? 'all' : view} onChange={(v) => { router.replace(`/admin/reservations?view=${v}`); setPage(1); setQ(''); }} items={VIEWS.map((v) => ({ ...v }))} />
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? (
        <Empty title={q ? 'No reservations match' : `No ${VIEWS.find((v) => v.value === view)?.label.toLowerCase()} right now`}>{view === 'arrivals' ? 'Today’s expected arrivals will appear here.' : undefined}</Empty>
      ) : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Guest</th><th>Room</th><th>Dates</th><th>Status</th><th>Payment</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.id} className="is-link" onClick={() => setOpen(r.id)}>
                  <td><p className="font-medium">{r.guestName}</p><p className="font-mono text-xs text-muted">{r.reference}</p></td>
                  <td>{r.roomNumber ? <strong>{r.roomNumber}</strong> : <span className="text-muted">—</span>} <span className="text-muted">{r.roomType?.split(' — ')[0]}</span></td>
                  <td className="whitespace-nowrap">{date(r.checkIn, 'short')} – {date(r.checkOut, 'short')}<p className="text-xs text-muted">{nights(r.checkIn, r.checkOut)} nights · {r.adults + r.children} guests</p></td>
                  <td><Status value={r.status} /></td>
                  <td><Status value={r.paymentStatus} /></td>
                  <td className="num text-right">{money(r.total)}</td>
                  <td className={`num text-right ${r.total - r.amountPaid > 0 && !['cancelled', 'expired'].includes(r.status) ? 'text-warn' : 'text-muted'}`}>{['cancelled', 'expired'].includes(r.status) ? '—' : money(r.total - r.amountPaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager meta={data.meta} onPage={setPage} />
        </div>
      )}
      <BookingDrawer id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />
      <NewBooking open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); mutate(); setOpen(id); }} />
    </>
  );
}

export default function Page() {
  return <Suspense><Reservations /></Suspense>;
}
