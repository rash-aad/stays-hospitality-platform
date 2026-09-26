'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Section, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { money, toMajor, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Kind = 'occupancy' | 'lead_time' | 'day_of_week';
type Rule = { id?: string; name: string; roomTypeId: string | null; kind: Kind; params: { minOccupancyPct?: number; minDays?: number; maxDays?: number; days?: number[] }; adjustPct: number; active: boolean };
type Night = { date: string; base: number; price: number; applied: string[]; left: number; occupancyPct: number };
type Overview = { from: string; dates: string[]; roomTypes: { id: string; name: string; priceFloor: number | null; priceCeiling: number | null; plan: { name: string }; nights: Night[] }[]; house: { date: string; occupancyPct: number; pickup: number }[] };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY: Rule = { name: '', roomTypeId: null, kind: 'occupancy', params: { minOccupancyPct: 80 }, adjustPct: 15, active: true };

function describe(r: Rule) {
  const pct = `${r.adjustPct > 0 ? '+' : ''}${r.adjustPct}%`;
  if (r.kind === 'occupancy') return `${pct} when ${r.params.minOccupancyPct}% or more is sold`;
  if (r.kind === 'lead_time') return `${pct} when booked ${r.params.minDays != null && r.params.maxDays != null ? `${r.params.minDays}–${r.params.maxDays}` : r.params.minDays != null ? `${r.params.minDays}+` : `0–${r.params.maxDays}`} days ahead`;
  return `${pct} on ${(r.params.days ?? []).map((d) => DAYS[d]).join(', ')} nights`;
}

