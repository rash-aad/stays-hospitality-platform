'use client';

import { SECTION_SCHEMAS, type SectionType } from '@hp/contracts';
import type { ReactNode } from 'react';

/* A small Zod-4 introspection layer: the inspector is generated from the same schema the API validates. */
type Z = { def: { type: string; innerType?: Z; in?: Z; element?: Z; entries?: Record<string, string>; shape?: Record<string, Z> }; shape?: Record<string, Z>; options?: string[]; maxLength?: number | null; minValue?: number | null; maxValue?: number | null };
function unwrap(z: Z): { z: Z; optional: boolean } {
  let optional = false;
  let cur = z;
  for (;;) {
    const t = cur.def.type;
    if (t === 'optional' || t === 'nullable') { optional = true; cur = cur.def.innerType!; }
    else if (t === 'default') cur = cur.def.innerType!;
    else if (t === 'pipe') cur = cur.def.in!;
    else return { z: cur, optional };
  }
}
const isImage = (z: Z) => z.def.type === 'object' && !!z.shape?.url && !!z.shape?.alt;
const isCta = (z: Z) => z.def.type === 'object' && !!z.shape?.label && !!z.shape?.href;
const LABEL: Record<string, string> = { heading: 'Heading', subheading: 'Subheading', eyebrow: 'Small line above', body: 'Text', intro: 'Intro', image: 'Photo', images: 'Photos', layout: 'Layout', overlay: 'Photo darkening', primaryCta: 'Main button', secondaryCta: 'Second button', showBookingBar: 'Show booking bar', align: 'Alignment', tone: 'Background', cta: 'Button', limit: 'How many', note: 'Note', showHours: 'Show opening hours', showPrices: 'Show prices', showDietary: 'Show dietary marks', items: 'Items', columns: 'Columns', imageSide: 'Photo side', directions: 'Directions', showMap: 'Show map', primary: 'Main button', secondary: 'Second button', topics: 'Enquiry topics', blocks: 'Content', width: 'Width', signature: 'Signature', address: 'Address override', kinds: 'Experience types' };
const lbl = (k: string) => LABEL[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-3"><p className="label">{label}</p>{children}</div>;
}

