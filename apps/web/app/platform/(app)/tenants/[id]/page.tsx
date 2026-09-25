'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorNote, Loading, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type D = { id: string; name: string; slug: string; status: string; currency: string; timezone: string; staffCount: number; bookingCount: number; createdAt: string; domains: { id: string; hostname: string; verifiedAt: string | null; isPrimary: boolean }[]; modules: { key: string; name: string; group: string; requires: string[]; enabled: boolean }[]; recentActivity: { id: string; action: string; createdAt: string; actorType: string }[] };

export default function Tenant() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useStaff<{ data: D }>(`/platform/tenants/${id}`);
  const { busy, run } = useAction();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const t = data?.data;
  return (
    <>
      <PageHeader title={t?.name ?? 'Tenant'} sub={t && <span className="font-mono">{t.slug}</span>}
        actions={t && <button className={t.status === 'active' ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy} onClick={() => run(() => staffApi(`/platform/tenants/${id}`, { method: 'PATCH', body: { status: t.status === 'active' ? 'suspended' : 'active' } }), t.status === 'active' ? 'Tenant suspended — sites and sign-ins are off' : 'Tenant reactivated').then(() => mutate())}>{t.status === 'active' ? 'Suspend' : 'Reactivate'}</button>} />
      <ErrorNote error={error} />
      {!t ? <Loading /> : (
        <div className="grid gap-px bg-line lg:grid-cols-[1fr_380px]">
          <div className="bg-panel">
            <Section title="Modules">
              <ul className="grid gap-x-8 sm:grid-cols-2">
                {t.modules.map((m) => (
                  <li key={m.key} className="flex items-center justify-between border-b border-line py-2 text-[13px]">
                    <span>{m.name}<span className="block text-2xs text-muted">{m.group}{m.requires.length ? ` · needs ${m.requires.join(', ')}` : ''}</span></span>
                    <input type="checkbox" role="switch" aria-label={m.name} checked={pending[m.key] ?? m.enabled} disabled={busy} onChange={(e) => { const on = e.target.checked; setPending((p) => ({ ...p, [m.key]: on })); run(() => staffApi(`/platform/tenants/${id}/modules/${m.key}`, { method: 'PUT', body: { enabled: on } }), `${m.name} ${on ? 'enabled' : 'disabled'}`).then(() => mutate()).finally(() => setPending((p) => { const n = { ...p }; delete n[m.key]; return n; })); }} />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <div className="bg-panel">
            <Section title="Overview"><dl className="kv"><dt>Status</dt><dd><Status value={t.status} /></dd><dt>Staff</dt><dd>{t.staffCount}</dd><dt>Bookings</dt><dd>{t.bookingCount}</dd><dt>Currency</dt><dd>{t.currency}</dd><dt>Time zone</dt><dd>{t.timezone}</dd><dt>Created</dt><dd>{dateTime(t.createdAt)}</dd></dl></Section>
            <Section title="Domains"><ul className="text-[13px]">{t.domains.map((d) => <li key={d.id} className="flex justify-between py-1 font-mono text-xs">{d.hostname}<span className="font-sans">{d.verifiedAt ? (d.isPrimary ? 'primary' : 'verified') : 'pending'}</span></li>)}</ul></Section>
            <Section title="Recent activity"><ul className="space-y-1 text-xs">{t.recentActivity.map((a) => <li key={a.id} className="flex justify-between gap-3"><span className="font-mono">{a.action}</span><span className="text-muted">{dateTime(a.createdAt)}</span></li>)}</ul></Section>
          </div>
        </div>
      )}
    </>
  );
}
