'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { useMe } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Pager, SearchInput, Section, Status, Tabs, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, dateTime, human, until } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Req = { id: string; reference: string; title: string; description: string | null; category: string; typeName: string; status: string; priority: string; roomNumber: string | null; guestName: string | null; assignee: string | null; assignedUserId: string | null; dueAt: string | null; overdue: boolean; createdAt: string; source: string; statuses: { key: string; label: string }[] };
type Detail = { request: Req & { details: Record<string, unknown> }; type: { name: string; formSchema: { key: string; label: string }[] }; nextStatuses: string[]; workflow: { statuses: { key: string; label: string }[] }; events: { id: string; kind: string; visibility: string; toValue: string | null; fromValue: string | null; body: string | null; actorName: string | null; actorType: string; createdAt: string }[]; attachments: { id: string; name: string; url: string; mime: string }[] };
type View = 'open' | 'mine' | 'overdue' | 'all';

function Requests() {
  const sp = useSearchParams();
  const [view, setView] = useState<View>((sp.get('view') as View) ?? 'open');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, mutate } = useStaff<{ data: Req[]; meta: { page: number; pages: number; total: number } }>(`/admin/requests?view=${view}&page=${page}${cat ? `&category=${cat}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { refreshInterval: 20_000 });
  return (
    <>
      <PageHeader title="Guest requests" sub="Everything guests ask for, in one queue — sorted by priority, then by time left."
        actions={<><select className="input w-40" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All teams</option>{['housekeeping', 'maintenance', 'front_desk', 'concierge', 'transport', 'room_service', 'spa', 'activities'].map((c) => <option key={c} value={c}>{human(c)}</option>)}</select><SearchInput value={q} onChange={setQ} placeholder="Reference, room, request" /></>}>
        <Tabs value={view} onChange={(v) => { setView(v); setPage(1); }} items={[{ value: 'open', label: 'Open' }, { value: 'mine', label: 'Assigned to me' }, { value: 'overdue', label: 'Overdue' }, { value: 'all', label: 'All' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title={view === 'overdue' ? 'Nothing overdue' : 'No requests here'}>Requests from the guest portal and staff land here.</Empty> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Request</th><th>Room / guest</th><th>Team</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Due</th></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id} className="is-link" onClick={() => setOpen(r.id)}>
                <td><p className="font-medium">{r.title}</p><p className="max-w-80 truncate text-xs text-muted">{r.description ?? r.reference}</p></td>
                <td>{r.roomNumber ? <strong>{r.roomNumber}</strong> : '—'} <span className="text-muted">{r.guestName}</span></td>
                <td className="text-muted">{human(r.category)}</td>
                <td><Status value={r.priority} /></td>
                <td><Status value={r.status} label={r.statuses.find((s) => s.key === r.status)?.label} /></td>
                <td className={cx(!r.assignee && 'text-muted')}>{r.assignee ?? 'Unassigned'}</td>
                <td className={cx('whitespace-nowrap text-xs', r.overdue ? 'font-medium text-bad' : 'text-muted')}>{['resolved', 'cancelled', 'closed'].includes(r.status) ? ago(r.createdAt) : until(r.dueAt)}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager meta={data.meta} onPage={setPage} />
        </div>
      )}
      <RequestDrawer id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />
    </>
  );
}

function RequestDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const { data, mutate } = useStaff<{ data: Detail }>(id ? `/admin/requests/${id}` : null);
  const { data: staff } = useStaff<{ data: { id: string; name: string }[] }>(id ? '/admin/staff-directory' : null);
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const [vis, setVis] = useState<'internal' | 'guest'>('guest');
  const d = data?.data;
  const done = () => { mutate(); onChanged(); };
  const label = (k: string | null) => d?.workflow.statuses.find((s) => s.key === k)?.label ?? human(k);
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.request.title ?? 'Request'} sub={d && <span className="flex items-center gap-2"><span className="font-mono text-xs">{d.request.reference}</span><Status value={d.request.status} label={label(d.request.status)} /><Status value={d.request.priority} /></span>}
      footer={d && d.nextStatuses.map((s) => <button key={s} className={s === 'resolved' ? 'btn btn-primary' : 'btn'} disabled={busy} onClick={() => run(() => staffApi(`/admin/requests/${id}/status`, { body: { status: s } }), `Marked ${label(s).toLowerCase()}`).then(done)}>{label(s)}</button>)}>
      {!d ? <Loading /> : (
        <>
          <Section>
            <dl className="kv">
              <dt>Room</dt><dd>{d.request.roomNumber ?? '—'}</dd>
              <dt>From</dt><dd>{d.request.source === 'guest' ? 'Guest portal' : 'Staff'} · {dateTime(d.request.createdAt)}</dd>
              <dt>Target</dt><dd className={cx(d.request.overdue && 'text-bad')}>{dateTime(d.request.dueAt)} ({until(d.request.dueAt)})</dd>
              {d.type.formSchema.map((f) => d.request.details[f.key] != null && <Fragment key={f.key}><dt>{f.label}</dt><dd>{String(d.request.details[f.key]).includes('T') && !Number.isNaN(Date.parse(String(d.request.details[f.key]))) ? dateTime(String(d.request.details[f.key])) : String(d.request.details[f.key])}</dd></Fragment>)}
            </dl>
            {d.request.description && <p className="mt-3 border-l-2 border-line-strong pl-3 text-[13px]">{d.request.description}</p>}
            {d.attachments.length > 0 && <div className="mt-3 flex gap-2">{d.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer">{a.mime.startsWith('image/') ? <img src={a.url} alt={a.name} className="h-20 w-20 border border-line object-cover" /> : <span className="btn btn-sm">{a.name}</span>}</a>)}</div>}
          </Section>
          <Section title="Assignment">
            <div className="flex gap-2">
              <select className="input" value={d.request.assignedUserId ?? ''} onChange={(e) => run(() => staffApi(`/admin/requests/${id}/assign`, { body: { userId: e.target.value || null } }), 'Assigned').then(done)}>
                <option value="">Unassigned</option>{staff?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {d.request.assignedUserId !== me.user.id && <button className="btn" onClick={() => run(() => staffApi(`/admin/requests/${id}/assign`, { body: { userId: me.user.id } }), 'Assigned to you').then(done)}>Take it</button>}
              <select className="input w-32" value={d.request.priority} onChange={(e) => run(() => staffApi(`/admin/requests/${id}`, { method: 'PATCH', body: { priority: e.target.value } }), 'Priority changed').then(done)}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{human(p)}</option>)}</select>
            </div>
          </Section>
          <Section title="Activity">
            <ul className="space-y-2.5 text-[13px]">
              {d.events.map((e) => (
                <li key={e.id} className={cx('grid grid-cols-[92px_1fr] gap-3', e.kind === 'note' && e.visibility === 'internal' && 'rounded-sm bg-warn-soft/50 py-1')}>
                  <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
                  <span>
                    <span className="text-muted">{e.actorName ?? (e.actorType === 'system' ? 'System' : '')} </span>
                    {e.kind === 'created' && 'created the request'}
                    {e.kind === 'status' && <>moved it to <strong>{label(e.toValue)}</strong></>}
                    {e.kind === 'assignment' && (e.toValue ? 'assigned it' : 'unassigned it')}
                    {e.kind === 'priority' && <>changed priority to <strong>{e.toValue}</strong>{e.body && ` — ${e.body}`}</>}
                    {e.kind === 'attachment' && 'attached a photo'}
                    {e.kind === 'note' && <><span className="text-2xs uppercase text-muted">{e.visibility === 'internal' ? 'internal note' : 'to guest'}</span><br />{e.body}</>}
                  </span>
                </li>
              ))}
            </ul>
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); run(() => staffApi(`/admin/requests/${id}/notes`, { body: { body: note, visibility: vis } }), vis === 'guest' ? 'Sent to guest' : 'Note added').then(() => { setNote(''); done(); }); }}>
              <Field label={vis === 'guest' ? 'Message to the guest' : 'Internal note (staff only)'}><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="mt-2 flex justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={vis === 'internal'} onChange={(e) => setVis(e.target.checked ? 'internal' : 'guest')} /> Internal only</label><button className="btn btn-sm" disabled={!note.trim() || busy}>{vis === 'guest' ? 'Send' : 'Add note'}</button></div>
            </form>
          </Section>
        </>
      )}
    </Drawer>
  );
}

export default function Page() { return <Suspense><Requests /></Suspense>; }