function Value({ k, z, v, set }: { k: string; z: Z; v: unknown; set: (v: unknown) => void }): ReactNode {
  const { z: s, optional } = unwrap(z);
  const t = s.def.type;
  if (k.endsWith('Ids') || k === 'restaurantId') return null; // data-bound pickers are automatic
  if (isImage(s)) {
    const img = (v ?? {}) as { url?: string; alt?: string };
    return (
      <Row label={lbl(k)}>
        {img.url && <img src={img.url} alt="" className="mb-1.5 aspect-[16/9] w-full border border-line object-cover" />}
        <input className="input mb-1" placeholder="https://… image URL" value={img.url ?? ''} onChange={(e) => set(e.target.value ? { url: e.target.value, alt: img.alt ?? '' } : optional ? undefined : { url: '', alt: '' })} />
        <input className="input" placeholder="Describe the photo (alt text)" value={img.alt ?? ''} onChange={(e) => set({ url: img.url ?? '', alt: e.target.value })} />
      </Row>
    );
  }
  if (isCta(s)) {
    const c = (v ?? {}) as { label?: string; href?: string };
    return (
      <Row label={lbl(k)}>
        <div className="grid grid-cols-2 gap-1.5">
          <input className="input" placeholder="Label" value={c.label ?? ''} onChange={(e) => set(e.target.value || c.href ? { label: e.target.value, href: c.href ?? '/' } : optional ? undefined : { label: '', href: '/' })} />
          <input className="input" placeholder="/book or https://…" value={c.href ?? ''} onChange={(e) => set({ label: c.label ?? '', href: e.target.value })} />
        </div>
        {optional && v != null && <button className="mt-1 text-xs text-muted hover:text-bad" onClick={() => set(undefined)}>Remove button</button>}
      </Row>
    );
  }
  if (t === 'string') {
    const long = (s.maxLength ?? 0) > 300;
    return <Row label={lbl(k)}>{long ? <textarea className="input" rows={4} value={(v as string) ?? ''} onChange={(e) => set(e.target.value || (optional ? undefined : ''))} /> : <input className="input" value={(v as string) ?? ''} onChange={(e) => set(e.target.value || (optional ? undefined : ''))} />}</Row>;
  }
  if (t === 'number') {
    const frac = (s.maxValue ?? 99) <= 1;
    return <Row label={lbl(k)}>{frac ? <input type="range" min={0} max={s.maxValue ?? 1} step={0.05} className="w-full" value={Number(v ?? 0)} onChange={(e) => set(Number(e.target.value))} /> : <input className="input num" type="number" min={s.minValue ?? undefined} max={s.maxValue ?? undefined} value={v == null ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />}</Row>;
  }
  if (t === 'boolean') return <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />{lbl(k)}</label>;
  if (t === 'enum') {
    const opts = s.options ?? Object.values(s.def.entries ?? {});
    return <Row label={lbl(k)}><select className="input" value={(v as string) ?? ''} onChange={(e) => set(e.target.value)}>{optional && <option value="">—</option>}{opts.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select></Row>;
  }
  if (t === 'array') {
    const el = unwrap(s.def.element!).z;
    const arr = (v as unknown[]) ?? [];
    if (el.def.type === 'string' || el.def.type === 'enum') {
      return <Row label={`${lbl(k)} (one per line)`}><textarea className="input" rows={Math.min(8, arr.length + 2)} value={arr.join('\n')} onChange={(e) => set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} /></Row>;
    }
    if (el.def.type === 'object' && !isImage(el) && el.shape) {
      return <Repeater label={lbl(k)} arr={arr as Record<string, unknown>[]} shape={el.shape} set={set} />;
    }
    if (isImage(el)) return <Repeater label={lbl(k)} arr={arr as Record<string, unknown>[]} shape={{ url: el.shape!.url!, alt: el.shape!.alt! }} set={set} />;
    if (el.def.type === 'union' || (el as unknown as { options?: unknown }).options) return <RichBlocks arr={arr as { type: string; text?: string; items?: string[] }[]} set={set} />;
  }
  return null;
}

function Repeater({ label, arr, shape, set }: { label: string; arr: Record<string, unknown>[]; shape: Record<string, Z>; set: (v: unknown) => void }) {
  const keys = Object.keys(shape);
  const blank = Object.fromEntries(keys.map((k) => [k, unwrap(shape[k]!).z.def.type === 'object' ? undefined : '']));
  return (
    <div className="mb-3">
      <p className="label flex justify-between">{label}<button className="text-xs font-normal text-accent" onClick={() => set([...arr, blank])}>+ Add</button></p>
      <ol className="space-y-2">
        {arr.map((it, i) => (
          <li key={i} className="border border-line p-2">
            {keys.map((k) => {
              const long = (unwrap(shape[k]!).z.maxLength ?? 0) > 300;
              const val = (it[k] as string) ?? '';
              return long ? <textarea key={k} className="input mb-1" rows={3} placeholder={lbl(k)} value={val} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                : <input key={k} className="input mb-1" placeholder={lbl(k)} value={val} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />;
            })}
            <div className="flex justify-end gap-3 text-xs text-muted">
              {i > 0 && <button onClick={() => { const n = [...arr]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; set(n); }}>Move up</button>}
              <button className="hover:text-bad" onClick={() => set(arr.filter((_, j) => j !== i))}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RichBlocks({ arr, set }: { arr: { type: string; text?: string; items?: string[]; cite?: string }[]; set: (v: unknown) => void }) {
  return (
    <div className="mb-3">
      <p className="label flex justify-between">Content
        <select className="text-xs font-normal text-accent" value="" onChange={(e) => { if (e.target.value) set([...arr, e.target.value === 'list' ? { type: 'list', items: ['First point'] } : { type: e.target.value, text: 'New text' }]); }}>
          <option value="">+ Add block</option><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="quote">Quote</option><option value="list">List</option>
        </select>
      </p>
      <ol className="space-y-2">
        {arr.map((b, i) => (
          <li key={i} className="border border-line p-2">
            <p className="mb-1 text-2xs uppercase text-muted">{b.type}</p>
            {b.type === 'list' ? <textarea className="input" rows={3} value={(b.items ?? []).join('\n')} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, items: e.target.value.split('\n') } : x)))} />
              : <textarea className="input" rows={b.type === 'p' ? 4 : 2} value={b.text ?? ''} onChange={(e) => set(arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />}
            <button className="mt-1 text-xs text-muted hover:text-bad" onClick={() => set(arr.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Inspector({ type, props, onChange }: { type: SectionType; props: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const schema = SECTION_SCHEMAS[type] as unknown as Z;
  const shape = schema.shape ?? schema.def.shape ?? {};
  return (
    <div>
      {Object.entries(shape).map(([k, z]) => (
        <Value key={k} k={k} z={z} v={props[k]} set={(v) => { const n = { ...props }; if (v === undefined) delete n[k]; else n[k] = v; onChange(n); }} />
      ))}
    </div>
  );
}
