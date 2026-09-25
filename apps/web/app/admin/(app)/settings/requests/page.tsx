'use client';

import { useState } from 'react';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type FF = { key: string; label: string; type: string; required?: boolean; options?: string[] };
type T = { id: string; key: string; name: string; description: string | null; category: string; moduleKey: string; routesTo: string; defaultPriority: string; slaMinutes: number; requiresStay: boolean; guestVisible: boolean; formSchema: FF[]; active: boolean; sort: number };
const CATS = ['housekeeping', 'maintenance', 'concierge', 'room_service', 'front_desk', 'transport', 'spa', 'activities', 'dining'];
const MODS = ['housekeeping', 'maintenance', 'concierge', 'room_service', 'transport', 'spa', 'experiences', 'guest_portal'];

export default function RequestTypes() {
  const { data, error, mutate } = useStaff<{ data: T[] }>('/admin/request-types');
  const [e, setE] = useState<Partial<T> | null>(null);
  const { busy, run } = useAction();
  const blank: Partial<T> = { key: '', name: '', category: 'concierge', moduleKey: 'concierge', routesTo: 'none', defaultPriority: 'normal', slaMinutes: 30, requiresStay: true, guestVisible: true, formSchema: [], active: true, sort: 0 };
  const setField = (i: number, patch: Partial<FF>) => setE({ ...e!, formSchema: e!.formSchema!.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <>
      <PageHeader title="Request types" sub="What guests can ask for, which team gets it, and how fast you aim to respond." actions={<button className="btn btn-primary" onClick={() => setE(blank)}>New request type</button>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <div className="bg-panel">
          <table className="tbl">
            <thead><tr><th>Request</th><th>Team</th><th>Goes to</th><th className="text-right">Target</th><th>Guests see it</th><th>Active</th></tr></thead>
            <tbody>{[...data.data].sort((a, b) => a.sort - b.sort).map((t) => (
              <tr key={t.id} className="is-link" onClick={() => setE(t)}>
                <td className="font-medium">{t.name}<p className="text-xs font-normal text-muted">{t.formSchema.length ? `${t.formSchema.length} questions` : 'No extra questions'}{t.requiresStay ? ' · in-house only' : ''}</p></td>
                <td>{human(t.category)}</td><td>{t.routesTo === 'none' ? 'Request queue' : human(t.routesTo)}</td>
                <td className="num text-right">{t.slaMinutes < 60 ? `${t.slaMinutes} min` : `${t.slaMinutes / 60} h`}</td><td>{t.guestVisible ? 'Yes' : 'Staff only'}</td><td>{t.active ? 'Yes' : 'No'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!e} onClose={() => setE(null)} title={e?.id ? e.name! : 'New request type'} width={640}
        footer={e && <button className="btn btn-primary" disabled={busy || !e.name || !e.key} onClick={() => {
          const { id, ...b } = e as T;
          const body = { key: b.key, name: b.name, description: b.description || null, category: b.category, moduleKey: b.moduleKey, routesTo: b.routesTo, defaultPriority: b.defaultPriority, slaMinutes: Number(b.slaMinutes), requiresStay: b.requiresStay, guestVisible: b.guestVisible, formSchema: b.formSchema.map((f) => ({ ...f, options: f.type === 'select' ? f.options : undefined })), active: b.active, sort: Number(b.sort) };
          run(() => id ? staffApi(`/admin/request-types/${id}`, { method: 'PATCH', body }) : staffApi('/admin/request-types', { body }), 'Request type saved').then((r) => { if (r) { setE(null); mutate(); } });
        }}>Save</button>}>
        {e && (
          <>
            <Section>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><input className="input" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value, key: e.id ? e.key : x.target.value.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '') })} /></Field>
                <Field label="Key" hint="Used internally"><input className="input font-mono" disabled={!!e.id} value={e.key} onChange={(x) => setE({ ...e, key: x.target.value })} /></Field>
                <Field label="Description" className="col-span-2"><input className="input" value={e.description ?? ''} onChange={(x) => setE({ ...e, description: x.target.value })} /></Field>
                <Field label="Team"><select className="input" value={e.category} onChange={(x) => setE({ ...e, category: x.target.value })}>{CATS.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
                <Field label="Requires module"><select className="input" value={e.moduleKey} onChange={(x) => setE({ ...e, moduleKey: x.target.value })}>{MODS.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
                <Field label="Also create"><select className="input" value={e.routesTo} onChange={(x) => setE({ ...e, routesTo: x.target.value })}><option value="none">Nothing — request queue only</option><option value="housekeeping_task">A housekeeping task</option><option value="maintenance_ticket">A maintenance ticket</option></select></Field>
                <Field label="Target response (minutes)"><input className="input num" type="number" min={5} value={e.slaMinutes} onChange={(x) => setE({ ...e, slaMinutes: Number(x.target.value) })} /></Field>
                <Field label="Default priority"><select className="input" value={e.defaultPriority} onChange={(x) => setE({ ...e, defaultPriority: x.target.value })}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{human(p)}</option>)}</select></Field>
                <Field label="Order"><input className="input num" type="number" value={e.sort} onChange={(x) => setE({ ...e, sort: Number(x.target.value) })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-5 text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!e.requiresStay} onChange={(x) => setE({ ...e, requiresStay: x.target.checked })} /> Only for checked-in guests</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!e.guestVisible} onChange={(x) => setE({ ...e, guestVisible: x.target.checked })} /> Guests can request it</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} /> Active</label>
              </div>
            </Section>
            <Section title="Questions for the guest" actions={<button className="btn btn-sm" onClick={() => setE({ ...e, formSchema: [...(e.formSchema ?? []), { key: `q${(e.formSchema?.length ?? 0) + 1}`, label: '', type: 'text' }] })}>Add question</button>}>
              {!e.formSchema?.length && <p className="text-[13px] text-muted">Guests just describe what they need.</p>}
              <ul className="space-y-3">
                {e.formSchema?.map((f, i) => (
                  <li key={i} className="grid grid-cols-[1fr_130px_auto_auto] items-start gap-2">
                    <input className="input" placeholder="Question, e.g. Flight number" value={f.label} onChange={(x) => setField(i, { label: x.target.value, key: x.target.value.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || f.key })} />
                    <select className="input" value={f.type} onChange={(x) => setField(i, { type: x.target.value })}>{['text', 'textarea', 'number', 'datetime', 'time', 'select'].map((t) => <option key={t} value={t}>{human(t)}</option>)}</select>
                    <label className="flex h-8 items-center gap-1 text-xs"><input type="checkbox" checked={!!f.required} onChange={(x) => setField(i, { required: x.target.checked })} />Required</label>
                    <button className="btn btn-sm btn-ghost" onClick={() => setE({ ...e, formSchema: e.formSchema!.filter((_, j) => j !== i) })}>Remove</button>
                    {f.type === 'select' && <input className="input col-span-4" placeholder="Choices, comma separated" value={(f.options ?? []).join(', ')} onChange={(x) => setField(i, { options: x.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </Drawer>
    </>
  );
}
