'use client';

import { useState } from 'react';
import { ErrorNote, Loading, Modal, PageHeader, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type M = { key: string; name: string; group: string; requires: string[]; enabled: boolean };
const WHAT: Record<string, string> = {
  room_booking: 'Room search, rates and direct bookings on your website.', payments: 'Online UPI payments (own UPI ID or gateway).', offers: 'Offers on the website and in the guest portal.',
  restaurant: 'Outlets, tables and menus.', 'restaurant.reservations': 'Table bookings from the website, portal and phone.', 'restaurant.ordering': 'Guests order food and drinks; the kitchen queue.',
  room_service: 'In-room dining delivered to the guest’s room.', guest_portal: 'The guest app: stay details, requests, bill, guide.', housekeeping: 'Room board, cleaning tasks, inspections, lost & found.',
  maintenance: 'Guest and staff repair tickets with photos.', concierge: 'Front desk requests: wake-up calls, late checkout, luggage.', experiences: 'Activities and tours with bookable time slots.',
  spa: 'Spa treatments as bookable experiences.', transport: 'Airport transfers and transport requests.', events: 'Wedding, conference and celebration enquiries.',
  notifications: 'Edit the emails and messages guests receive.', website_builder: 'Visual website editor, templates and domains.', reports: 'Occupancy, revenue and operations reports.', integrations: 'Channel manager, POS, SMS and WhatsApp connections.',
};

export default function Modules() {
  const { data, error, mutate } = useStaff<{ data: M[] }>('/admin/modules');
  const { busy, run } = useAction();
  const [off, setOff] = useState<{ m: M; deps: M[] } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Optimistic: the switch moves immediately and snaps back if the server refuses.
  const toggle = (m: M, enabled: boolean) => {
    setPending((p) => ({ ...p, [m.key]: enabled }));
    return run(() => staffApi(`/admin/modules/${m.key}`, { method: 'PUT', body: { enabled } }), `${m.name} ${enabled ? 'on' : 'off'}`)
      .then(() => mutate()).finally(() => { setOff(null); setPending((p) => { const n = { ...p }; delete n[m.key]; return n; }); });
  };
  const groups = [...new Set(data?.data.map((m) => m.group))];
  const name = (k: string) => data?.data.find((m) => m.key === k)?.name ?? k;
  return (
    <>
      <PageHeader title="Modules" sub="Switch capabilities on or off for your property. Switched-off modules disappear for staff and guests, and their actions are refused by the server." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <div className="max-w-4xl bg-panel">
          {groups.map((g) => (
            <section key={g} className="border-b border-line">
              <h2 className="eyebrow px-6 pt-5 pb-1">{g}</h2>
              <ul>
                {data.data.filter((m) => m.group === g).map((m) => {
                  const blocked = !m.enabled && m.requires.some((r) => !data.data.find((x) => x.key === r)?.enabled);
                  const dependents = data.data.filter((x) => x.requires.includes(m.key) && x.enabled);
                  return (
                    <li key={m.key} className="flex items-start justify-between gap-6 px-6 py-3">
                      <div>
                        <p className="text-[13px] font-medium">{m.name}</p>
                        <p className="text-[13px] text-muted">{WHAT[m.key]}</p>
                        {m.requires.length > 0 && <p className="mt-0.5 text-xs text-faint">Needs {m.requires.map(name).join(', ')}</p>}
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-[13px]" title={blocked ? `Enable ${m.requires.map(name).join(', ')} first` : undefined}>
                        <input type="checkbox" role="switch" aria-label={m.name} checked={pending[m.key] ?? m.enabled} disabled={busy || blocked}
                          onChange={(e) => (!e.target.checked && dependents.length ? setOff({ m, deps: dependents }) : toggle(m, e.target.checked))} />
                        {(pending[m.key] ?? m.enabled) ? 'On' : 'Off'}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!off} onClose={() => setOff(null)} title={`Switch off ${off?.m.name}?`}
        footer={<><button className="btn" onClick={() => setOff(null)}>Keep it on</button><button className="btn btn-primary" disabled={busy} onClick={() => toggle(off!.m, false)}>Switch off</button></>}>
        This also switches off {off?.deps.map((d) => d.name).join(', ')}, which depend on it. Existing records are kept and come back when you switch it on again.
      </Modal>
    </>
  );
}
