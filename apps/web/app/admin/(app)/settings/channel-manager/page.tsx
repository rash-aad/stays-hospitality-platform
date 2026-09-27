'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { ErrorNote, Field, Loading, PageHeader, Section, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, date, dateTime, isoToday } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Conn = { id: string; provider: 'mock' | 'channex'; status: 'active' | 'paused'; environment: 'staging' | 'production'; externalPropertyId: string; apiKeySet: boolean; horizonDays: number; lastPushAt: string | null; lastPullAt: string | null; lastError: string | null };
type Plan = { id: string; name: string; code: string; roomTypeId: string; roomType: string };
type Mapping = { ratePlanId: string; externalRoomTypeId: string; externalRatePlanId: string };
type Data = { connection: Conn | null; mappings: Mapping[]; plans: Plan[]; log: { id: string; direction: string; ok: boolean; summary: string; createdAt: string }[]; issues: { id: string; reference: string; channelIssue: string; channelName: string | null; checkIn: string; checkOut: string; guestName: string }[] };

export default function ChannelManager() {
  const { data, error, mutate } = useStaff<{ data: Data }>('/admin/channel-manager', { refreshInterval: 30_000 });
  const can = useCan();
  const edit = can.perm('property.manage');
  const { busy, run } = useAction();
  const [f, setF] = useState<{ provider: 'mock' | 'channex'; environment: 'staging' | 'production'; externalPropertyId: string; apiKey: string; horizonDays: number; status: 'active' | 'paused' } | null>(null);
  const [maps, setMaps] = useState<Record<string, Mapping & { on: boolean }> | null>(null);
  const [sim, setSim] = useState({ externalRatePlanId: '', checkIn: isoToday(14), checkOut: isoToday(16), guestName: 'Priya Nair', channel: 'Booking.com' });
  const d = data?.data;
  useEffect(() => {
    if (!d || f) return;
    const c = d.connection;
    setF({ provider: c?.provider ?? 'channex', environment: c?.environment ?? 'staging', externalPropertyId: c?.externalPropertyId ?? '', apiKey: '', horizonDays: c?.horizonDays ?? 365, status: c?.status ?? 'active' });
    setMaps(Object.fromEntries(d.plans.map((p) => { const m = d.mappings.find((x) => x.ratePlanId === p.id); return [p.id, { ratePlanId: p.id, externalRoomTypeId: m?.externalRoomTypeId ?? '', externalRatePlanId: m?.externalRatePlanId ?? '', on: !!m }]; })));
  }, [d, f]);
  if (!d || !f || !maps) return <><PageHeader title="Channel manager" /><ErrorNote error={error} /><Loading /></>;
  const c = d.connection;
  const mapped = Object.values(maps).filter((m) => m.on);
  const refresh = () => { setF(null); setMaps(null); mutate(); };

  return (
    <>
      <PageHeader title="Channel manager" sub="Sell on Booking.com, Airbnb, Expedia, Agoda and more through a channel manager: bookEZ sends your availability and rates, and bookings from those sites arrive here automatically."
        actions={c && edit && <><button className="btn" disabled={busy} onClick={() => run(() => staffApi('/admin/channel-manager/test', { body: {} })).then(() => mutate())}>Test connection</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi<{ data: { applied: number; availability: number; restrictions: number } }>('/admin/channel-manager/sync', { body: { full: false } }), 'Synced').then(() => mutate())}>Sync now</button></>} />
      <ErrorNote error={error} />
      {d.issues.length > 0 && (
        <div className="mx-6 mt-4 rounded-sm border border-bad/40 bg-bad-soft px-4 py-3 text-[13px] text-bad" data-testid="channel-issues">
          <p className="font-medium">Needs attention</p>
          <ul className="mt-1 space-y-1">{d.issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{i.channelIssue === 'overbooked' ? 'Overbooked' : 'Change not applied'}: {i.guestName} · <span className="font-mono">{i.reference}</span> from {i.channelName} · {date(i.checkIn, 'short')} – {date(i.checkOut, 'short')}</span>
              <span className="flex gap-1"><Link className="btn btn-sm" href="/admin/tape-chart">Tape chart</Link>{can.perm('bookings.write') && <button className="btn btn-sm" onClick={() => run(() => staffApi(`/admin/bookings/${i.id}/channel-issue/resolve`, { body: {} }), 'Marked resolved').then(() => mutate())}>Resolved</button>}</span>
            </li>
          ))}</ul>
        </div>
      )}
      <div className="max-w-4xl bg-panel">
        <Section title="Connection" actions={c && <span className="text-xs text-muted">{c.lastPullAt ? `Bookings checked ${ago(c.lastPullAt)}` : 'Not synced yet'}{c.lastPushAt && ` · calendar sent ${ago(c.lastPushAt)}`}</span>}>
          {c?.lastError && <p className="mb-3 rounded-sm bg-bad-soft px-3 py-2 text-[13px] text-bad">{c.lastError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider"><select className="input" disabled={!edit} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as 'mock' | 'channex' })}><option value="channex">Channex (connects 400+ sites)</option><option value="mock">Test channel manager (try it out)</option></select></Field>
            {f.provider === 'channex' && <Field label="Environment"><select className="input" disabled={!edit} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as 'staging' | 'production' })}><option value="staging">Staging (testing)</option><option value="production">Production (live)</option></select></Field>}
            <Field label={f.provider === 'channex' ? 'Channex property ID' : 'Property ID'}><input className="input font-mono" disabled={!edit} value={f.externalPropertyId} onChange={(e) => setF({ ...f, externalPropertyId: e.target.value })} placeholder={f.provider === 'mock' ? 'TEST-PROPERTY' : 'uuid from Channex'} /></Field>
            {f.provider === 'channex' && <Field label="API key" hint={c?.apiKeySet ? 'Saved (encrypted) — leave blank to keep' : 'Channex → Profile → API keys'}><input className="input font-mono" type="password" autoComplete="off" disabled={!edit} value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field>}
            <Field label="Days ahead to publish"><input className="input num" type="number" min={30} max={730} disabled={!edit} value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: Number(e.target.value) })} /></Field>
            <Field label="Status"><select className="input" disabled={!edit} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'paused' })}><option value="active">Active — sync every 5 minutes</option><option value="paused">Paused</option></select></Field>
          </div>
          {edit && <div className="mt-3 flex gap-2"><button className="btn btn-primary" disabled={busy || !f.externalPropertyId} onClick={() => run(() => staffApi('/admin/channel-manager', { method: 'PUT', body: { ...f, apiKey: f.apiKey || undefined } }), c ? 'Connection saved' : 'Connected').then((r) => { if (r) refresh(); })}>{c ? 'Save' : 'Connect'}</button>
            {c && <button className="btn btn-danger" disabled={busy} onClick={() => run(() => staffApi('/admin/channel-manager', { method: 'DELETE' }), 'Disconnected').then(refresh)}>Disconnect</button>}</div>}
          <p className="mt-3 text-xs text-muted">Using a channel manager for a site? Remove that site’s iCal feed in <Link className="underline" href="/admin/settings/channels">Channels (iCal)</Link> so its bookings aren’t counted twice.</p>
        </Section>

        {c && (
          <Section title="Rate plans on the channel" actions={edit && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/channel-manager/mappings', { method: 'PUT', body: { mappings: mapped.map(({ on: _o, ...m }) => m) } }), 'Mapping saved — the full calendar will be sent').then(() => mutate())}>Save mapping</button>}>
            <p className="mb-3 text-[13px] text-muted">Enter the IDs of the matching room type and rate plan in {c.provider === 'channex' ? 'Channex' : 'the channel manager'}. Rate plans of one room type share its channel room type.</p>
            <table className="w-full text-[13px]" data-testid="mappings"><thead><tr className="text-left text-xs text-muted"><th className="py-1 font-normal">Sell</th><th className="font-normal">bookEZ rate plan</th><th className="font-normal">Channel room type ID</th><th className="font-normal">Channel rate plan ID</th></tr></thead>
              <tbody>{d.plans.map((p) => { const m = maps[p.id]!; return (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1.5"><input type="checkbox" aria-label={`Sell ${p.roomType} ${p.name}`} disabled={!edit} checked={m.on} onChange={(e) => setMaps({ ...maps, [p.id]: { ...m, on: e.target.checked } })} /></td>
                  <td>{p.roomType} — {p.name}</td>
                  <td className="pr-2"><input className="input font-mono" aria-label={`${p.roomType} ${p.name} channel room type ID`} disabled={!edit || !m.on} value={m.externalRoomTypeId} onChange={(e) => setMaps({ ...maps, [p.id]: { ...m, externalRoomTypeId: e.target.value } })} /></td>
                  <td><input className="input font-mono" aria-label={`${p.roomType} ${p.name} channel rate plan ID`} disabled={!edit || !m.on} value={m.externalRatePlanId} onChange={(e) => setMaps({ ...maps, [p.id]: { ...m, externalRatePlanId: e.target.value } })} /></td>
                </tr>
              ); })}</tbody></table>
            {edit && <button className="btn btn-sm mt-3" disabled={busy} onClick={() => run(() => staffApi('/admin/channel-manager/sync', { body: { full: true } }), 'Full calendar sent').then(() => mutate())}>Resend the full calendar</button>}
          </Section>
        )}

        {c?.provider === 'mock' && edit && (
          <Section title="Try it: simulate an OTA booking">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Channel rate plan"><select className="input" value={sim.externalRatePlanId} onChange={(e) => setSim({ ...sim, externalRatePlanId: e.target.value })}><option value="">Choose…</option>{d.mappings.map((m) => <option key={m.externalRatePlanId} value={m.externalRatePlanId}>{m.externalRatePlanId}</option>)}</select></Field>
              <Field label="Site"><input className="input" value={sim.channel} onChange={(e) => setSim({ ...sim, channel: e.target.value })} /></Field>
              <Field label="Arrival"><input className="input" type="date" value={sim.checkIn} onChange={(e) => setSim({ ...sim, checkIn: e.target.value })} /></Field>
              <Field label="Departure"><input className="input" type="date" value={sim.checkOut} onChange={(e) => setSim({ ...sim, checkOut: e.target.value })} /></Field>
              <Field label="Guest name"><input className="input" value={sim.guestName} onChange={(e) => setSim({ ...sim, guestName: e.target.value })} /></Field>
            </div>
            <button className="btn mt-3" disabled={busy || !sim.externalRatePlanId} onClick={() => run(async () => { await staffApi('/admin/channel-manager/simulate', { body: sim }); return staffApi('/admin/channel-manager/sync', { body: { full: false } }); }, 'Booking received').then(() => mutate())}>Send test booking</button>
          </Section>
        )}

        {c && (
          <Section title="Sync log">
            {d.log.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
              <ul className="space-y-1 text-[13px]" data-testid="channel-log">{d.log.map((l) => <li key={l.id} className={cx('flex gap-3', !l.ok && 'text-bad')}><span className="w-32 shrink-0 text-xs text-muted">{dateTime(l.createdAt)}</span><span className="w-12 shrink-0 text-xs uppercase text-muted">{l.direction}</span><span>{l.summary}</span></li>)}</ul>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
