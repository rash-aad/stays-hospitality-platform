'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, date } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Feed = { id: string; name: string; direction: 'export' | 'import'; roomTypeId: string; roomType: string; url: string | null; exportUrl: string | null; lastSyncAt: string | null; lastError: string | null; held: number; conflicts: number };
type Block = { id: string; uid: string; summary: string | null; startDate: string; endDate: string; status: string };

export default function Channels() {
  const { data, error, mutate } = useStaff<{ data: Feed[] }>('/admin/ical-feeds');
  const { data: types } = useStaff<{ data: { id: string; name: string }[] }>('/admin/room-types?pageSize=100');
  const can = useCan();
  const { busy, run } = useAction();
  const [adding, setAdding] = useState<null | 'export' | 'import'>(null);
  const [form, setForm] = useState({ roomTypeId: '', name: '', url: '' });
  const [open, setOpen] = useState<Feed | null>(null);
  const { data: blocks } = useStaff<{ data: Block[] }>(open ? `/admin/ical-feeds/${open.id}/blocks` : null);
  const edit = can.perm('property.manage');
  const list = data?.data ?? [];
  const add = async () => {
    const r = await run(() => staffApi('/admin/ical-feeds', { body: { direction: adding, roomTypeId: form.roomTypeId, name: form.name, url: adding === 'import' ? form.url : null } }), adding === 'export' ? 'Calendar link created' : 'Channel added');
    if (r) { setAdding(null); setForm({ roomTypeId: '', name: '', url: '' }); mutate(); }
  };
  return (
    <>
      <PageHeader title="Channels (iCal)" sub="Keep Airbnb, Booking.com and other channels in step with your calendar, so a room sold elsewhere can’t be sold here too."
        actions={edit && <><button className="btn" onClick={() => setAdding('export')}>Share our calendar</button><button className="btn btn-primary" onClick={() => setAdding('import')}>Import a channel</button></>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : list.length === 0 ? (
        <Empty title="No channels connected">Create a calendar link for each room type and paste it into the channel, then import the channel’s own calendar link here. Imports refresh every 30 minutes.</Empty>
      ) : (
        <div className="overflow-x-auto bg-panel"><table className="tbl">
          <thead><tr><th>Name</th><th>Room type</th><th>Direction</th><th>Last sync</th><th className="text-right">Held</th><th className="text-right">Conflicts</th><th /></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id} className="is-link" onClick={() => setOpen(f)}>
                <td className="font-medium">{f.name}</td>
                <td>{f.roomType}</td>
                <td>{f.direction === 'export' ? 'Our calendar → channel' : 'Channel → our calendar'}</td>
                <td className="text-muted">{f.direction === 'import' ? (f.lastError ? <span className="text-bad">{f.lastError}</span> : f.lastSyncAt ? ago(f.lastSyncAt) : 'Not yet') : '—'}</td>
                <td className="num text-right">{f.direction === 'import' ? f.held : ''}</td>
                <td className={`num text-right ${f.conflicts ? 'text-bad' : ''}`}>{f.direction === 'import' ? f.conflicts : ''}</td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  {edit && f.direction === 'import' && <button className="btn btn-sm" disabled={busy} onClick={() => run(() => staffApi<{ data: { added: number; removed: number; conflicts: number } }>(`/admin/ical-feeds/${f.id}/sync`, { body: {} })).then((r) => { mutate(); return r; })}>Sync now</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding === 'export' ? 'Share our calendar' : 'Import a channel'}
        footer={<><button className="btn" onClick={() => setAdding(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !form.roomTypeId || !form.name || (adding === 'import' && !form.url)} onClick={add}>{adding === 'export' ? 'Create link' : 'Add'}</button></>}>
        <div className="space-y-3">
          <Field label="Room type"><select className="input" value={form.roomTypeId} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })}><option value="">Choose…</option>{types?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Name" hint={adding === 'export' ? 'Shown as the calendar name in the channel' : 'e.g. Airbnb — Sea view room'}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {adding === 'import' && <Field label="Channel calendar link (https)" hint="Airbnb: Calendar → Availability → Connect calendars → Export. Booking.com: Rates & availability → Sync calendars."><input className="input font-mono" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value.trim() })} placeholder="https://…ics" /></Field>}
        </div>
      </Modal>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} sub={open?.roomType}
        footer={edit && open && <button className="btn btn-danger" disabled={busy} onClick={() => run(() => staffApi(`/admin/ical-feeds/${open.id}`, { method: 'DELETE' }), 'Channel removed').then(() => { setOpen(null); mutate(); })}>Remove{open.direction === 'import' ? ' and release its nights' : ''}</button>}>
        {open?.direction === 'export' ? (
          <Section title="Calendar link">
            <p className="text-[13px] text-muted">Paste this into the channel’s “import calendar” setting. It lists the nights this room type is sold out or closed — no guest details.</p>
            <p className="mt-2 select-all rounded-sm bg-sunk px-2 py-1.5 font-mono text-xs break-all" data-testid="export-url">{open.exportUrl}</p>
          </Section>
        ) : open && (
          <>
            <Section title="Source"><p className="font-mono text-xs break-all">{open.url}</p></Section>
            <Section title="Reservations from this channel">
              {!blocks ? <Loading rows={3} /> : blocks.data.length === 0 ? <p className="text-[13px] text-muted">Nothing imported yet.</p> : (
                <ul className="divide-y divide-line text-[13px]">
                  {blocks.data.map((b) => <li key={b.id} className="flex items-center justify-between py-2"><span>{date(b.startDate)} – {date(b.endDate)}<span className="block text-xs text-muted">{b.summary ?? b.uid}</span></span><Status value={b.status} label={b.status === 'conflict' ? 'Clash — no room left' : 'Room held'} /></li>)}
                </ul>
              )}
              {open.conflicts > 0 && <p className="mt-3 text-[13px] text-bad">A clash means the channel sold nights you had already sold. Move one of the guests, then sync again.</p>}
            </Section>
          </>
        )}
      </Drawer>
    </>
  );
}
