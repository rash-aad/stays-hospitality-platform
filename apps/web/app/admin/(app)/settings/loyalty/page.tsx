'use client';

import { useEffect, useState } from 'react';
import { ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type Tier = { name: string; minNights: number; bonusPct: number };
type L = { enabled: boolean; earnPerHundred: number; pointValue: number; minRedeem: number; tiers: Tier[] };
type R = { googleUrl: string | null; tripadvisorUrl: string | null };

export default function LoyaltySettings() {
  const { data, error, mutate } = useStaff<{ data: L }>('/admin/loyalty-settings');
  const { data: rev, mutate: reloadRev } = useStaff<{ data: R }>('/admin/review-settings');
  const [f, setF] = useState<L | null>(null);
  const [r, setR] = useState<R | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data && !f) setF(data.data); }, [data, f]);
  useEffect(() => { if (rev && !r) setR(rev.data); }, [rev, r]);
  if (!f || !r) return <><PageHeader title="Loyalty & reviews" /><ErrorNote error={error} /><Loading /></>;
  const back = (f.earnPerHundred * f.pointValue) / 100;
  return (
    <>
      <PageHeader title="Loyalty & reviews" sub="Reward returning guests with points, and invite happy guests to review you publicly." />
      <div className="max-w-3xl bg-panel">
        <Section title="Loyalty points" actions={<button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/loyalty-settings', { method: 'PUT', body: f }), 'Loyalty saved').then(() => mutate())}>Save</button>}>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Guests earn points on their stays</label>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Points per ₹100 of room revenue"><input className="input num" type="number" min={0} value={f.earnPerHundred} onChange={(e) => setF({ ...f, earnPerHundred: Number(e.target.value) })} /></Field>
            <Field label="Each point is worth (₹)"><input className="input num" type="number" step="0.01" min={0.01} value={f.pointValue / 100} onChange={(e) => setF({ ...f, pointValue: Math.round(Number(e.target.value) * 100) })} /></Field>
            <Field label="Minimum points to use"><input className="input num" type="number" min={0} value={f.minRedeem} onChange={(e) => setF({ ...f, minRedeem: Number(e.target.value) })} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">That’s {back.toFixed(2)}% back on room revenue, before tier bonuses. Points are earned at check-out and can be used on upcoming or current stays.</p>
          <p className="label mt-4">Tiers (by nights stayed in the last 12 months)</p>
          <table className="w-full text-[13px]"><thead><tr className="text-left text-xs text-muted"><th className="py-1 font-normal">Name</th><th className="font-normal">From nights</th><th className="font-normal">Bonus %</th><th /></tr></thead>
            <tbody>{f.tiers.map((t, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><input className="input" value={t.name} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></td>
                <td className="pr-2"><input className="input num" type="number" min={0} value={t.minNights} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => j === i ? { ...x, minNights: Number(e.target.value) } : x) })} /></td>
                <td className="pr-2"><input className="input num" type="number" min={0} value={t.bonusPct} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => j === i ? { ...x, bonusPct: Number(e.target.value) } : x) })} /></td>
                <td>{f.tiers.length > 1 && <button className="btn btn-sm" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })}>Remove</button>}</td>
              </tr>
            ))}</tbody></table>
          {f.tiers.length < 6 && <button className="btn btn-sm mt-2" onClick={() => setF({ ...f, tiers: [...f.tiers, { name: 'Platinum', minNights: 30, bonusPct: 50 }] })}>Add tier</button>}
        </Section>
        <Section title="Review links" actions={<button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/review-settings', { method: 'PUT', body: { googleUrl: r.googleUrl || null, tripadvisorUrl: r.tripadvisorUrl || null } }), 'Review links saved').then(() => reloadRev())}>Save</button>}>
          <p className="mb-3 text-[13px] text-muted">When a guest rates their stay 4★ or 5★, they’re invited once to post a public review here.</p>
          <div className="grid gap-3">
            <Field label="Google review link"><input className="input" value={r.googleUrl ?? ''} onChange={(e) => setR({ ...r, googleUrl: e.target.value })} placeholder="https://g.page/r/…/review" /></Field>
            <Field label="Tripadvisor link"><input className="input" value={r.tripadvisorUrl ?? ''} onChange={(e) => setR({ ...r, tripadvisorUrl: e.target.value })} placeholder="https://www.tripadvisor.in/…" /></Field>
          </div>
        </Section>
      </div>
    </>
  );
}
