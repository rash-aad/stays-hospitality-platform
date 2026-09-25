'use client';

import { useState } from 'react';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, Segmented, Status, Tabs, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { dateTime, human, isoToday } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Task = { id: string; kind: string; status: string; priority: string; assignee: string | null; assignedUserId: string | null; notes: string | null; serviceRequestId: string | null };
type Room = { id: string; number: string; floor: string | null; typeName: string; housekeepingStatus: string; status: string; occupancy: string; openTickets: number; notes: string | null; tasks: Task[] };
type Board = { date: string; summary: Record<string, number>; rooms: Room[] };
const NEXT: Record<string, { to: string; label: string }[]> = {
  pending: [{ to: 'in_progress', label: 'Start' }, { to: 'skipped', label: 'Skip (DND)' }],
  in_progress: [{ to: 'done', label: 'Done' }],
  done: [{ to: 'inspected', label: 'Pass inspection' }, { to: 'failed_inspection', label: 'Fail' }],
  failed_inspection: [{ to: 'in_progress', label: 'Redo' }],
};
const ROOM_TONE: Record<string, string> = { clean: 'border-l-ok', inspected: 'border-l-accent', dirty: 'border-l-warn', out_of_service: 'border-l-bad' };

export default function Housekeeping() {
  const [date, setDate] = useState(isoToday());
  const [tab, setTab] = useState<'board' | 'lost'>('board');
  const [filter, setFilter] = useState<'all' | 'dirty' | 'tasks'>('all');
  const { data, error, mutate } = useStaff<{ data: Board }>(`/admin/housekeeping/board?date=${date}`, { refreshInterval: 30_000 });
  const { data: staff } = useStaff<{ data: { id: string; name: string; roles: string[] }[] }>('/admin/staff-directory');
  const [room, setRoom] = useState<Room | null>(null);
  const { busy, run } = useAction();
  const b = data?.data;
  const rooms = b?.rooms.filter((r) => filter === 'all' || (filter === 'dirty' ? r.housekeepingStatus === 'dirty' : r.tasks.some((t) => !['inspected', 'skipped'].includes(t.status)))) ?? [];
  const floors = [...new Set(rooms.map((r) => r.floor ?? '—'))];
  const reload = async () => { const r = await mutate(); if (room) setRoom(r?.data.rooms.find((x) => x.id === room.id) ?? null); };
  return (
    <>
      <PageHeader title="Housekeeping"
        sub={b && `${b.summary.dirty ?? 0} dirty · ${b.summary.clean ?? 0} clean · ${b.summary.inspected ?? 0} inspected · ${b.summary.tasksPending} tasks waiting · ${b.summary.awaitingInspection} to inspect`}
        actions={<><input className="input w-36" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><button className="btn" disabled={busy} onClick={() => run(() => staffApi<{ data: { created: number } }>('/admin/housekeeping/generate', { body: { date } }), 'Stayover cleans generated').then(() => mutate())}>Generate stayovers</button></>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'board', label: 'Room board' }, { value: 'lost', label: 'Lost & found' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {tab === 'lost' ? <LostFound /> : !b ? <Loading /> : (
        <>
          <div className="border-b border-line bg-panel px-6 py-2.5"><Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: 'All rooms' }, { value: 'dirty', label: 'Dirty' }, { value: 'tasks', label: 'With open tasks' }]} /></div>
          {floors.map((fl) => (
            <section key={fl} className="px-6 py-4">
              <h2 className="eyebrow mb-2">Floor {fl}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
                {rooms.filter((r) => (r.floor ?? '—') === fl).map((r) => {
                  const open = r.tasks.filter((t) => !['inspected', 'skipped'].includes(t.status));
                  return (
                    <button key={r.id} onClick={() => setRoom(r)} className={cx('border border-l-4 border-line bg-panel px-3 py-2.5 text-left hover:border-line-strong', ROOM_TONE[r.housekeepingStatus])}>
                      <p className="flex items-baseline justify-between"><span className="num text-[17px] font-semibold">{r.number}</span><span className="text-2xs text-muted">{human(r.occupancy)}</span></p>
                      <p className="text-xs text-muted">{human(r.housekeepingStatus)}</p>
                      {open.length > 0 && <p className="mt-1 truncate text-xs">{open.map((t) => human(t.kind)).join(', ')}</p>}
                      {r.openTickets > 0 && <p className="text-2xs text-bad">{r.openTickets} maintenance</p>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
      <Drawer open={!!room} onClose={() => setRoom(null)} title={room ? `Room ${room.number}` : ''} sub={room && `${room.typeName} · ${human(room.occupancy)}`}>
        {room && (
          <>
            <Section title="Room status">
              <div className="flex flex-wrap gap-1.5">
                {['dirty', 'clean', 'inspected', 'out_of_service'].map((s) => <button key={s} className={cx('btn btn-sm', room.housekeepingStatus === s && 'btn-primary')} disabled={busy} onClick={() => run(() => staffApi(`/admin/housekeeping/rooms/${room.id}/status`, { method: 'PUT', body: { status: s } }), `Room ${room.number} marked ${human(s).toLowerCase()}`).then(() => reload())}>{human(s)}</button>)}
              </div>
              {room.housekeepingStatus === 'out_of_service' && <p className="hint">Out-of-service rooms are removed from sale automatically.</p>}
            </Section>
            <Section title="Tasks today" actions={<button className="btn btn-sm" onClick={() => run(() => staffApi('/admin/housekeeping/tasks', { body: { roomId: room.id, kind: 'touch_up', scheduledFor: date } }), 'Task added').then(() => reload())}>Add touch-up</button>}>
              {room.tasks.length === 0 ? <p className="text-[13px] text-muted">No tasks for this room.</p> : (
                <ul className="space-y-3">
                  {room.tasks.map((t) => (
                    <li key={t.id} className="border border-line p-3">
                      <p className="flex items-center justify-between text-[13px]"><span className="font-medium">{human(t.kind)}{t.serviceRequestId && <span className="font-normal text-muted"> · guest request</span>}</span><Status value={t.status} /></p>
                      {t.notes && <p className="mt-1 text-xs text-muted">{t.notes}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select className="input h-7 w-44" value={t.assignedUserId ?? ''} onChange={(e) => run(() => staffApi(`/admin/housekeeping/tasks/${t.id}`, { method: 'PATCH', body: { assignedUserId: e.target.value || null } }), 'Assigned').then(() => reload())}>
                          <option value="">Unassigned</option>{staff?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {(NEXT[t.status] ?? []).map((n) => <button key={n.to} className={cx('btn btn-sm', (n.to === 'done' || n.to === 'inspected') && 'btn-primary')} disabled={busy} onClick={() => run(() => staffApi(`/admin/housekeeping/tasks/${t.id}/status`, { body: { status: n.to } }), n.label).then(() => reload())}>{n.label}</button>)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Drawer>
    </>
  );
}

function LostFound() {
  const { data, mutate } = useStaff<{ data: { id: string; description: string; locationFound: string | null; foundAt: string; status: string; storageLocation: string | null; notes: string | null; propertyId: string }[] }>('/admin/lost-and-found');
  const { data: props } = useStaff<{ data: { id: string }[] }>('/admin/properties');
  const { run } = useAction();
  const [f, setF] = useState({ description: '', locationFound: '', storageLocation: '' });
  if (!data) return <Loading />;
  return (
    <div className="bg-panel">
      <table className="tbl">
        <thead><tr><th>Item</th><th>Found</th><th>Stored</th><th>Status</th></tr></thead>
        <tbody>{[...data.data].reverse().map((x) => (
          <tr key={x.id}><td className="font-medium">{x.description}<p className="text-xs text-muted">{x.notes}</p></td><td>{x.locationFound}<p className="text-xs text-muted">{dateTime(x.foundAt)}</p></td><td>{x.storageLocation ?? '—'}</td>
            <td><select className="input h-7 w-32" value={x.status} onChange={(e) => run(() => staffApi(`/admin/lost-and-found/${x.id}`, { method: 'PATCH', body: { status: e.target.value, resolvedAt: e.target.value === 'stored' ? null : new Date().toISOString() } }), 'Updated').then(() => mutate())}>{['stored', 'returned', 'claimed', 'disposed'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></td></tr>
        ))}</tbody>
      </table>
      <form className="grid gap-2 px-3 py-3 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/lost-and-found', { body: { ...f, propertyId: props!.data[0]!.id, foundAt: new Date().toISOString() } }), 'Item logged').then(() => { setF({ description: '', locationFound: '', storageLocation: '' }); mutate(); }); }}>
        <Field label="Item"><input className="input" required placeholder="Black Ray-Ban sunglasses" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Where found"><input className="input" placeholder="Room 204, bedside" value={f.locationFound} onChange={(e) => setF({ ...f, locationFound: e.target.value })} /></Field>
        <Field label="Stored at"><input className="input" placeholder="HK office, shelf B" value={f.storageLocation} onChange={(e) => setF({ ...f, storageLocation: e.target.value })} /></Field>
        <button className="btn self-end">Log item</button>
      </form>
    </div>
  );
}