export default function Revenue() {
  const can = useCan();
  const edit = can.perm('property.manage');
  const { data, error, mutate } = useStaff<{ data: Overview; settings: { scarcityThreshold: number } }>('/admin/revenue/overview?days=30');
  const { data: rules, mutate: reloadRules } = useStaff<{ data: Rule[] }>('/admin/pricing-rules');
  const { busy, run } = useAction();
  const [form, setForm] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<Overview | null>(null);
  const [guard, setGuard] = useState<Record<string, { floor: string; ceiling: string }>>({});
  const refresh = () => { mutate(); reloadRules(); setPreview(null); };
  const ov = preview ?? data?.data;
  const body = (r: Rule) => ({ name: r.name, roomTypeId: r.roomTypeId, kind: r.kind, params: r.params, adjustPct: Number(r.adjustPct), active: r.active });

  return (
    <>
      <PageHeader title="Revenue" sub="Prices for the next 30 days after your automatic pricing rules, with how full each night is and what was booked this week."
        actions={edit && <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}>Add pricing rule</button>} />
      <ErrorNote error={error} />
      {!ov ? <Loading /> : (
        <>
          {preview && <p className="mx-6 mt-3 rounded-sm border border-accent/40 bg-accent-soft px-3 py-2 text-[13px] text-accent" data-testid="preview-banner">Previewing an unsaved rule. <button className="underline" onClick={() => setPreview(null)}>Stop preview</button></p>}
          <div className="overflow-x-auto bg-panel" data-testid="revenue-grid">
            <table className="text-[12px]">
              <thead>
                <tr><th className="sticky left-0 z-10 min-w-40 bg-panel px-3 py-2 text-left font-normal text-muted">Night</th>
                  {ov.dates.map((d) => { const dt = new Date(`${d}T00:00:00Z`); return <th key={d} className={cx('min-w-14 px-1 py-2 text-center font-normal', [5, 6].includes(dt.getUTCDay()) && 'bg-sunk/60')}><span className="block text-muted">{DAYS[dt.getUTCDay()]}</span>{dt.getUTCDate()}</th>; })}</tr>
              </thead>
              <tbody>
                <tr className="border-t border-line"><td className="sticky left-0 z-10 bg-panel px-3 py-1.5 text-muted">Whole hotel sold</td>{ov.house.map((h) => <td key={h.date} className={cx('num px-1 text-center', h.occupancyPct >= 80 && 'font-semibold text-ok')}>{h.occupancyPct}%</td>)}</tr>
                <tr><td className="sticky left-0 z-10 bg-panel px-3 py-1.5 text-muted">Booked this week</td>{ov.house.map((h) => <td key={h.date} className="num px-1 text-center text-muted">{h.pickup || ''}</td>)}</tr>
                {ov.roomTypes.map((t) => (
                  <tr key={t.id} className="border-t border-line align-top">
                    <td className="sticky left-0 z-10 bg-panel px-3 py-2"><span className="font-medium">{t.name}</span><span className="block text-muted">{t.plan.name}</span></td>
                    {t.nights.map((n) => {
                      const up = n.price > n.base, down = n.price < n.base;
                      return (
                        <td key={n.date} className={cx('px-1 py-2 text-center', up && 'bg-warn-soft', down && 'bg-accent-soft')} title={`${n.applied.join(' + ') || 'Base rate'} · ${n.occupancyPct}% sold · ${n.left} left${n.price !== n.base ? ` · base ${money(n.base)}` : ''}`}>
                          <span className={cx('num block', up && 'text-warn', down && 'text-accent')}>{(n.price / 100).toLocaleString('en-IN')}</span>
                          <span className="num block text-[11px] text-muted">{n.left} left</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-6 py-2 text-xs text-muted">Prices in ₹ for the cheapest rate at base occupancy. Amber = raised by a rule, teal = lowered. Hover a night for details.</p>
        </>
      )}

      <div className="mt-4 max-w-4xl bg-panel">
        <Section title="Pricing rules">
          {!rules ? <Loading rows={2} /> : rules.data.length === 0 ? <Empty title="No rules yet">Rates follow your rate plans and seasons exactly. Add a rule to raise prices as you fill up, reward early bookers or fill quiet weekdays.</Empty> : (
            <ul className="divide-y divide-line text-[13px]" data-testid="rules">
              {rules.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className={cx(!r.active && 'opacity-50')}><span className="font-medium">{r.name}</span> · {describe(r)} · {r.roomTypeId ? data?.data.roomTypes.find((t) => t.id === r.roomTypeId)?.name : 'all room types'}{!r.active && ' · off'}</span>
                  {edit && <span className="flex gap-1"><button className="btn btn-sm" onClick={() => setForm({ ...r })}>Edit</button><button className="btn btn-sm" disabled={busy} onClick={() => run(() => staffApi(`/admin/pricing-rules/${r.id}`, { method: 'DELETE' }), 'Rule removed').then(refresh)}>Remove</button></span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Occupancy rules are tiers: only the highest one reached applies. Lead-time and weekday rules add on top. Extra-guest charges, coupons and taxes are applied after.</p>
        </Section>
        {data && edit && (
          <Section title="Guardrails">
            <p className="mb-3 text-[13px] text-muted">Rules never take a night below the floor or above the ceiling.</p>
            <ul className="space-y-2">
              {data.data.roomTypes.map((t) => {
                const g = guard[t.id] ?? { floor: toMajor(t.priceFloor), ceiling: toMajor(t.priceCeiling) };
                return (
                  <li key={t.id} className="flex flex-wrap items-end gap-2">
                    <span className="w-40 pb-2 text-[13px]">{t.name}</span>
                    <Field label="Floor (₹)"><input className="input num w-28" inputMode="decimal" value={g.floor} onChange={(e) => setGuard({ ...guard, [t.id]: { ...g, floor: e.target.value } })} /></Field>
                    <Field label="Ceiling (₹)"><input className="input num w-28" inputMode="decimal" value={g.ceiling} onChange={(e) => setGuard({ ...guard, [t.id]: { ...g, ceiling: e.target.value } })} /></Field>
                    <button className="btn btn-sm mb-1" disabled={busy} onClick={() => run(() => staffApi(`/admin/revenue/guardrails/${t.id}`, { method: 'PUT', body: { priceFloor: g.floor ? toMinor(g.floor) : null, priceCeiling: g.ceiling ? toMinor(g.ceiling) : null } }), 'Guardrails saved').then(() => mutate())}>Save</button>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        {data && edit && (
          <Section title="Booking page">
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('n')); run(() => staffApi('/admin/revenue/settings', { method: 'PUT', body: { scarcityThreshold: v } }), 'Saved').then(() => mutate()); }}>
              <Field label="Show “only N left” when this many rooms or fewer remain (0 = never)"><input name="n" className="input num w-24" type="number" min={0} max={20} defaultValue={data.settings.scarcityThreshold} /></Field>
              <button className="btn btn-sm mb-1" disabled={busy}>Save</button>
            </form>
            <p className="mt-2 text-xs text-muted">It always reflects real availability — never invented urgency.</p>
          </Section>
        )}
      </div>

      <Drawer open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit pricing rule' : 'New pricing rule'}
        footer={form && <>
          <button className="btn" disabled={busy || !form.name} onClick={() => run(() => staffApi<{ data: Overview }>('/admin/revenue/preview', { body: { rule: body(form), replaceId: form.id } })).then((r) => { if (r) setPreview(r.data); })}>Preview</button>
          <button className="btn btn-primary" disabled={busy || !form.name} onClick={() => run(() => form.id ? staffApi(`/admin/pricing-rules/${form.id}`, { method: 'PUT', body: body(form) }) : staffApi('/admin/pricing-rules', { body: body(form) }), 'Rule saved').then((r) => { if (r) { setForm(null); refresh(); } })}>Save rule</button>
        </>}>
        {form && (
          <div className="space-y-3 p-5">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nearly full" /></Field>
            <Field label="Applies to"><select className="input" value={form.roomTypeId ?? ''} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value || null })}><option value="">All room types</option>{data?.data.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="When"><select className="input" value={form.kind} onChange={(e) => { const kind = e.target.value as Kind; setForm({ ...form, kind, params: kind === 'occupancy' ? { minOccupancyPct: 80 } : kind === 'lead_time' ? { maxDays: 3 } : { days: [5, 6] } }); }}>
              <option value="occupancy">The room type is filling up</option><option value="lead_time">Booked a certain time ahead</option><option value="day_of_week">On certain nights of the week</option>
            </select></Field>
            {form.kind === 'occupancy' && <Field label="At least this much sold (%)"><input className="input num w-28" type="number" min={1} max={100} value={form.params.minOccupancyPct ?? ''} onChange={(e) => setForm({ ...form, params: { minOccupancyPct: Number(e.target.value) } })} /></Field>}
            {form.kind === 'lead_time' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="At least (days before arrival)" hint="Early bird: e.g. 60"><input className="input num" type="number" min={0} value={form.params.minDays ?? ''} onChange={(e) => setForm({ ...form, params: { ...form.params, minDays: e.target.value === '' ? undefined : Number(e.target.value) } })} /></Field>
                <Field label="At most (days before arrival)" hint="Last minute: e.g. 3"><input className="input num" type="number" min={0} value={form.params.maxDays ?? ''} onChange={(e) => setForm({ ...form, params: { ...form.params, maxDays: e.target.value === '' ? undefined : Number(e.target.value) } })} /></Field>
              </div>
            )}
            {form.kind === 'day_of_week' && (
              <fieldset><legend className="label">Nights</legend><div className="flex flex-wrap gap-3 text-[13px]">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={form.params.days?.includes(i) ?? false} onChange={(e) => setForm({ ...form, params: { days: e.target.checked ? [...(form.params.days ?? []), i] : (form.params.days ?? []).filter((x) => x !== i) } })} />{d}</label>)}</div></fieldset>
            )}
            <Field label="Change the price by (%)" hint="Positive raises, negative discounts (−50 to +200)"><input className="input num w-28" type="number" min={-50} max={200} value={form.adjustPct} onChange={(e) => setForm({ ...form, adjustPct: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <p className="text-[13px] text-muted">{describe(form)}</p>
          </div>
        )}
      </Drawer>
    </>
  );
}
