'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorNote, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type Policy = 'off' | 'admins' | 'all';
const OPTIONS: { value: Policy; title: string; body: string }[] = [
  { value: 'off', title: 'Optional', body: 'Each person decides for themselves in Your account.' },
  { value: 'admins', title: 'Owners and managers', body: 'Required for anyone who can manage staff or settings. Recommended.' },
  { value: 'all', title: 'Everyone', body: 'Required for all staff. Shared devices enrolled for PIN sign-in count as the second step.' },
];

export default function SecuritySettings() {
  const { data, error, mutate } = useStaff<{ data: { requireMfa: Policy } }>('/admin/security-settings');
  const [v, setV] = useState<Policy | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data && !v) setV(data.data.requireMfa); }, [data, v]);
  if (!v) return <><PageHeader title="Security" /><ErrorNote error={error} /><Loading /></>;
  return (
    <>
      <PageHeader title="Security" sub="Who must use two-step sign-in. People affected are asked to set it up the next time they use the admin (within 15 minutes)."
        actions={<button className="btn btn-primary" disabled={busy || v === data?.data.requireMfa} onClick={() => run(() => staffApi('/admin/security-settings', { method: 'PUT', body: { requireMfa: v } }), 'Security policy saved').then(() => mutate())}>Save</button>} />
      <div className="max-w-3xl bg-panel">
        <Section title="Require two-step sign-in for">
          <ul className="divide-y divide-line">
            {OPTIONS.map((o) => (
              <li key={o.value} className="py-3">
                <label className="flex items-start gap-3">
                  <input type="radio" name="policy" className="mt-1" checked={v === o.value} onChange={() => setV(o.value)} />
                  <span><span className="block text-[13px] font-medium">{o.title}</span><span className="block text-[13px] text-muted">{o.body}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">Set it up for your own account first in <Link className="underline" href="/admin/account">Your account</Link>. If someone loses their phone, reset it from <Link className="underline" href="/admin/settings/staff">Staff &amp; roles</Link>.</p>
        </Section>
      </div>
    </>
  );
}
