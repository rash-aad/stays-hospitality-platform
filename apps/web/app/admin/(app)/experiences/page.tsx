'use client';

import { useState } from 'react';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Section, Status, Tabs, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, human, isoToday, money, time, toMajor, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Slot = { id: string; startsAt: string; capacity: number; booked: number; status: string; experienceName: string; kind: string; bookings: { id: string; reference: string; guestName: string; participants: number; status: string; paymentStatus: string; total: number }[] };
type Exp = { id: string; kind: string; name: string; slug: string; summary: string | null; description: string | null; durationMinutes: number; price: number; pricePer: string; maxParticipants: number; location: string | null; active: boolean; bookableByGuests: boolean; requiresPayment: boolean; propertyId: string; images: { url: string; alt: string }[] };

export default function Experiences() {
  const [tab, setTab] = useState<'schedule' | 'catalog'>('schedule');
  const [from, setFrom] = useState(isoToday());
  const { data: sched, error, mutate } = useStaff<{ data: Slot[] }>(tab === 'schedule' ? `/admin/experience-schedule?from=${from}&days=7` : null);
  const { data: cat, mutate: mc } = useStaff<{ data: Exp[] }>('/admin/experiences');
  const { data: props } = useStaff<{ data: { id: string }[] }>('/admin/properties');
  const [edit, setEdit] = useState<Partial<Exp> | null>(null);
  const [slots, setSlots] = useState({ from: isoToday(1), to: isoToday(30), times: '07:00', capacity: '6' });
  const { busy, run } = useAction();
  const days = [...new Set(sched?.data.map((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) ?? [])];

  return (
    <>
      <PageHeader title="Experiences" sub="Activities, spa treatments, tours and transfers guests can book." actions={tab === 'catalog' ? <button className="btn btn-primary" onClick={() => setEdit({ kind: 'activity', durationMinutes: 60, price: 0, pricePer: 'person', maxParticipants: 2, active: true, bookableByGuests: true, images: [] })}>New experience</button> : <input className="input w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'schedule', label: 'Schedule' }, { value: 'catalog', label: 'Catalogue' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {tab === 'schedule' ? (!sched ? <Loading /> : sched.data.length === 0 ? <Empty title="No sessions this week">Add time slots from the catalogue.</Empty> : (
        <div className="bg-panel">
          {days.map((d) => (
            <section key={d} className="border-b border-line">
              <h2 className="eyebrow px-6 pt-4 pb-2">{date(d, 'long')}</h2>
              <ul>{sched.data.filter((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === d).map((s) => (
                <li key={s.id} className="grid grid-cols-[70px_1fr_auto] gap-4 px-6 py-2 text-[13px]">
                  <span className="num font-medium">{time(s.startsAt)}</span>
                  <div>
                    <p className="font-medium">{s.experienceName} <span className="font-normal text-muted">· {human(s.kind)}</span></p>
                    {s.bookings.filter((b) => b.status !== 'cancelled').map((b) => (
                      <p key={b.id} className="flex items-center gap-2 text-xs">{b.guestName} × {b.participants} <Status value={b.status} />
                        {b.status === 'confirmed' && <><button className="text-muted underline" onClick={() => run(() => staffApi(`/admin/experience-bookings/${b.id}/status`, { body: { status: 'completed' } }), 'Completed').then(() => mutate())}>done</button><button className="text-muted underline" onClick={() => run(() => staffApi(`/admin/experience-bookings/${b.id}/status`, { body: { status: 'no_show' } }), 'No-show').then(() => mutate())}>no-show</button></>}
                      </p>
                    ))}
                  </div>
                  <span className="text-right text-xs"><span className="num">{s.booked}/{s.capacity}</span><br /><button className="text-muted underline" onClick={() => run(() => staffApi(`/admin/experience-slots/${s.id}`, { method: 'PATCH', body: { status: s.status === 'open' ? 'closed' : 'open' } }), s.status === 'open' ? 'Slot closed' : 'Slot reopened').then(() => mutate())}>{s.status === 'open' ? 'close' : 'reopen'}</button></span>
                </li>
              ))}</ul>
            </section>
          ))}
        </div>
      )) : !cat ? <Loading /> : (
        <div className="bg-panel">
          <table className="tbl">
            <thead><tr><th>Experience</th><th>Type</th><th className="text-right">Duration</th><th className="text-right">Price</th><th>Online</th></tr></thead>
            <tbody>{cat.data.map((e) => (
              <tr key={e.id} className="is-link" onClick={() => setEdit(e)}><td className="font-medium">{e.name}<p className="text-xs text-muted">{e.summary}</p></td><td>{human(e.kind)}</td><td className="num text-right">{e.durationMinutes} min</td><td className="num text-right">{money(e.price)} <span className="text-xs text-muted">/{e.pricePer}</span></td><td>{e.active && e.bookableByGuests ? 'Yes' : 'No'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name! : 'New experience'}
        footer={<button className="btn btn-primary" disabled={busy || !edit?.name || !edit.slug} onClick={() => {
          const { id, ...rest } = edit!;
          const body = { propertyId: rest.propertyId ?? props?.data[0]?.id, kind: rest.kind, name: rest.name, slug: rest.slug, summary: rest.summary ?? null, description: rest.description ?? null, durationMinutes: Number(rest.durationMinutes), price: Number(rest.price), pricePer: rest.pricePer, maxParticipants: Number(rest.maxParticipants), location: rest.location ?? null, active: rest.active, bookableByGuests: rest.bookableByGuests, images: rest.images ?? [] };
          run(() => id ? staffApi(`/admin/experiences/${id}`, { method: 'PATCH', body }) : staffApi('/admin/experiences', { body }), 'Saved').then((r) => { if (r) { mc(); setEdit(null); } });
        }}>Save</button>}>
        {edit && (
          <>
            <Section>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" className="col-span-2"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value, slug: edit.id ? edit.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Field>
                <Field label="Type"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{['activity', 'tour', 'spa', 'transfer', 'dining', 'class'].map((k) => <option key={k} value={k}>{human(k)}</option>)}</select></Field>
                <Field label="Location"><input className="input" value={edit.location ?? ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></Field>
                <Field label="Summary" className="col-span-2"><input className="input" value={edit.summary ?? ''} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} /></Field>
                <Field label="Duration (min)"><input className="input num" type="number" value={edit.durationMinutes} onChange={(e) => setEdit({ ...edit, durationMinutes: Number(e.target.value) })} /></Field>
                <Field label="Max per booking"><input className="input num" type="number" value={edit.maxParticipants} onChange={(e) => setEdit({ ...edit, maxParticipants: Number(e.target.value) })} /></Field>
                <Field label="Price (₹)"><input className="input num" value={toMajor(edit.price ?? 0)} onChange={(e) => setEdit({ ...edit, price: toMinor(e.target.value || '0') })} /></Field>
                <Field label="Priced per"><select className="input" value={edit.pricePer} onChange={(e) => setEdit({ ...edit, pricePer: e.target.value })}><option value="person">Person</option><option value="booking">Booking</option></select></Field>
                <Field label="Image URL" className="col-span-2"><input className="input" value={edit.images?.[0]?.url ?? ''} onChange={(e) => setEdit({ ...edit, images: e.target.value ? [{ url: e.target.value, alt: edit.name ?? '' }] : [] })} /></Field>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!edit.bookableByGuests} onChange={(e) => setEdit({ ...edit, bookableByGuests: e.target.checked })} /> Guests can book online</label>
            </Section>
            {edit.id && (
              <Section title="Add time slots">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From"><input className="input" type="date" value={slots.from} onChange={(e) => setSlots({ ...slots, from: e.target.value })} /></Field>
                  <Field label="To"><input className="input" type="date" value={slots.to} onChange={(e) => setSlots({ ...slots, to: e.target.value })} /></Field>
                  <Field label="Start times" hint="Comma separated, 24-hour"><input className="input" value={slots.times} onChange={(e) => setSlots({ ...slots, times: e.target.value })} /></Field>
                  <Field label="Places per slot"><input className="input num" type="number" value={slots.capacity} onChange={(e) => setSlots({ ...slots, capacity: e.target.value })} /></Field>
                </div>
                <button className="btn mt-3" disabled={busy} onClick={() => run(() => staffApi<{ data: { created: number } }>(`/admin/experiences/${edit.id}/slots`, { body: { from: slots.from, to: slots.to, times: slots.times.split(',').map((t) => t.trim()).filter(Boolean), capacity: Number(slots.capacity) } }), 'Time slots created').then((r) => r && alertOk(r.data.created))}>Create slots</button>
              </Section>
            )}
          </>
        )}
      </Drawer>
    </>
  );
  function alertOk(n: number) { mutate(); void n; }
}
