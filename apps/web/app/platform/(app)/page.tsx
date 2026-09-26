'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { inr, SubStatus, type SubState } from '@/components/subscription-bits';
import { toMinor } from '@/lib/format';

type T = { id: string; slug: string; name: string; status: string; currency: string; createdAt: string; staff: number; bookings: number; modules: string[]; domain: string | null; subscription: null | { state: SubState; cycle: string | null; price: number | null; coveredUntil: string; paidUntil: string | null; nextAction: string } };
type Rev = { collectedThisMonth: number; collectedThisFy: number; financialYear: string; pendingAmount: number; pendingCount: number; renewalsDue30: number; renewalsDue30Amount: number };
const TEMPLATES = ['beach', 'luxury', 'hill_station', 'heritage', 'urban_boutique', 'jungle', 'backwaters', 'desert', 'wellness', 'business'];
const PRESETS: Record<string, { label: string; modules: string[] }> = {
  resort: { label: 'Resort — everything', modules: ['room_booking', 'payments', 'offers', 'restaurant', 'restaurant.reservations', 'restaurant.ordering', 'room_service', 'guest_portal', 'housekeeping', 'maintenance', 'concierge', 'experiences', 'spa', 'transport', 'events', 'notifications', 'website_builder', 'reports', 'integrations'] },
  hotel: { label: 'Hotel — rooms & guest services', modules: ['room_booking', 'payments', 'offers', 'guest_portal', 'housekeeping', 'maintenance', 'concierge', 'transport', 'notifications', 'website_builder', 'reports'] },
  villa: { label: 'Villa — booking & website', modules: ['room_booking', 'payments', 'guest_portal', 'website_builder', 'notifications'] },
  restaurant: { label: 'Restaurant only', modules: ['restaurant', 'restaurant.reservations', 'restaurant.ordering', 'payments', 'website_builder', 'reports'] },
};

export default function Tenants() {
  const { data, error, mutate } = useStaff<{ data: T[] }>('/platform/tenants');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', slug: '', ownerName: '', ownerEmail: '', preset: 'hotel', templateKey: 'luxury', currency: 'INR', timezone: 'Asia/Kolkata', freeDays: '30', monthlyFee: '', yearlyFee: '' });
  const { data: rev } = useStaff<{ data: Rev }>('/platform/revenue');
  const { busy, run } = useAction();
  return (
    <>
      <PageHeader title="Tenants" sub={data && `${data.data.length} properties on the platform`} actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>Onboard a property</button>} />
      <ErrorNote error={error} />
      {rev && (
        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4" data-testid="platform-revenue">
          {[['Collected this month', inr(rev.data.collectedThisMonth), ''], [`Collected FY ${rev.data.financialYear}`, inr(rev.data.collectedThisFy), ''], ['Waiting for verification', inr(rev.data.pendingAmount), `${rev.data.pendingCount} payment${rev.data.pendingCount === 1 ? '' : 's'}`], ['Renewals in 30 days', String(rev.data.renewalsDue30), `≈ ${inr(rev.data.renewalsDue30Amount)} incl. GST`]].map(([k, v, sub]) => (
            <div key={k} className="bg-panel px-6 py-4"><dt className="text-xs text-muted">{k}</dt><dd className="num text-xl">{v}</dd>{sub && <dd className="text-xs text-muted">{sub}</dd>}</div>
          ))}
        </dl>
      )}
      {!data ? <Loading /> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th>Property</th><th>Subscription</th><th>Plan</th><th className="text-right">Price</th><th>Covered until</th><th>Next</th><th className="text-right">Bookings</th><th>Status</th></tr></thead>
            <tbody>{data.data.map((t) => (
              <tr key={t.id}>
                <td><Link className="font-medium hover:underline" href={`/platform/tenants/${t.id}`}>{t.name}</Link><p className="font-mono text-xs text-muted">{t.slug}</p></td>
                <td>{t.subscription && <SubStatus state={t.subscription.state} />}</td>
                <td className="text-muted">{t.subscription?.cycle ? human(t.subscription.cycle) : '—'}</td>
                <td className="num text-right">{t.subscription?.price ? inr(t.subscription.price) : '—'}</td>
                <td className="text-muted">{t.subscription && date(t.subscription.coveredUntil)}</td>
                <td className="text-xs">{t.subscription?.nextAction}</td>
                <td className="num text-right">{t.bookings}</td><td><Status value={t.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title="Onboard a property" sub="Creates the workspace, subdomain, roles, starter website and invites the owner."
        footer={<button className="btn btn-primary" disabled={busy || !f.name || !f.slug || !f.ownerEmail || !f.ownerName} onClick={() => run(() => staffApi('/platform/tenants', { body: { name: f.name, slug: f.slug, ownerName: f.ownerName, ownerEmail: f.ownerEmail, currency: f.currency, timezone: f.timezone, modules: PRESETS[f.preset]!.modules, templateKey: f.templateKey, freeDays: Number(f.freeDays || 0), monthlyFee: f.monthlyFee ? toMinor(f.monthlyFee) : null, yearlyFee: f.yearlyFee ? toMinor(f.yearlyFee) : null } }), 'Property created — owner invited by email').then((r) => { if (r) { setOpen(false); mutate(); } })}>Create property</button>}>
        <Section title="Property">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Property name" className="col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) })} /></Field>
            <Field label="Subdomain" hint={`${f.slug || 'name'}.bookez.in`}><input className="input font-mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
            <Field label="Currency"><input className="input" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
            <Field label="Setup" className="col-span-2"><select className="input" value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value })}>{Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></Field>
            <Field label="Website template" className="col-span-2"><select className="input" value={f.templateKey} onChange={(e) => setF({ ...f, templateKey: e.target.value })}>{TEMPLATES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></Field>
          </div>
        </Section>
        <Section title="Subscription">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Free days"><input className="input num" type="number" min={0} value={f.freeDays} onChange={(e) => setF({ ...f, freeDays: e.target.value })} /></Field>
            <Field label="Monthly fee (₹, excl. GST)"><input className="input num" inputMode="decimal" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} placeholder="2999" /></Field>
            <Field label="Yearly fee (₹, excl. GST)"><input className="input num" inputMode="decimal" value={f.yearlyFee} onChange={(e) => setF({ ...f, yearlyFee: e.target.value })} placeholder="29990" /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Leave a fee empty to not offer that option. You can change all of this later.</p>
        </Section>
        <Section title="Owner">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner name"><input className="input" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
            <Field label="Owner email"><input className="input" type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          </div>
        </Section>
      </Drawer>
    </>
  );
}
