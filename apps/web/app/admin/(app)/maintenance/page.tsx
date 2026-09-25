'use client';

import { useState } from 'react';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Section, Status, Tabs, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, dateTime, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type T = { id: string; reference: string; title: string; description: string | null; category: string; priority: string; severity: string; status: string; locationLabel: string; assignee: string | null; assignedUserId: string | null; reportedByType: string; blocksRoom: boolean; resolution: string | null; createdAt: string; resolvedAt: string | null };
const NEXT: Record<string, string[]> = { open: ['in_progress', 'on_hold'], assigned: ['in_progress', 'on_hold'], in_progress: ['resolved', 'on_hold'], on_hold: ['in_progress'], resolved: ['closed', 'in_progress'], closed: [] };
const CATS = ['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'structural', 'it', 'other'];

export default function Maintenance() {
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const status = tab === 'open' ? 'open,assigned,in_progress,on_hold' : tab === 'resolved' ? 'resolved,closed' : '';
  const { data, error, mutate } = useStaff<{ data: T[] }>(`/admin/maintenance?pageSize=100${status ? `&status=${status}` : '&open=false'}`);
  const { data: staff } = useStaff<{ data: { id: string; name: string }[] }>('/admin/staff-directory');
  const { data: rooms } = useStaff<{ data: { id: string; number: string }[] }>('/admin/rooms');
  const [open, setOpen] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ roomId: '', locationLabel: '', title: '', description: '', category: 'other', priority: 'normal', severity: 'minor', blocksRoom: false });
  const [res, setRes] = useState({ resolution: '', note: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const { busy, run } = useAction();
  const patch = (body: Record<string, unknown>, ok: string) => run(() => staffApi<{ data: T }>(`/admin/maintenance/${open!.id}`, { method: 'PATCH', body }), ok).then((r) => { if (r) { setOpen(r.data); mutate(); } });

  async function create() {
    const r = await run(async () => {
      let attachmentIds: string[] | undefined;
      if (photo) { const fd = new FormData(); fd.append('file', photo); const up = await staffApi<{ data: { id: string } }>('/files?purpose=maintenance', { form: fd }); attachmentIds = [up.data.id]; }
      return staffApi('/admin/maintenance', { body: { ...f, roomId: f.roomId || null, locationLabel: f.locationLabel || undefined, description: f.description || undefined, attachmentIds } });
    }, 'Ticket raised');
    if (r) { setCreating(false); setPhoto(null); mutate(); }
  }
  return (
    <>
      <PageHeader title="Maintenance" actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>Raise ticket</button>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No tickets" /> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Issue</th><th>Location</th><th>Category</th><th>Severity</th><th>Status</th><th>Assigned</th><th>Opened</th></tr></thead>
            <tbody>{data.data.map((t) => (
              <tr key={t.id} className="is-link" onClick={() => { setOpen(t); setRes({ resolution: t.resolution ?? '', note: '' }); }}>
                <td><p className="font-medium">{t.title}</p><p className="font-mono text-xs text-muted">{t.reference} · {t.reportedByType === 'guest' ? 'reported by guest' : 'staff'}</p></td>
                <td>{t.locationLabel}{t.blocksRoom && <span className="chip chip-bad ml-1">Room blocked</span>}</td>
                <td className="text-muted">{human(t.category)}</td>
                <td><Status value={t.severity} /></td>
                <td><Status value={t.status} /></td>
                <td>{t.assignee ?? <span className="text-muted">—</span>}</td>
                <td className="text-xs text-muted">{ago(t.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''} sub={open && <>{open.locationLabel} · <span className="font-mono text-xs">{open.reference}</span></>}
        footer={open && NEXT[open.status]!.map((s) => <button key={s} className={s === 'resolved' ? 'btn btn-primary' : 'btn'} disabled={busy || (s === 'resolved' && !res.resolution.trim())} onClick={() => patch({ status: s, resolution: s === 'resolved' ? res.resolution : undefined }, human(s))}>{s === 'resolved' ? 'Mark resolved' : human(s)}</button>)}>
        {open && (
          <>
            <Section>
              <dl className="kv"><dt>Status</dt><dd><Status value={open.status} /></dd><dt>Category</dt><dd>{human(open.category)}</dd><dt>Opened</dt><dd>{dateTime(open.createdAt)}</dd>{open.resolvedAt && <><dt>Resolved</dt><dd>{dateTime(open.resolvedAt)}</dd></>}</dl>
              {open.description && <p className="mt-3 text-[13px]">{open.description}</p>}
              <TicketPhotos id={open.id} />
            </Section>
            <Section title="Assign & prioritise">
              <div className="grid grid-cols-3 gap-2">
                <select className="input col-span-3" value={open.assignedUserId ?? ''} onChange={(e) => patch({ assignedUserId: e.target.value || null }, 'Assigned')}><option value="">Unassigned</option>{staff?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <select className="input" value={open.priority} onChange={(e) => patch({ priority: e.target.value }, 'Priority updated')}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{human(p)}</option>)}</select>
                <select className="input" value={open.severity} onChange={(e) => patch({ severity: e.target.value }, 'Severity updated')}>{['minor', 'major', 'critical'].map((p) => <option key={p} value={p}>{human(p)}</option>)}</select>
              </div>
            </Section>
            <Section title="Resolution">
              <Field label="What was done"><textarea className="input" rows={3} value={res.resolution} onChange={(e) => setRes({ ...res, resolution: e.target.value })} placeholder="Replaced tap washer and cartridge." /></Field>
              <Field label="Add a note" className="mt-3"><div className="flex gap-2"><input className="input" value={res.note} onChange={(e) => setRes({ ...res, note: e.target.value })} /><button className="btn" disabled={!res.note} onClick={() => patch({ note: res.note }, 'Note added').then(() => setRes({ ...res, note: '' }))}>Add</button></div></Field>
            </Section>
          </>
        )}
      </Drawer>
      <Drawer open={creating} onClose={() => setCreating(false)} title="Raise a maintenance ticket" footer={<button className="btn btn-primary" disabled={busy || !f.title || (!f.roomId && !f.locationLabel)} onClick={create}>Raise ticket</button>}>
        <Section>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room"><select className="input" value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })}><option value="">Not a room</option>{rooms?.data.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}</select></Field>
            <Field label="Or location"><input className="input" disabled={!!f.roomId} value={f.locationLabel} onChange={(e) => setF({ ...f, locationLabel: e.target.value })} placeholder="Pool pump room" /></Field>
            <Field label="Problem" className="col-span-2"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Details" className="col-span-2"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
            <Field label="Severity"><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{['minor', 'major', 'critical'].map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
            <Field label="Photo" className="col-span-2"><input className="input py-1" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
          </div>
          {f.roomId && <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.blocksRoom} onChange={(e) => setF({ ...f, blocksRoom: e.target.checked })} /> Take the room out of service until fixed</label>}
        </Section>
      </Drawer>
    </>
  );
}

function TicketPhotos({ id }: { id: string }) {
  const { data } = useStaff<{ data: { attachments: { id: string; url: string; name: string }[] } }>(`/admin/maintenance/${id}`);
  const a = data?.data.attachments ?? [];
  return a.length ? <div className="mt-3 flex gap-2">{a.map((x) => <a key={x.id} href={x.url} target="_blank" rel="noreferrer"><img src={x.url} alt={x.name} className="h-24 w-24 border border-line object-cover" /></a>)}</div> : null;
}
