'use client';

import { useEffect, useState } from 'react';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Section, Tabs, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { money, toMajor, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Outlet = { id: string; name: string; slug: string; kind: string; description: string | null; cuisine: string | null; location: string | null; acceptsReservations: boolean; acceptsOrders: boolean; active: boolean; settings: Record<string, number | boolean | null>; propertyId: string };
type Opt = { id: string; kind: 'variant' | 'addon'; groupName: string; name: string; priceDelta: number; isDefault: boolean; available: boolean };
type Item = { id: string; name: string; description: string | null; price: number; dietary: string[]; allergens: string[]; spiceLevel: number | null; prepMinutes: number; available: boolean; active: boolean; categoryId: string; options: Opt[] };
type Menu = { id: string; name: string; availableFrom: string | null; availableTo: string | null; categories: { id: string; name: string; items: Item[] }[] };
const DIETS = ['veg', 'non_veg', 'vegan', 'egg', 'gluten_free', 'jain', 'dairy_free'];
const ALLERGENS = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'molluscs'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Menus() {
  const { data: outlets, error, mutate: reloadOutlets } = useStaff<{ data: Outlet[] }>('/admin/restaurants');
  const [rid, setRid] = useState('');
  const [tab, setTab] = useState<'menu' | 'tables' | 'hours' | 'types' | 'settings'>('menu');
  useEffect(() => { if (!rid && outlets?.data[0]) setRid(outlets.data[0].id); }, [outlets, rid]);
  const outlet = outlets?.data.find((o) => o.id === rid);
  return (
    <>
      <PageHeader title="Menus & outlets" actions={<select className="input w-52" value={rid} onChange={(e) => setRid(e.target.value)}>{outlets?.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'menu', label: 'Menu' }, { value: 'tables', label: 'Tables & areas' }, { value: 'hours', label: 'Hours' }, { value: 'types', label: 'Order types' }, { value: 'settings', label: 'Outlet settings' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {!outlet ? <Loading /> : tab === 'menu' ? <MenuEditor outlet={outlet} /> : tab === 'tables' ? <TablesEditor rid={rid} /> : tab === 'hours' ? <HoursEditor rid={rid} /> : tab === 'types' ? <TypesEditor rid={rid} /> : <OutletSettings outlet={outlet} onSaved={reloadOutlets} />}
    </>
  );
}

function MenuEditor({ outlet }: { outlet: Outlet }) {
  const { data, mutate } = useStaff<{ data: Menu[] }>(`/admin/restaurants/${outlet.id}/menu`);
  const [edit, setEdit] = useState<Partial<Item> & { categoryId: string } | null>(null);
  const { busy, run } = useAction();
  const [newCat, setNewCat] = useState('');
  if (!data) return <Loading />;
  const menu = data.data[0];
  if (!menu) return <Empty title="No menu yet" action={<button className="btn btn-primary" onClick={() => run(() => staffApi('/admin/menus', { body: { restaurantId: outlet.id, name: 'All-day menu' } })).then(() => mutate())}>Create menu</button>} />;
  return (
    <div className="bg-panel">
      {menu.categories.map((c) => (
        <section key={c.id} className="border-b border-line">
          <header className="flex items-center justify-between px-6 pt-5 pb-2">
            <h2 className="text-[15px] font-semibold">{c.name}</h2>
            <button className="btn btn-sm" onClick={() => setEdit({ categoryId: c.id, dietary: [], allergens: [], price: 0, prepMinutes: 15, available: true, options: [] })}>Add item</button>
          </header>
          <ul>
            {c.items.map((i) => (
              <li key={i.id} className="grid cursor-pointer grid-cols-[1fr_auto] gap-4 px-6 py-2.5 hover:bg-[#faf9f7]" onClick={() => setEdit(i)}>
                <div className="min-w-0">
                  <p className={cx('text-[13px] font-medium', !i.available && 'text-muted line-through')}>{i.name} {i.dietary.includes('veg') || i.dietary.includes('vegan') ? <span className="ml-1 text-2xs text-ok">VEG</span> : i.dietary.includes('non_veg') ? <span className="ml-1 text-2xs text-bad">NON-VEG</span> : null}</p>
                  {i.description && <p className="truncate text-xs text-muted">{i.description}</p>}
                  {(i.options.length > 0 || i.allergens.length > 0) && <p className="text-2xs text-faint">{i.options.length ? `${i.options.length} options · ` : ''}{i.allergens.length ? `contains ${i.allergens.join(', ')}` : ''}</p>}
                </div>
                <p className="num text-[13px]">{money(i.price)}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form className="flex gap-2 px-6 py-4" onSubmit={(e) => { e.preventDefault(); if (newCat) run(() => staffApi('/admin/menu-categories', { body: { menuId: menu.id, name: newCat, sort: menu.categories.length } })).then(() => { setNewCat(''); mutate(); }); }}>
        <input className="input w-60" placeholder="New section, e.g. Salads" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn">Add section</button>
      </form>
      {edit && <ItemDrawer item={edit} restaurantId={outlet.id} onClose={() => setEdit(null)} onSaved={() => { mutate(); }} busy={busy} />}
    </div>
  );
}

function ItemDrawer({ item, restaurantId, onClose, onSaved }: { item: Partial<Item> & { categoryId: string }; restaurantId: string; onClose: () => void; onSaved: () => void; busy: boolean }) {
  const [f, setF] = useState({ name: item.name ?? '', description: item.description ?? '', price: toMajor(item.price ?? 0), prepMinutes: String(item.prepMinutes ?? 15), spiceLevel: item.spiceLevel == null ? '' : String(item.spiceLevel), dietary: item.dietary ?? [], allergens: item.allergens ?? [], available: item.available ?? true });
  const [opts, setOpts] = useState<Opt[]>(item.options ?? []);
  const [o, setO] = useState({ kind: 'addon' as 'variant' | 'addon', groupName: '', name: '', price: '0' });
  const { busy, run } = useAction();
  const toggle = (k: 'dietary' | 'allergens', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  async function save() {
    const body = { restaurantId, categoryId: item.categoryId, name: f.name, description: f.description || null, price: toMinor(f.price), prepMinutes: Number(f.prepMinutes), spiceLevel: f.spiceLevel === '' ? null : Number(f.spiceLevel), dietary: f.dietary, allergens: f.allergens, available: f.available };
    const r = await run(() => item.id ? staffApi(`/admin/menu-items/${item.id}`, { method: 'PATCH', body }) : staffApi('/admin/menu-items', { body }), 'Menu item saved');
    if (r) { onSaved(); onClose(); }
  }
  return (
    <Drawer open onClose={onClose} title={item.id ? item.name! : 'New menu item'}
      footer={<>{item.id && <button className="btn btn-danger mr-auto" onClick={() => run(() => staffApi(`/admin/menu-items/${item.id}`, { method: 'PATCH', body: { active: false } }), 'Removed from menu').then(() => { onSaved(); onClose(); })}>Remove</button>}<button className="btn btn-primary" disabled={busy || !f.name} onClick={save}>Save</button></>}>
      <Section>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" className="col-span-3"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Description" className="col-span-3"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Price (₹)"><input className="input num" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Prep minutes"><input className="input num" type="number" value={f.prepMinutes} onChange={(e) => setF({ ...f, prepMinutes: e.target.value })} /></Field>
          <Field label="Spice (0–3)"><input className="input num" type="number" min={0} max={3} value={f.spiceLevel} onChange={(e) => setF({ ...f, spiceLevel: e.target.value })} /></Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} /> Available now (untick when sold out)</label>
      </Section>
      <Section title="Dietary">
        <div className="flex flex-wrap gap-1.5">{DIETS.map((d) => <button key={d} className={cx('btn btn-sm', f.dietary.includes(d) && 'btn-primary')} onClick={() => toggle('dietary', d)}>{d.replace('_', ' ')}</button>)}</div>
      </Section>
      <Section title="Allergens">
        <div className="flex flex-wrap gap-1.5">{ALLERGENS.map((d) => <button key={d} className={cx('btn btn-sm', f.allergens.includes(d) && 'btn-primary')} onClick={() => toggle('allergens', d)}>{d.replace('_', ' ')}</button>)}</div>
      </Section>
      {item.id && (
        <Section title="Variants & add-ons">
          <ul className="mb-3 divide-y divide-line text-[13px]">
            {opts.map((x) => <li key={x.id} className="flex justify-between py-1.5"><span><span className="text-muted">{x.groupName}:</span> {x.name}{x.isDefault && <span className="text-xs text-muted"> (default)</span>} <span className="text-2xs text-faint">{x.kind}</span></span><span className="flex gap-3"><span className="num">{x.priceDelta ? `+${money(x.priceDelta)}` : '—'}</span><button className="text-xs text-muted hover:text-bad" onClick={() => run(() => staffApi(`/admin/menu-item-options/${x.id}`, { method: 'DELETE' })).then(() => setOpts(opts.filter((y) => y.id !== x.id)))}>remove</button></span></li>)}
          </ul>
          <div className="grid grid-cols-[90px_1fr_1fr_80px_auto] gap-2">
            <select className="input" value={o.kind} onChange={(e) => setO({ ...o, kind: e.target.value as 'addon' })}><option value="addon">Add-on</option><option value="variant">Variant</option></select>
            <input className="input" placeholder={o.kind === 'variant' ? 'Group: Portion' : 'Group: Sides'} value={o.groupName} onChange={(e) => setO({ ...o, groupName: e.target.value })} />
            <input className="input" placeholder="Name" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
            <input className="input num" placeholder="+₹" value={o.price} onChange={(e) => setO({ ...o, price: e.target.value })} />
            <button className="btn" disabled={!o.groupName || !o.name} onClick={() => run(() => staffApi<{ data: Opt }>('/admin/menu-item-options', { body: { menuItemId: item.id, kind: o.kind, groupName: o.groupName, name: o.name, priceDelta: toMinor(o.price || '0'), isDefault: o.kind === 'variant' && !opts.some((x) => x.groupName === o.groupName) } })).then((r) => { if (r) { setOpts([...opts, r.data]); setO({ ...o, name: '', price: '0' }); } })}>Add</button>
          </div>
          <p className="hint">Variants: guest picks exactly one per group (e.g. Regular / Large). Add-ons: optional extras.</p>
        </Section>
      )}
    </Drawer>
  );
}

function TablesEditor({ rid }: { rid: string }) {
  const { data: areas, mutate: ma } = useStaff<{ data: { id: string; name: string }[] }>(`/admin/dining-areas?restaurantId=${rid}`);
  const { data: tables, mutate: mt } = useStaff<{ data: { id: string; label: string; capacity: number; minCapacity: number; diningAreaId: string | null; status: string }[] }>(`/admin/restaurant-tables?restaurantId=${rid}`);
  const { run } = useAction();
  const [t, setT] = useState({ label: '', capacity: '2', minCapacity: '1', diningAreaId: '' });
  const [area, setArea] = useState('');
  if (!areas || !tables) return <Loading />;
  return (
    <div className="grid gap-px bg-line md:grid-cols-[1fr_280px]">
      <div className="bg-panel">
        <table className="tbl">
          <thead><tr><th>Table</th><th>Area</th><th className="text-right">Seats</th><th>Status</th><th /></tr></thead>
          <tbody>{tables.data.map((x) => (
            <tr key={x.id}><td className="font-medium">{x.label}</td><td>{areas.data.find((a) => a.id === x.diningAreaId)?.name ?? '—'}</td><td className="num text-right">{x.minCapacity}–{x.capacity}</td>
              <td><select className="input h-7 w-36" value={x.status} onChange={(e) => run(() => staffApi(`/admin/restaurant-tables/${x.id}`, { method: 'PATCH', body: { status: e.target.value } }), 'Table updated').then(() => mt())}><option value="available">Available</option><option value="out_of_service">Out of service</option></select></td>
              <td className="text-right"><button className="text-xs text-muted hover:text-bad" onClick={() => run(() => staffApi(`/admin/restaurant-tables/${x.id}`, { method: 'DELETE' }), 'Table removed').then(() => mt())}>Remove</button></td></tr>
          ))}</tbody>
        </table>
        <form className="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 px-3 py-3" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/restaurant-tables', { body: { restaurantId: rid, label: t.label, capacity: Number(t.capacity), minCapacity: Number(t.minCapacity), diningAreaId: t.diningAreaId || null, sort: tables.data.length } }), 'Table added').then(() => { setT({ ...t, label: '' }); mt(); }); }}>
          <input className="input" placeholder="Label, e.g. T7" required value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} />
          <select className="input" value={t.diningAreaId} onChange={(e) => setT({ ...t, diningAreaId: e.target.value })}><option value="">No area</option>{areas.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input className="input num" type="number" min={1} title="Min seats" value={t.minCapacity} onChange={(e) => setT({ ...t, minCapacity: e.target.value })} />
          <input className="input num" type="number" min={1} title="Max seats" value={t.capacity} onChange={(e) => setT({ ...t, capacity: e.target.value })} />
          <button className="btn">Add table</button>
        </form>
      </div>
      <div className="bg-panel p-4">
        <p className="eyebrow mb-2">Dining areas</p>
        <ul className="mb-3 text-[13px]">{areas.data.map((a) => <li key={a.id} className="py-1">{a.name}</li>)}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/dining-areas', { body: { restaurantId: rid, name: area } })).then(() => { setArea(''); ma(); }); }}><input className="input" placeholder="Terrace" value={area} onChange={(e) => setArea(e.target.value)} required /><button className="btn">Add</button></form>
      </div>
    </div>
  );
}

function HoursEditor({ rid }: { rid: string }) {
  const { data, mutate } = useStaff<{ data: { id: string; dayOfWeek: number; service: string; opens: string; closes: string }[] }>(`/admin/restaurant-hours?restaurantId=${rid}`);
  const { data: special, mutate: ms } = useStaff<{ data: { id: string; date: string; closed: boolean; opens: string | null; closes: string | null; note: string | null }[] }>(`/admin/restaurant-special-hours?restaurantId=${rid}`);
  const { run } = useAction();
  const [h, setH] = useState({ days: [1, 2, 3, 4, 5, 6, 0], service: 'Dinner', opens: '19:00', closes: '22:30' });
  const [s, setS] = useState({ date: '', closed: true, note: '' });
  if (!data || !special) return <Loading />;
  return (
    <div className="bg-panel">
      <div className="grid gap-px bg-line md:grid-cols-7">
        {DAYS.map((d, i) => (
          <div key={d} className="bg-panel p-3 text-[13px]">
            <p className="mb-2 font-medium">{d}</p>
            {data.data.filter((x) => x.dayOfWeek === i).sort((a, b) => a.opens.localeCompare(b.opens)).map((x) => (
              <p key={x.id} className="group flex justify-between py-0.5 text-xs"><span><span className="text-muted">{x.service}</span><br />{x.opens.slice(0, 5)}–{x.closes.slice(0, 5)}</span><button className="invisible text-muted group-hover:visible hover:text-bad" onClick={() => run(() => staffApi(`/admin/restaurant-hours/${x.id}`, { method: 'DELETE' })).then(() => mutate())}>×</button></p>
            ))}
          </div>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2 border-y border-line px-6 py-4" onSubmit={(e) => { e.preventDefault(); run(async () => { for (const d of h.days) await staffApi('/admin/restaurant-hours', { body: { restaurantId: rid, dayOfWeek: d, service: h.service, opens: h.opens, closes: h.closes } }); }, 'Hours added').then(() => mutate()); }}>
        <Field label="Service"><input className="input w-32" value={h.service} onChange={(e) => setH({ ...h, service: e.target.value })} /></Field>
        <Field label="Opens"><input className="input" type="time" value={h.opens} onChange={(e) => setH({ ...h, opens: e.target.value })} /></Field>
        <Field label="Closes"><input className="input" type="time" value={h.closes} onChange={(e) => setH({ ...h, closes: e.target.value })} /></Field>
        <div className="flex gap-1">{DAYS.map((d, i) => <button type="button" key={d} className={cx('btn btn-sm w-10', h.days.includes(i) && 'btn-primary')} onClick={() => setH({ ...h, days: h.days.includes(i) ? h.days.filter((x) => x !== i) : [...h.days, i] })}>{d}</button>)}</div>
        <button className="btn">Add hours</button>
      </form>
      <div className="px-6 py-4">
        <p className="eyebrow mb-2">Special hours & blackout dates</p>
        <ul className="mb-3 text-[13px]">{special.data.map((x) => <li key={x.id} className="flex gap-4 py-1"><span className="w-28">{x.date}</span><span>{x.closed ? 'Closed' : `${x.opens}–${x.closes}`}</span><span className="text-muted">{x.note}</span><button className="text-xs text-muted hover:text-bad" onClick={() => run(() => staffApi(`/admin/restaurant-special-hours/${x.id}`, { method: 'DELETE' })).then(() => ms())}>remove</button></li>)}</ul>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/restaurant-special-hours', { body: { restaurantId: rid, date: s.date, closed: true, note: s.note || null } }), 'Blackout date added').then(() => ms()); }}>
          <input className="input w-40" type="date" required value={s.date} onChange={(e) => setS({ ...s, date: e.target.value })} /><input className="input w-64" placeholder="Private event" value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} /><button className="btn">Close this date</button>
        </form>
      </div>
    </div>
  );
}

function TypesEditor({ rid }: { rid: string }) {
  const { data, mutate } = useStaff<{ data: { id: string; name: string; key: string; locationMode: string; areas: string[]; paymentModes: string[]; requiresStay: boolean; allowScheduling: boolean; cancelWindowMinutes: number; moduleKey: string; active: boolean }[] }>(`/admin/order-types?restaurantId=${rid}`);
  const { run } = useAction();
  if (!data) return <Loading />;
  return (
    <div className="bg-panel">
      <table className="tbl">
        <thead><tr><th>Order type</th><th>Delivered to</th><th>Payment</th><th>Rules</th><th>Active</th></tr></thead>
        <tbody>{data.data.map((t) => (
          <tr key={t.id}>
            <td className="font-medium">{t.name}<p className="text-xs text-muted">{t.moduleKey === 'room_service' ? 'Room Service module' : 'Ordering module'}</p></td>
            <td>{t.locationMode === 'room' ? 'Guest’s room (from their stay)' : t.locationMode === 'area' ? t.areas.join(', ') : t.locationMode}</td>
            <td className="text-xs">{t.paymentModes.map((p) => p.replace(/_/g, ' ')).join(', ')}</td>
            <td className="text-xs text-muted">{t.requiresStay ? 'In-house only · ' : ''}{t.allowScheduling ? 'Can schedule · ' : ''}cancel within {t.cancelWindowMinutes} min</td>
            <td><input type="checkbox" checked={t.active} onChange={(e) => run(() => staffApi(`/admin/order-types/${t.id}`, { method: 'PATCH', body: { active: e.target.checked } }), 'Saved').then(() => mutate())} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OutletSettings({ outlet, onSaved }: { outlet: Outlet; onSaved: () => void }) {
  const [f, setF] = useState({ name: outlet.name, description: outlet.description ?? '', cuisine: outlet.cuisine ?? '', location: outlet.location ?? '', acceptsReservations: outlet.acceptsReservations, acceptsOrders: outlet.acceptsOrders, ...Object.fromEntries(Object.entries(outlet.settings).map(([k, v]) => [k, v])) } as Record<string, string | number | boolean | null>);
  const { busy, run } = useAction();
  const num = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input num" type="number" value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) })} /></Field>;
  return (
    <div className="max-w-3xl bg-panel">
      <Section title="Outlet">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" value={String(f.name)} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Cuisine"><input className="input" value={String(f.cuisine)} onChange={(e) => setF({ ...f, cuisine: e.target.value })} /></Field>
          <Field label="Location" className="col-span-2"><input className="input" value={String(f.location)} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Description" className="col-span-2"><textarea className="input" rows={3} value={String(f.description)} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex gap-6 text-[13px]"><label className="flex items-center gap-2"><input type="checkbox" checked={!!f.acceptsReservations} onChange={(e) => setF({ ...f, acceptsReservations: e.target.checked })} /> Takes reservations</label><label className="flex items-center gap-2"><input type="checkbox" checked={!!f.acceptsOrders} onChange={(e) => setF({ ...f, acceptsOrders: e.target.checked })} /> Takes orders</label></div>
      </Section>
      <Section title="Reservation rules">
        <div className="grid grid-cols-3 gap-3">
          {num('slotMinutes', 'Slot interval (min)')}{num('defaultDurationMinutes', 'Table time (min)')}{num('reservationWindowDays', 'Book up to (days ahead)')}
          {num('minLeadMinutes', 'Minimum notice (min)')}{num('maxPartySize', 'Largest online party')}{num('maxCoversPerSlot', 'Max covers per slot', 'Blank = tables only')}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!f.autoConfirm} onChange={(e) => setF({ ...f, autoConfirm: e.target.checked })} /> Confirm online bookings automatically</label>
      </Section>
      <div className="px-5 py-4"><button className="btn btn-primary" disabled={busy} onClick={() => {
        const { name, description, cuisine, location, acceptsReservations, acceptsOrders, ...settings } = f;
        run(() => staffApi(`/admin/restaurants/${outlet.id}`, { method: 'PATCH', body: { name, description: description || null, cuisine: cuisine || null, location: location || null, acceptsReservations, acceptsOrders, settings } }), 'Outlet saved').then(onSaved);
      }}>Save outlet</button></div>
    </div>
  );
}
