'use client';

import { useState, type ReactNode } from 'react';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';
import { money as fmtMoney, toMajor, toMinor } from '@/lib/format';
import { Drawer, Empty, ErrorNote, Field, Loading, Modal, Section, cx, useAction } from './ui';

export type FieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'money' | 'percent_bps' | 'select' | 'bool' | 'date' | 'time' | 'tags' | 'image' | 'datetime';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
  nullable?: boolean;
  defaultValue?: unknown;
  showIf?: (v: Record<string, unknown>) => boolean;
  /** Type that depends on other values (e.g. money for fixed discounts, number for percentages). */
  typeFor?: (v: Record<string, unknown>) => FieldDef['type'];
};
const typeOf = (f: FieldDef, v: Record<string, unknown>) => f.typeFor?.(v) ?? f.type;
export type Column<T> = { label: string; render: (row: T) => ReactNode; align?: 'right' };

function toForm(fields: FieldDef[], row: Record<string, unknown> | null) {
  const out: Record<string, unknown> = {};
  for (const f0 of fields) {
    const f = { ...f0, type: typeOf(f0, row ?? {}) };
    const v = row?.[f.key] ?? f.defaultValue;
    out[f.key] = f.type === 'money' ? (v == null ? '' : toMajor(v as number))
      : f.type === 'percent_bps' ? (v == null ? '' : String((v as number) / 100))
      : f.type === 'tags' ? ((v as string[] | undefined) ?? []).join(', ')
      : f.type === 'image' ? ((v as { url?: string } | null)?.url ?? (Array.isArray(v) ? (v as { url: string }[])[0]?.url : '') ?? '')
      : f.type === 'datetime' ? (v ? new Date(v as string).toISOString().slice(0, 16) : '')
      : f.type === 'bool' ? v ?? false
      : v ?? '';
  }
  return out;
}

function fromForm(fields: FieldDef[], v: Record<string, unknown>, imageAsArray: Set<string>) {
  const out: Record<string, unknown> = {};
  for (const f0 of fields) {
    const f = { ...f0, type: typeOf(f0, v) };
    if (f.showIf && !f.showIf(v)) continue;
    const x = v[f.key];
    const empty = x === '' || x == null;
    if (empty && !f.nullable && f.type !== 'bool' && f.type !== 'tags') continue;
    out[f.key] = empty ? null
      : f.type === 'money' ? toMinor(x as string)
      : f.type === 'percent_bps' ? Math.round(Number(x) * 100)
      : f.type === 'number' ? Number(x)
      : f.type === 'tags' ? String(x).split(',').map((s) => s.trim()).filter(Boolean)
      : f.type === 'image' ? (imageAsArray.has(f.key) ? [{ url: x, alt: '' }] : { url: x, alt: '' })
      : f.type === 'datetime' ? new Date(x as string).toISOString()
      : f.type === 'time' ? String(x).slice(0, 5)
      : x;
  }
  return out;
}

export function FieldInput({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const common = { className: 'input', required: f.required, value: value as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(e.target.value) };
  switch (f.type) {
    case 'textarea': return <textarea {...common} rows={3} />;
    case 'select': return <select {...common}><option value="">{f.required ? 'Choose…' : '—'}</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    case 'bool': return <label className="flex h-8 items-center gap-2 text-[13px]"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.hint ?? 'Yes'}</label>;
    case 'number': return <input {...common} type="number" className="input num" />;
    case 'money': return <input {...common} inputMode="decimal" className="input num" placeholder="₹" />;
    case 'percent_bps': return <input {...common} inputMode="decimal" className="input num" placeholder="%" />;
    case 'date': return <input {...common} type="date" />;
    case 'time': return <input {...common} type="time" />;
    case 'datetime': return <input {...common} type="datetime-local" />;
    case 'image': return <div className="flex gap-2"><input {...common} type="url" placeholder="https://…" />{!!value && <img src={value as string} alt="" className="h-8 w-12 border border-line object-cover" />}</div>;
    default: return <input {...common} />;
  }
}

