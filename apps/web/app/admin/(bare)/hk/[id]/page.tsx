'use client';

import { use, useState } from 'react';
import { useCan, useMe } from '@/components/admin-context';
import { ErrorNote, Field, Loading, Modal, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type View = {
  room: { id: string; number: string; floor: string | null; type: string; housekeepingStatus: string; status: string; notes: string | null };
  occupancy: 'vacant' | 'occupied' | 'departing';
  task: null | { id: string; kind: string; status: string; priority: string; notes: string | null; assignee: string | null };
};
const OCC = { vacant: 'Vacant', occupied: 'Guest in room — knock first', departing: 'Departing today' };

/** Phone page opened by scanning the QR on a room: big buttons for the next step. */
export default function RoomScan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const can = useCan();
  const { data, error, mutate } = useStaff<{ data: View }>(`/admin/housekeeping/rooms/${id}/scan`);
  const { busy, run } = useAction();
  const [issue, setIssue] = useState<null | { title: string; category: string; description: string; blocksRoom: boolean }>(null);
  if (!data) return <div className="p-4"><ErrorNote error={error} /><Loading rows={3} /></div>;
  const v = data.data;
  const act = (action: 'start' | 'done' | 'inspected' | 'failed', msg: string) => run(() => staffApi<{ data: View }>(`/admin/housekeeping/rooms/${id}/scan`, { body: { action } }), msg).then((r) => { if (r) mutate(r, { revalidate: false }); });
  const st = v.task?.status;
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-canvas px-4 py-5" data-testid="room-scan">
      <p className="text-[13px] text-muted">{me.tenant.name}</p>
      <h1 className="mt-1 text-3xl font-semibold">Room {v.room.number}</h1>
      <p className="text-[13px] text-muted">{v.room.type}{v.room.floor ? ` · Floor ${v.room.floor}` : ''}</p>
      <div className="mt-4 flex flex-wrap gap-2"><Status value={v.room.housekeepingStatus} /><span className="chip chip-neutral">{OCC[v.occupancy]}</span></div>
      <section className="mt-6 rounded-sm border border-line bg-panel p-4">
        {v.task ? (
          <p className="text-[13px]"><b>{human(v.task.kind)}</b> clean · {human(v.task.status)}{v.task.assignee && ` · ${v.task.assignee}`}{v.task.priority !== 'normal' && ` · ${v.task.priority}`}{v.task.notes && <span className="block text-muted">{v.task.notes}</span>}</p>
        ) : <p className="text-[13px] text-muted">No cleaning scheduled for this room today.</p>}
        <div className="mt-4 grid gap-2">
          {(!st || st === 'pending' || st === 'failed_inspection') && <button className="btn btn-primary btn-lg h-14 justify-center" disabled={busy} onClick={() => act('start', 'Started')}>{st ? 'Start cleaning' : 'Start a touch-up'}</button>}
          {(st === 'in_progress' || st === 'pending') && <button className={`btn btn-lg h-14 justify-center ${st === 'in_progress' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act('done', 'Marked clean')}>Done — room is clean</button>}
          {st === 'done' && can.perm('housekeeping.manage') && (
            <>
              <button className="btn btn-primary btn-lg h-14 justify-center" disabled={busy} onClick={() => act('inspected', 'Inspected — ready to sell')}>Passed inspection</button>
              <button className="btn btn-lg h-14 justify-center" disabled={busy} onClick={() => act('failed', 'Sent back for cleaning')}>Needs another clean</button>
            </>
          )}
        </div>
      </section>
      {me.tenant.modules.includes('maintenance') && <button className="btn btn-lg mt-3 h-12 w-full justify-center" onClick={() => setIssue({ title: '', category: 'other', description: '', blocksRoom: false })}>Report a problem</button>}
      <a className="mt-6 block text-center text-[13px] text-muted underline" href="/admin/housekeeping">Housekeeping board</a>
      <Modal open={!!issue} onClose={() => setIssue(null)} title={`Problem in room ${v.room.number}`}
        footer={issue && <button className="btn btn-primary" disabled={busy || issue.title.trim().length < 3} onClick={() => run(() => staffApi(`/admin/housekeeping/rooms/${id}/issue`, { body: { ...issue, description: issue.description || undefined } }), 'Reported to maintenance').then((r) => { if (r) { setIssue(null); mutate(); } })}>Report</button>}>
        {issue && (
          <div className="space-y-3">
            <Field label="What’s wrong?"><input className="input" value={issue.title} onChange={(e) => setIssue({ ...issue, title: e.target.value })} placeholder="Shower mixer leaking" /></Field>
            <Field label="Type"><select className="input" value={issue.category} onChange={(e) => setIssue({ ...issue, category: e.target.value })}>{['plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural', 'it', 'other'].map((c) => <option key={c} value={c}>{c === 'hvac' ? 'AC / heating' : c === 'it' ? 'TV / Wi-Fi' : human(c)}</option>)}</select></Field>
            <Field label="Details (optional)"><textarea className="input" rows={3} value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={issue.blocksRoom} onChange={(e) => setIssue({ ...issue, blocksRoom: e.target.checked })} /> Room can’t be sold until fixed</label>
          </div>
        )}
      </Modal>
    </main>
  );
}
