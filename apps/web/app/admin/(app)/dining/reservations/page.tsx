'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Section, Segmented, Status, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { isoToday, time } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type R = { id: string; reference: string; guestName: string; guestPhone: string | null; partySize: number; startsAt: string; endsAt: string; status: string; tableId: string | null; tableLabel: string | null; areaName: string | null; roomNumber: string | null; occasion: string | null; specialRequests: string | null; internalNotes: string | null; source: string; restaurantName: string };
type Table = { id: string; label: string; capacity: number; diningAreaId: string | null };
type Resp = { data: R[]; tables: Table[]; summary: { covers: number; reservations: number; waitlist: number; noShows: number } };
const NEXT: Record<string, { to: string; label: string }[]> = {
  waitlisted: [{ to: 'confirmed', label: 'Seat from waitlist' }, { to: 'cancelled', label: 'Remove' }],
  requested: [{ to: 'confirmed', label: 'Confirm' }, { to: 'cancelled', label: 'Decline' }],
  confirmed: [{ to: 'seated', label: 'Seat' }, { to: 'no_show', label: 'No-show' }, { to: 'cancelled', label: 'Cancel' }],
  seated: [{ to: 'completed', label: 'Finished' }],
};

export default function TableBookings() {
  const { data: outlets } = useStaff<{ data: { id: string; name: string; acceptsReservations: boolean }[] }>('/admin/restaurants');
  const [rid, setRid] = useState('');
  const [day, setDay] = useState(isoToday());
  const [mode, setMode] = useState<'list' | 'floor'>('list');
  useEffect(() => { if (!rid && outlets?.data[0]) setRid(outlets.data.find((o) => o.acceptsReservations)?.id ?? outlets.data[0].id); }, [outlets, rid]);
  const { data, error, mutate } = useStaff<Resp>(rid ? `/admin/reservations?restaurantId=${rid}&date=${day}` : null, { refreshInterval: 30_000 });
  const [open, setOpen] = useState<R | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ time: '20:00', partySize: '2', guestName: '', guestPhone: '', guestEmail: '', occasion: '', specialRequests: '', tableId: '', joinWaitlist: false });
  const { busy, run } = useAction();
  const can = useCan();
  const status = (id: string, s: string, tableId?: string) => run(() => staffApi(`/admin/reservations/${id}/status`, { body: { status: s, tableId } }), 'Updated').then((r) => { if (r) { mutate(); setOpen(null); } });

  const hours = Array.from({ length: 17 }, (_, i) => i + 7);
  return (
    <>
      <PageHeader title="Table bookings"
        sub={data && `${data.summary.reservations} bookings · ${data.summary.covers} covers${data.summary.waitlist ? ` · ${data.summary.waitlist} waitlisted` : ''}${data.summary.noShows ? ` · ${data.summary.noShows} no-show` : ''}`}
        actions={<>
          <select className="input w-44" value={rid} onChange={(e) => setRid(e.target.value)}>{outlets?.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <input className="input w-36" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <Segmented value={mode} onChange={setMode} items={[{ value: 'list', label: 'List' }, { value: 'floor', label: 'Timeline' }]} />
          {can.perm('restaurant.reservations') && <button className="btn btn-primary" onClick={() => setCreating(true)}>New booking</button>}
        </>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No bookings for this day" /> : mode === 'list' ? (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Time</th><th>Guest</th><th className="text-right">Party</th><th>Table</th><th>Notes</th><th>Status</th><th /></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id} className={cx('is-link', ['cancelled', 'no_show'].includes(r.status) && 'opacity-50')} onClick={() => setOpen(r)}>
                <td className="num font-medium">{time(r.startsAt)}</td>
                <td><p className="font-medium">{r.guestName}{r.roomNumber && <span className="font-normal text-muted"> · Room {r.roomNumber}</span>}</p><p className="text-xs text-muted">{r.guestPhone} · {r.source}</p></td>
                <td className="num text-right">{r.partySize}</td>
                <td>{r.tableLabel ?? <span className="text-muted">—</span>} <span className="text-xs text-muted">{r.areaName}</span></td>
                <td className="max-w-64 text-xs">{r.occasion && <span className="chip chip-accent mr-1">{r.occasion}</span>}{r.specialRequests}</td>
                <td><Status value={r.status} /></td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>{(NEXT[r.status] ?? []).slice(0, 1).map((n) => <button key={n.to} className="btn btn-sm" disabled={busy} onClick={() => status(r.id, n.to)}>{n.label}</button>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto bg-panel">
          <div className="min-w-[900px]">
            <div className="grid border-b border-line text-2xs text-muted" style={{ gridTemplateColumns: `80px repeat(${hours.length}, 1fr)` }}>
              <span />{hours.map((h) => <span key={h} className="border-l border-line px-1 py-1">{h}:00</span>)}
            </div>
            {data.tables.map((t) => (
              <div key={t.id} className="relative grid h-11 border-b border-line" style={{ gridTemplateColumns: `80px repeat(${hours.length}, 1fr)` }}>
                <span className="self-center px-3 text-[13px] font-medium">{t.label} <span className="text-2xs text-muted">·{t.capacity}</span></span>
                {hours.map((h) => <span key={h} className="border-l border-line" />)}
                {data.data.filter((r) => r.tableId === t.id && !['cancelled', 'no_show'].includes(r.status)).map((r) => {
                  const start = new Date(r.startsAt); const end = new Date(r.endsAt);
                  const h0 = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(start)) + start.getMinutes() / 60;
                  const dur = (end.getTime() - start.getTime()) / 3_600_000;
                  const left = `calc(80px + (100% - 80px) * ${(h0 - hours[0]!) / hours.length})`;
                  const width = `calc((100% - 80px) * ${dur / hours.length})`;
                  return <button key={r.id} onClick={() => setOpen(r)} className={cx('absolute top-1.5 bottom-1.5 truncate rounded-sm px-2 text-left text-xs', r.status === 'seated' ? 'bg-accent text-white' : 'bg-accent-soft text-accent')} style={{ left, width }}>{r.guestName} · {r.partySize}</button>;
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.guestName ?? ''} sub={open && <>{time(open.startsAt)} · party of {open.partySize} · <span className="font-mono text-xs">{open.reference}</span></>}
        footer={open && (NEXT[open.status] ?? []).map((n) => <button key={n.to} className={n.to === 'confirmed' || n.to === 'seated' ? 'btn btn-primary' : 'btn'} disabled={busy} onClick={() => status(open.id, n.to, n.to === 'confirmed' ? f.tableId || undefined : undefined)}>{n.label}</button>)}>
        {open && (
          <Section>
            <dl className="kv"><dt>Status</dt><dd><Status value={open.status} /></dd><dt>Table</dt><dd>{open.tableLabel ?? '—'} {open.areaName}</dd><dt>Phone</dt><dd>{open.guestPhone ?? '—'}</dd>{open.roomNumber && <><dt>In-house</dt><dd>Room {open.roomNumber}</dd></>}{open.occasion && <><dt>Occasion</dt><dd>{open.occasion}</dd></>}{open.specialRequests && <><dt>Requests</dt><dd>{open.specialRequests}</dd></>}</dl>
            {['confirmed', 'waitlisted', 'requested'].includes(open.status) && data && (
              <Field label="Move to table" className="mt-4">
                <select className="input" defaultValue={open.tableId ?? ''} onChange={(e) => { setF({ ...f, tableId: e.target.value }); if (open.status === 'confirmed' && e.target.value) run(() => staffApi(`/admin/reservations/${open.id}`, { method: 'PATCH', body: { tableId: e.target.value } }), 'Table changed').then(() => mutate()); }}>
                  <option value="">Automatic</option>{data.tables.filter((t) => t.capacity >= open.partySize).map((t) => <option key={t.id} value={t.id}>{t.label} (seats {t.capacity})</option>)}
                </select>
              </Field>
            )}
          </Section>
        )}
      </Drawer>
      <Drawer open={creating} onClose={() => setCreating(false)} title="New table booking"
        footer={<button className="btn btn-primary" disabled={busy || !f.guestName} onClick={() => run(() => staffApi('/admin/reservations', { body: {
          restaurantId: rid, startsAt: new Date(`${day}T${f.time}:00+05:30`).toISOString(), partySize: Number(f.partySize), guestName: f.guestName, guestPhone: f.guestPhone || null, guestEmail: f.guestEmail || null,
          occasion: f.occasion || null, specialRequests: f.specialRequests || null, tableId: f.tableId || null, joinWaitlist: f.joinWaitlist, source: 'phone',
        } }), 'Booked').then((r) => { if (r) { setCreating(false); mutate(); } })}>Book table</button>}>
        <Section>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time"><input className="input" type="time" step={900} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
            <Field label="Party size"><input className="input" type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /></Field>
            <Field label="Name" className="col-span-2"><input className="input" value={f.guestName} onChange={(e) => setF({ ...f, guestName: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" type="tel" value={f.guestPhone} onChange={(e) => setF({ ...f, guestPhone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={f.guestEmail} onChange={(e) => setF({ ...f, guestEmail: e.target.value })} /></Field>
            <Field label="Table"><select className="input" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}><option value="">Best fit</option>{data?.tables.map((t) => <option key={t.id} value={t.id}>{t.label} (seats {t.capacity})</option>)}</select></Field>
            <Field label="Occasion"><input className="input" value={f.occasion} onChange={(e) => setF({ ...f, occasion: e.target.value })} placeholder="Birthday" /></Field>
            <Field label="Requests" className="col-span-2"><textarea className="input" rows={2} value={f.specialRequests} onChange={(e) => setF({ ...f, specialRequests: e.target.value })} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.joinWaitlist} onChange={(e) => setF({ ...f, joinWaitlist: e.target.checked })} /> Add to the waitlist if no table is free</label>
        </Section>
      </Drawer>
    </>
  );
}