/** Generic list + drawer editor over the API's tenant-scoped CRUD endpoints. */
export function Resource<T extends { id: string }>({
  endpoint, query = '', title, noun, fields, columns, extra, canEdit = true, imageArrays = [], emptyText, rowActions, sort,
}: {
  endpoint: string; query?: string; title?: string; noun: string; fields: FieldDef[]; columns: Column<T>[]; extra?: Record<string, unknown>;
  canEdit?: boolean; imageArrays?: string[]; emptyText?: string; rowActions?: (row: T, reload: () => void) => ReactNode; sort?: (a: T, b: T) => number;
}) {
  const { data, error, mutate } = useStaff<{ data: T[] }>(`${endpoint}${query}`);
  const [edit, setEdit] = useState<{ row: T | null; v: Record<string, unknown> } | null>(null);
  const [del, setDel] = useState<T | null>(null);
  const { busy, run } = useAction();
  const arr = new Set(imageArrays);
  const rows = [...(data?.data ?? [])];
  if (sort) rows.sort(sort);
  async function save() {
    const body = { ...fromForm(fields, edit!.v, arr), ...(edit!.row ? {} : extra) };
    const r = await run(() => edit!.row ? staffApi(`${endpoint}/${edit!.row.id}`, { method: 'PATCH', body }) : staffApi(endpoint, { body }), `${noun} saved`);
    if (r) { setEdit(null); mutate(); }
  }
  return (
    <section className="bg-panel">
      {(title || canEdit) && (
        <header className="flex items-center justify-between border-b border-line px-6 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {canEdit && <button className="btn btn-sm" onClick={() => setEdit({ row: null, v: toForm(fields, null) })}>Add {noun.toLowerCase()}</button>}
        </header>
      )}
      <ErrorNote error={error} />
      {!data ? <Loading rows={3} /> : rows.length === 0 ? <Empty title={emptyText ?? `No ${noun.toLowerCase()}s yet`} /> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>{columns.map((c) => <th key={c.label} className={c.align === 'right' ? 'text-right' : ''}>{c.label}</th>)}{rowActions && <th />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={cx(canEdit && 'is-link')} onClick={() => canEdit && setEdit({ row: r, v: toForm(fields, r as unknown as Record<string, unknown>) })}>
                {columns.map((c) => <td key={c.label} className={c.align === 'right' ? 'num text-right' : ''}>{c.render(r)}</td>)}
                {rowActions && <td className="text-right" onClick={(e) => e.stopPropagation()}>{rowActions(r, () => mutate())}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.row ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}
        footer={<>{edit?.row && <button className="btn btn-danger mr-auto" onClick={() => setDel(edit.row)}>Delete</button>}<button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}>
        {edit && (
          <Section>
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              {fields.filter((f) => !f.showIf || f.showIf(edit.v)).map((f) => (
                <Field key={f.key} label={f.label} hint={f.type === 'bool' ? undefined : f.hint} className={f.wide || f.type === 'textarea' ? 'col-span-2' : ''}>
                  <FieldInput f={{ ...f, type: typeOf(f, edit.v) }} value={edit.v[f.key]} onChange={(x) => setEdit({ ...edit, v: { ...edit.v, [f.key]: x } })} />
                </Field>
              ))}
              <button type="submit" className="hidden" />
            </form>
          </Section>
        )}
      </Drawer>
      <Modal open={!!del} onClose={() => setDel(null)} title={`Delete this ${noun.toLowerCase()}?`}
        footer={<><button className="btn" onClick={() => setDel(null)}>Keep</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`${endpoint}/${del!.id}`, { method: 'DELETE' }), `${noun} deleted`).then(() => { setDel(null); setEdit(null); mutate(); })}>Delete</button></>}>
        This can’t be undone. Anything already booked keeps its own copy of the details.
      </Modal>
    </section>
  );
}

export const moneyCol = (m: number | null | undefined) => fmtMoney(m ?? null);
