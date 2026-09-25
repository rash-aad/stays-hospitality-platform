'use client';

import { useState } from 'react';
import { ErrorNote, Loading, PageHeader, Segmented } from '@/components/ui';
import { human, isoToday, money } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { staffApi } from '@/lib/api';

/** Exports need the bearer token, so fetch the CSV and hand it to the browser as a file. */
async function download(type: string, from: string, to: string) {
  const res = await staffApi<Response>(`/admin/reports/export?type=${type}&from=${from}&to=${to}`, { raw: true });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `${type}-${from}-to-${to}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type R = {
  range: { from: string; to: string };
  rooms: { occupancy: number; roomNightsSold: number; roomNightsAvailable: number; roomRevenue: number; adr: number; revpar: number; bookings: number; averageBookingValue: number; cancellations: number; noShows: number; averageLeadDays: number | null; averageLengthOfStay: number | null; daily: { date: string; sold: number; revenue: number; available: number }[]; sources: { source: string; bookings: number; revenue: number }[] };
  payments: { method: string; count: number; amount: number }[];
  dining: { reservations: number; covers: number; noShows: number; orders: number; orderRevenue: number; avgMinutesToReady: number; byOutlet: { name: string; orders: number; revenue: number }[] };
  requests: { category: string; count: number; avgMinutes: number; breached: number }[];
  operations: { hkTasks: number; hkDone: number; hkFailedInspections: number; mtOpened: number; mtResolved: number; mtBacklog: number };
  engagement: { stayingGuests: number; portalActiveGuests: number; experienceBookings: number; experienceRevenue: number };
  moduleUsage: { module: string; enabled: boolean; activity: number | null }[];
};

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="border-r border-b border-line px-5 py-4"><p className="text-xs text-muted">{label}</p><p className="num mt-1 text-[22px] leading-none font-medium tracking-tight">{value}</p>{sub && <p className="mt-1 text-xs text-muted">{sub}</p>}</div>;
}
function Bars({ rows, value, label }: { rows: { key: string; v: number; sub?: string }[]; value: (n: number) => string; label?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <table className="w-full text-[13px]">
      {label && <caption className="eyebrow mb-2 text-left">{label}</caption>}
      <tbody>{rows.map((r) => (
        <tr key={r.key}><td className="w-40 py-1 pr-3">{r.key}</td><td className="py-1"><div className="h-2 bg-accent/80" style={{ width: `${(r.v / max) * 100}%` }} /></td><td className="num w-28 py-1 pl-3 text-right">{value(r.v)}{r.sub && <span className="block text-2xs text-muted">{r.sub}</span>}</td></tr>
      ))}</tbody>
    </table>
  );
}

export default function Reports() {
  const [preset, setPreset] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [from, setFrom] = useState(isoToday(-29));
  const [to, setTo] = useState(isoToday());
  const f = preset === 'custom' ? from : isoToday(-(Number(preset) - 1));
  const t = preset === 'custom' ? to : isoToday();
  const { data, error } = useStaff<{ data: R }>(`/admin/reports/summary?from=${f}&to=${t}`);
  const d = data?.data;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  return (
    <>
      <PageHeader title="Reports" sub={d && `${d.range.from} – ${d.range.to}`}
        actions={<>
          <Segmented value={preset} onChange={setPreset} items={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'custom', label: 'Custom' }]} />
          {preset === 'custom' && <><input className="input w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><input className="input w-36" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
          <select className="input w-44" value="" onChange={(e) => { if (e.target.value) void download(e.target.value, f, t); }}><option value="">Export CSV…</option>{['bookings', 'payments', 'orders', 'reservations', 'requests'].map((x) => <option key={x} value={x}>{human(x)}</option>)}</select>
        </>} />
      <ErrorNote error={error} />
      {!d ? <Loading /> : (
        <div className="bg-panel">
          <div className="grid grid-cols-2 border-l border-line md:grid-cols-4 xl:grid-cols-6">
            <Kpi label="Occupancy" value={pct(d.rooms.occupancy)} sub={`${d.rooms.roomNightsSold} of ${d.rooms.roomNightsAvailable} room nights`} />
            <Kpi label="Room revenue" value={money(d.rooms.roomRevenue)} />
            <Kpi label="ADR" value={money(d.rooms.adr)} sub="Average daily rate" />
            <Kpi label="RevPAR" value={money(d.rooms.revpar)} sub="Revenue per available room" />
            <Kpi label="Bookings" value={d.rooms.bookings} sub={`avg ${money(d.rooms.averageBookingValue)}`} />
            <Kpi label="Cancellations" value={d.rooms.cancellations} sub={`${d.rooms.noShows} no-shows`} />
          </div>
          <section className="border-b border-line px-6 py-5">
            <h2 className="eyebrow mb-3">Occupancy by night</h2>
            <div className="flex h-36 items-end gap-px" role="img" aria-label="Nightly occupancy">
              {d.rooms.daily.map((x) => { const o = x.available ? x.sold / x.available : 0; return <div key={x.date} title={`${x.date}: ${pct(o)} · ${money(x.revenue)}`} className="flex-1 bg-accent/80 hover:bg-accent" style={{ height: `${Math.max(2, o * 100)}%` }} />; })}
            </div>
            <div className="mt-1 flex justify-between text-2xs text-muted"><span>{d.range.from}</span><span>{d.range.to}</span></div>
            <p className="mt-3 text-xs text-muted">Average lead time {d.rooms.averageLeadDays ?? '—'} days · average stay {d.rooms.averageLengthOfStay ?? '—'} nights</p>
          </section>
          <div className="grid gap-px bg-line lg:grid-cols-2">
            <section className="bg-panel px-6 py-5"><Bars label="Booking sources" rows={d.rooms.sources.map((s) => ({ key: human(s.source), v: s.revenue, sub: `${s.bookings} bookings` }))} value={money} /></section>
            <section className="bg-panel px-6 py-5"><Bars label="Money received" rows={d.payments.map((p) => ({ key: human(p.method), v: p.amount, sub: `${p.count} payments` }))} value={money} /></section>
            <section className="bg-panel px-6 py-5">
              <h2 className="eyebrow mb-3">Dining</h2>
              <dl className="kv mb-4"><dt>Table bookings</dt><dd className="num">{d.dining.reservations} · {d.dining.covers} covers · {d.dining.noShows} no-shows</dd><dt>Orders</dt><dd className="num">{d.dining.orders} · {money(d.dining.orderRevenue)}</dd><dt>Kitchen time</dt><dd className="num">{d.dining.avgMinutesToReady} min to ready, on average</dd></dl>
              <Bars rows={d.dining.byOutlet.map((o) => ({ key: o.name, v: o.revenue, sub: `${o.orders} orders` }))} value={money} />
            </section>
            <section className="bg-panel px-6 py-5">
              <h2 className="eyebrow mb-3">Guest requests</h2>
              <table className="w-full text-[13px]"><thead><tr className="text-left text-xs text-muted"><th className="py-1 font-normal">Team</th><th className="py-1 text-right font-normal">Requests</th><th className="py-1 text-right font-normal">Avg. to resolve</th><th className="py-1 text-right font-normal">Missed target</th></tr></thead>
                <tbody>{d.requests.map((r) => <tr key={r.category} className="border-t border-line"><td className="py-1.5">{human(r.category)}</td><td className="num py-1.5 text-right">{r.count}</td><td className="num py-1.5 text-right">{r.avgMinutes} min</td><td className={`num py-1.5 text-right ${r.breached ? 'text-bad' : ''}`}>{r.breached}</td></tr>)}</tbody></table>
            </section>
            <section className="bg-panel px-6 py-5">
              <h2 className="eyebrow mb-3">Operations</h2>
              <dl className="kv"><dt>Housekeeping</dt><dd className="num">{d.operations.hkDone} of {d.operations.hkTasks} tasks done · {d.operations.hkFailedInspections} failed inspections</dd><dt>Maintenance</dt><dd className="num">{d.operations.mtOpened} opened · {d.operations.mtResolved} resolved · {d.operations.mtBacklog} open now</dd></dl>
            </section>
            <section className="bg-panel px-6 py-5">
              <h2 className="eyebrow mb-3">Guest engagement</h2>
              <dl className="kv"><dt>Portal use</dt><dd className="num">{d.engagement.portalActiveGuests} of {d.engagement.stayingGuests} staying guests used the portal</dd><dt>Experiences</dt><dd className="num">{d.engagement.experienceBookings} bookings · {money(d.engagement.experienceRevenue)}</dd></dl>
              <h3 className="eyebrow mt-5 mb-2">Module activity</h3>
              <ul className="grid grid-cols-2 gap-x-6 text-[13px]">{d.moduleUsage.filter((m) => m.enabled && m.activity != null).map((m) => <li key={m.module} className="flex justify-between border-b border-line py-1"><span>{human(m.module)}</span><span className="num">{m.activity}</span></li>)}</ul>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
