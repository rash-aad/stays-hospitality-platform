'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, Modal, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Seg = { stayedWithinDays?: number | null; minStays?: number | null; tags?: string[]; country?: string | null };
type C = { id?: string; name: string; subject: string; body: string; segment: Seg; status?: string; recipients?: number; sentAt?: string | null; createdAt?: string };
const EMPTY: C = { name: '', subject: '', body: 'Hello {{firstName}},\n\n', segment: {} };

export default function Campaigns() {
  const can = useCan();
  const write = can.perm('guests.write');
  const { data, error, mutate } = useStaff<{ data: C[] }>('/admin/campaigns', { refreshInterval: 15_000 });
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<C | null>(null);
  const [aud, setAud] = useState<{ count: number; sample: string[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const segBody = (s: Seg) => ({ stayedWithinDays: s.stayedWithinDays || null, minStays: s.minStays || null, tags: s.tags?.filter(Boolean) ?? [], country: s.country || null });
  useEffect(() => {
    if (!edit) return;
    const h = setTimeout(() => { staffApi<{ data: { count: number; sample: string[] } }>('/admin/campaigns/audience', { body: { segment: segBody(edit.segment) } }).then((r) => setAud(r.data)).catch(() => setAud(null)); }, 300);
    return () => clearTimeout(h);
  }, [edit?.segment]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const body = { name: edit!.name, subject: edit!.subject, body: edit!.body, segment: segBody(edit!.segment) };
    const r = await run(() => edit!.id ? staffApi<{ data: C }>(`/admin/campaigns/${edit!.id}`, { method: 'PUT', body }) : staffApi<{ data: C }>('/admin/campaigns', { body }), 'Draft saved');
    if (r) { setEdit({ ...edit!, id: r.data.id }); mutate(); }
    return r?.data.id;
  }
  const readOnly = !!edit?.status && edit.status !== 'draft';
  return (
    <>
      <PageHeader title="Campaigns" sub="Email guests who asked for news and offers. Every email has a one-click unsubscribe." actions={write && <button className="btn btn-primary" onClick={() => { setEdit({ ...EMPTY }); setAud(null); }}>New campaign</button>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No campaigns yet">Welcome back past guests, share a monsoon offer or announce a new restaurant — only guests who opted in are included.</Empty> : (
        <div className="bg-panel"><table className="tbl" data-testid="campaigns"><thead><tr><th>Campaign</th><th>Subject</th><th>Status</th><th className="text-right">Recipients</th><th>Sent</th></tr></thead>
          <tbody>{data.data.map((c) => (
            <tr key={c.id} className="is-link" onClick={() => { setEdit(c); setAud(null); }}><td className="font-medium">{c.name}</td><td className="text-muted">{c.subject}</td><td><Status value={c.status === 'sent' ? 'completed' : c.status === 'sending' ? 'in_progress' : 'pending'} label={c.status} /></td><td className="num text-right">{c.status === 'draft' ? '' : c.recipients}</td><td className="text-muted">{c.sentAt ? dateTime(c.sentAt) : ''}</td></tr>
          ))}</tbody></table></div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'New campaign'} width={640}
        footer={edit && !readOnly && write && <>
          <button className="btn" disabled={busy || !edit.name || !edit.subject} onClick={save}>Save draft</button>
          <button className="btn" disabled={busy || !edit.name || !edit.subject} onClick={async () => { const id = await save(); if (id) await run(() => staffApi(`/admin/campaigns/${id}/test`, { body: {} }), 'Test sent to your email'); }}>Send test to me</button>
          <button className="btn btn-primary" disabled={busy || !edit.name || !edit.subject || !aud?.count} onClick={() => setConfirm(true)}>Send to {aud?.count ?? 0}</button>
        </>}>
        {edit && (
          <div className="space-y-3 p-5">
            <Field label="Name (internal)"><input className="input" disabled={readOnly} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Monsoon offer 2026" /></Field>
            <Field label="Subject"><input className="input" disabled={readOnly} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} placeholder="{{firstName}}, the monsoon is beautiful here" /></Field>
            <Field label="Message" hint="Plain text. {{firstName}} becomes each guest’s first name. The unsubscribe line is added for you."><textarea className="input font-mono text-[13px]" rows={10} disabled={readOnly} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <Section title="Who receives it">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stayed in the last (days)"><input className="input num" type="number" min={1} disabled={readOnly} value={edit.segment.stayedWithinDays ?? ''} onChange={(e) => setEdit({ ...edit, segment: { ...edit.segment, stayedWithinDays: e.target.value ? Number(e.target.value) : null } })} placeholder="any time" /></Field>
                <Field label="At least this many stays"><input className="input num" type="number" min={1} disabled={readOnly} value={edit.segment.minStays ?? ''} onChange={(e) => setEdit({ ...edit, segment: { ...edit.segment, minStays: e.target.value ? Number(e.target.value) : null } })} placeholder="any" /></Field>
                <Field label="Tags (comma-separated)"><input className="input" disabled={readOnly} value={(edit.segment.tags ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, segment: { ...edit.segment, tags: e.target.value.split(',').map((x) => x.trim()) } })} placeholder="VIP, corporate" /></Field>
                <Field label="Country (2-letter)"><input className="input uppercase" maxLength={2} disabled={readOnly} value={edit.segment.country ?? ''} onChange={(e) => setEdit({ ...edit, segment: { ...edit.segment, country: e.target.value.toUpperCase() || null } })} placeholder="any" /></Field>
              </div>
              {readOnly ? <p className="mt-3 text-[13px]">Sent to {edit.recipients} guests{edit.sentAt ? ` on ${dateTime(edit.sentAt)}` : ''}.</p> : <p className="mt-3 text-[13px]" data-testid="audience">{aud ? <><b>{aud.count}</b> opted-in guest{aud.count === 1 ? '' : 's'}{aud.sample.length > 0 && <span className="text-muted"> — {aud.sample.join(', ')}{aud.count > aud.sample.length ? '…' : ''}</span>}</> : 'Counting…'}</p>}
            </Section>
          </div>
        )}
      </Drawer>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Send to ${aud?.count ?? 0} guests?`}
        footer={<><button className="btn" onClick={() => setConfirm(false)}>Not yet</button><button className="btn btn-primary" disabled={busy} onClick={async () => { const id = await save(); if (!id) return; const r = await run(() => staffApi(`/admin/campaigns/${id}/send`, { body: {} }), 'Sending — emails go out over the next few minutes'); if (r) { setConfirm(false); setEdit(null); mutate(); } }}>Send now</button></>}>
        <p className="text-[13px] text-muted">This can’t be undone. Each email includes a one-click unsubscribe link.</p>
      </Modal>
    </>
  );
}
