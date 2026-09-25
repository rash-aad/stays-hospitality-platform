'use client';

import { useEffect, useState } from 'react';
import { Resource, type FieldDef } from '@/components/resource';
import { ErrorNote, Field, Loading, PageHeader, Section, Status, Tabs, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type P = { id: string; name: string; tagline: string | null; description: string | null; addressLine: string | null; city: string | null; region: string | null; country: string; postalCode: string | null; phone: string | null; email: string | null; timezone: string; checkInTime: string; checkOutTime: string; latitude: number | null; longitude: number | null; starRating: number | null; amenities: string[]; images: { url: string; alt: string }[] };
type RT = { id: string; name: string; slug: string; baseOccupancy: number; maxOccupancy: number; maxAdults: number; maxChildren: number; bedConfig: string | null; sizeSqm: number | null; active: boolean; images: { url: string }[] };
type Room = { id: string; number: string; floor: string | null; roomTypeId: string; status: string; housekeepingStatus: string };

export default function PropertyPage() {
  const [tab, setTab] = useState<'profile' | 'types' | 'rooms'>('profile');
  const { data, error, mutate } = useStaff<{ data: P[] }>('/admin/properties');
  const { data: types } = useStaff<{ data: RT[] }>('/admin/room-types');
  const p = data?.data[0];
  const rtFields: FieldDef[] = [
    { key: 'name', label: 'Name', required: true }, { key: 'slug', label: 'URL slug', required: true, hint: 'lowercase-with-dashes' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'baseOccupancy', label: 'Guests included in rate', type: 'number', defaultValue: 2 }, { key: 'maxOccupancy', label: 'Maximum guests', type: 'number', defaultValue: 3 },
    { key: 'maxAdults', label: 'Max adults', type: 'number', defaultValue: 3 }, { key: 'maxChildren', label: 'Max children', type: 'number', defaultValue: 1 },
    { key: 'bedConfig', label: 'Beds', hint: 'King or twin' }, { key: 'sizeSqm', label: 'Size (m²)', type: 'number' }, { key: 'view', label: 'View' },
    { key: 'sort', label: 'Order', type: 'number', defaultValue: 0 },
    { key: 'amenities', label: 'Amenities', type: 'tags', wide: true, hint: 'Comma separated' },
    { key: 'images', label: 'Main photo URL', type: 'image', wide: true },
    { key: 'active', label: 'Bookable', type: 'bool', defaultValue: true, hint: 'Show on the website and accept bookings' },
  ];
  const roomFields: FieldDef[] = [
    { key: 'number', label: 'Room number', required: true }, { key: 'floor', label: 'Floor' },
    { key: 'roomTypeId', label: 'Room type', type: 'select', required: true, options: (types?.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'In service' }, { value: 'out_of_service', label: 'Out of service' }], defaultValue: 'active' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <>
      <PageHeader title="Property & rooms"><Tabs value={tab} onChange={setTab} items={[{ value: 'profile', label: 'Property' }, { value: 'types', label: 'Room types' }, { value: 'rooms', label: 'Rooms' }]} /></PageHeader>
      <ErrorNote error={error} />
      {!p ? <Loading /> : tab === 'profile' ? <Profile p={p} onSaved={() => mutate()} />
        : tab === 'types' ? <Resource<RT> endpoint="/admin/room-types" noun="Room type" fields={rtFields} extra={{ propertyId: p.id }} imageArrays={['images']}
            columns={[{ label: 'Room type', render: (r) => <span className="font-medium">{r.name}</span> }, { label: 'Sleeps', render: (r) => `${r.baseOccupancy}–${r.maxOccupancy}` }, { label: 'Beds', render: (r) => r.bedConfig ?? '—' }, { label: 'Size', render: (r) => (r.sizeSqm ? `${r.sizeSqm} m²` : '—') }, { label: 'Bookable', render: (r) => (r.active ? 'Yes' : 'No') }]} />
        : <Resource<Room> endpoint="/admin/rooms" noun="Room" fields={roomFields} extra={{ propertyId: p.id }}
            columns={[{ label: 'Room', render: (r) => <span className="font-medium">{r.number}</span> }, { label: 'Floor', render: (r) => r.floor ?? '—' }, { label: 'Type', render: (r) => types?.data.find((t) => t.id === r.roomTypeId)?.name }, { label: 'Status', render: (r) => <Status value={r.status === 'active' ? 'active' : 'out_of_service'} label={r.status === 'active' ? 'In service' : 'Out of service'} /> }, { label: 'Housekeeping', render: (r) => human(r.housekeepingStatus) }]} />}
    </>
  );
}

function Profile({ p, onSaved }: { p: P; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  useEffect(() => setF(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? (k === 'images' ? (v as { url: string }[]).map((i) => i.url).join('\n') : v.join(', ')) : v == null ? '' : String(v)]))), [p]);
  const t = (k: string, label: string, props: Record<string, unknown> = {}) => <Field label={label} className={props.wide ? 'col-span-2' : ''}><input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>;
  return (
    <div className="max-w-3xl bg-panel">
      <Section title="Identity">
        <div className="grid grid-cols-2 gap-3">
          {t('name', 'Property name')}{t('tagline', 'Tagline')}
          <Field label="Description" className="col-span-2"><textarea className="input" rows={4} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {t('starRating', 'Star rating', { type: 'number', min: 1, max: 7 })}
        </div>
      </Section>
      <Section title="Contact & location">
        <div className="grid grid-cols-2 gap-3">
          {t('phone', 'Phone')}{t('email', 'Email', { type: 'email' })}{t('addressLine', 'Address', { wide: true })}{t('city', 'City')}{t('region', 'State')}{t('postalCode', 'PIN code')}{t('country', 'Country (ISO code)', { maxLength: 2 })}
          {t('latitude', 'Latitude', { inputMode: 'decimal' })}{t('longitude', 'Longitude', { inputMode: 'decimal' })}
        </div>
      </Section>
      <Section title="Arrivals">
        <div className="grid grid-cols-3 gap-3">{t('checkInTime', 'Check-in from', { type: 'time' })}{t('checkOutTime', 'Check-out by', { type: 'time' })}{t('timezone', 'Time zone')}</div>
      </Section>
      <Section title="Amenities & photos">
        <Field label="Amenities" hint="Comma separated"><input className="input" value={f.amenities ?? ''} onChange={(e) => setF({ ...f, amenities: e.target.value })} /></Field>
        <Field label="Photo URLs" hint="One per line — the first is used across the site and portal" className="mt-3"><textarea className="input font-mono text-xs" rows={3} value={f.images ?? ''} onChange={(e) => setF({ ...f, images: e.target.value })} /></Field>
      </Section>
      <div className="px-5 py-4"><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/properties/${p.id}`, { method: 'PATCH', body: {
        name: f.name, tagline: f.tagline || null, description: f.description || null, phone: f.phone || null, email: f.email || null, addressLine: f.addressLine || null, city: f.city || null, region: f.region || null,
        postalCode: f.postalCode || null, country: (f.country || 'IN').toUpperCase(), latitude: f.latitude ? Number(f.latitude) : null, longitude: f.longitude ? Number(f.longitude) : null,
        starRating: f.starRating ? Number(f.starRating) : null, checkInTime: f.checkInTime?.slice(0, 5), checkOutTime: f.checkOutTime?.slice(0, 5), timezone: f.timezone,
        amenities: (f.amenities ?? '').split(',').map((s) => s.trim()).filter(Boolean), images: (f.images ?? '').split('\n').map((u) => u.trim()).filter(Boolean).map((url) => ({ url, alt: f.name ?? '' })),
      } }), 'Property saved').then(() => onSaved())}>Save property</button></div>
    </div>
  );
}
