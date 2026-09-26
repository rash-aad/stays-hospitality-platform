'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Pager, SearchInput, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Row = { id: string; firstName: string; lastName: string; email: string; phone: string | null; country: string | null; tags: string[]; hasAccount: boolean; stays: number; revenue: number; lastStay: string | null };
type Detail = { guest: Row & { notes: string | null; marketingOptIn: boolean }; bookings: { id: string; reference: string; checkIn: string; checkOut: string; status: string; total: number }[]; orders: { id: string; reference: string; total: number; status: string; createdAt: string }[]; requests: { id: string; title: string; status: string; createdAt: string }[]; reservations: { id: string; startsAt: string; partySize: number; status: string }[] };

function GuestDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, mutate } = useStaff<{ data: Detail }>(id ? `/admin/guests/${id}` : null);
  const can = useCan();
  const { busy, run } = useAction();
  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState<string | null>(null);
  const d = data?.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? `${d.guest.firstName} ${d.guest.lastName}` : 'Guest'} sub={d?.guest.email}
      footer={can.perm('guests.write') && d && <><button className="btn btn-danger mr-auto" disabled={busy} onClick={() => { if (confirmErase !== id) return setConfirmErase(id); run(() => staffApi(`/admin/guests/${id}/anonymize`, { body: {} }), 'Personal data erased').then((r) => { setConfirmErase(null); if (r) mutate(); }); }}>{confirmErase === id ? 'Click again to erase' : 'Erase personal data'}</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/guests/${id}`, { method: 'PATCH', body: { notes: notes ?? d.guest.notes, tags: (tags ?? d.guest.tags.join(', ')).split(',').map((t) => t.trim()).filter(Boolean) } }), 'Guest saved').then(() => mutate())}>Save notes</button></>}>
      {!d ? <Loading /> : (
        <>
          <Section title="Profile">
            <dl className="kv"><dt>Phone</dt><dd>{d.guest.phone ?? '—'}</dd><dt>Country</dt><dd>{d.guest.country ?? '—'}</dd><dt>Portal account</dt><dd>{d.guest.hasAccount ? 'Yes' : 'No'}</dd><dt>Marketing</dt><dd>{d.guest.marketingOptIn ? 'Opted in' : 'No'}</dd></dl>
            <Field label="Tags" hint="Comma separated — e.g. VIP, returning, vegetarian" className="mt-4"><input className="input" defaultValue={d.guest.tags.join(', ')} onChange={(e) => setTags(e.target.value)} /></Field>
            <Field label="Private notes" className="mt-3"><textarea className="input" rows={3} defaultValue={d.guest.notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Preferences, allergies, occasions" /></Field>
          </Section>
          <Section title={`Stays (${d.bookings.length})`}>
            <ul className="divide-y divide-line text-[13px]">{d.bookings.map((b) => <li key={b.id} className="flex justify-between py-1.5"><a className="hover:underline" href={`/admin/reservations?view=all&id=${b.id}`}>{date(b.checkIn, 'short')} – {date(b.checkOut)} <span className="font-mono text-xs text-muted">{b.reference}</span></a><span className="flex items-center gap-2"><span className="num">{money(b.total)}</span><Status value={b.status} /></span></li>)}</ul>
          </Section>
          {d.orders.length > 0 && <Section title="Recent orders"><ul className="text-[13px]">{d.orders.map((o) => <li key={o.id} className="flex justify-between py-1"><span>{o.reference} · {dateTime(o.createdAt)}</span><span className="num">{money(o.total)}</span></li>)}</ul></Section>}
          {d.requests.length > 0 && <Section title="Recent requests"><ul className="text-[13px]">{d.requests.map((r) => <li key={r.id} className="flex justify-between py-1"><span>{r.title} · {dateTime(r.createdAt)}</span><Status value={r.status} /></li>)}</ul></Section>}
        </>
      )}
    </Drawer>
  );
}

function Guests() {
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(sp.get('id'));
  const { data, error } = useStaff<{ data: Row[]; meta: { page: number; pages: number; total: number } }>(`/admin/guests?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHeader title="Guests" sub="Everyone who has stayed, booked or written to you." actions={<SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, email or phone" />} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No guests found" /> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Contact</th><th>Tags</th><th className="text-right">Stays</th><th className="text-right">Revenue</th><th>Last stay</th></tr></thead>
            <tbody>{data.data.map((g) => (
              <tr key={g.id} className="is-link" onClick={() => setOpen(g.id)}>
                <td className="font-medium">{g.firstName} {g.lastName}</td>
                <td><p>{g.email}</p><p className="text-xs text-muted">{g.phone}</p></td>
                <td>{g.tags.map((t) => <span key={t} className="chip chip-neutral mr-1">{t}</span>)}</td>
                <td className="num text-right">{g.stays}</td>
                <td className="num text-right">{money(g.revenue)}</td>
                <td className="text-muted">{g.lastStay ? date(g.lastStay) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager meta={data.meta} onPage={setPage} />
        </div>
      )}
      <GuestDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}
export default function Page() { return <Suspense><Guests /></Suspense>; }
