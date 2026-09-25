'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { inr, Notice, Sheet, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type Opt = { id: string; kind: 'variant' | 'addon'; groupName: string; name: string; priceDelta: number; isDefault: boolean; available: boolean; maxSelect: number | null };
type Item = { id: string; name: string; description: string | null; price: number; dietary: string[]; allergens: string[]; spiceLevel: number | null; available: boolean; image: { url: string; alt: string } | null; options: Opt[] };
type Menu = { id: string; name: string; categories: { id: string; name: string; items: Item[] }[] }[];
type OType = { id: string; name: string; locationMode: string; areas: string[]; allowScheduling: boolean; paymentModes: string[] };
type Line = { key: string; menuItemId: string; name: string; optionIds: string[]; optionNames: string[]; unit: number; quantity: number; notes: string };
const PAYLABEL: Record<string, string> = { room_charge: 'Charge to my room', upi_manual: 'Pay now by UPI', upi_gateway: 'Pay now — UPI checkout', pay_at_property: 'Pay on delivery' };

function OrderPage() {
  const { rid } = useParams<{ rid: string }>();
  const typeId = useSearchParams().get('type') ?? '';
  const router = useRouter();
  const { data: menu } = useGuest<{ data: Menu }>(`/public/restaurants/${rid}/menu`);
  const { data: dining } = useGuest<{ data: { id: string; name: string; orderTypes: OType[] }[] }>('/portal/dining');
  const outlet = dining?.data.find((o) => o.id === rid);
  const type = outlet?.orderTypes.find((t) => t.id === typeId);
  const storeKey = `cart:${rid}:${typeId}`;
  const [cart, setCart] = useState<Line[]>([]);
  useEffect(() => { try { setCart(JSON.parse(sessionStorage.getItem(storeKey) ?? '[]')); } catch { /* ignore */ } }, [storeKey]);
  useEffect(() => { try { sessionStorage.setItem(storeKey, JSON.stringify(cart)); } catch { /* ignore */ } }, [cart, storeKey]);
  const [item, setItem] = useState<Item | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [f, setF] = useState({ area: '', when: '', instructions: '', pay: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [q, setQ] = useState('');
  const total = cart.reduce((s, l) => s + l.unit * l.quantity, 0);
  const count = cart.reduce((s, l) => s + l.quantity, 0);

  function open(i: Item) {
    setItem(i); setQty(1); setNote('');
    setSel(i.options.filter((o) => o.kind === 'variant' && o.isDefault && o.available).map((o) => o.id));
  }
  const groups = useMemo(() => {
    if (!item) return [];
    const g = new Map<string, Opt[]>();
    for (const o of item.options) g.set(`${o.kind}:${o.groupName}`, [...(g.get(`${o.kind}:${o.groupName}`) ?? []), o]);
    return [...g.entries()];
  }, [item]);
  const unit = item ? item.price + item.options.filter((o) => sel.includes(o.id)).reduce((s, o) => s + o.priceDelta, 0) : 0;
  function add() {
    if (!item) return;
    const opts = item.options.filter((o) => sel.includes(o.id));
    const k = `${item.id}|${[...sel].sort().join(',')}|${note}`;
    setCart((c) => c.some((l) => l.key === k) ? c.map((l) => (l.key === k ? { ...l, quantity: l.quantity + qty } : l)) : [...c, { key: k, menuItemId: item.id, name: item.name, optionIds: sel, optionNames: opts.map((o) => o.name), unit, quantity: qty, notes: note }]);
    setItem(null);
  }
  async function place() {
    setBusy(true); setErr(null);
    try {
      const r = await guestApi<{ data: { order: { id: string } } }>('/portal/orders', {
        idempotencyKey: key,
        body: {
          restaurantId: rid, orderTypeId: typeId, paymentMode: f.pay || type!.paymentModes[0],
          lines: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes || undefined })),
          area: type!.locationMode === 'area' ? f.area : undefined, customLocation: type!.locationMode === 'custom' ? f.area : undefined,
          scheduledFor: f.when ? new Date(f.when).toISOString() : undefined, specialInstructions: f.instructions || undefined,
        },
      });
      setCart([]); sessionStorage.removeItem(storeKey);
      router.push(`/stay/orders/${r.data.order.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setKey(crypto.randomUUID()); // a changed cart is a new request
    } finally { setBusy(false); }
  }

  if (!menu || !dining) return <p className="t-muted">Loading the menu…</p>;
  if (!type) return <Notice tone="error">This way of ordering isn’t available right now.</Notice>;
  const cats = menu.data[0]?.categories ?? [];
  const match = (i: Item) => !q || `${i.name} ${i.description ?? ''}`.toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <Title back="/stay/dining" sub={`${outlet!.name} · ${type.name}`}>Menu</Title>
      <input className="t-input mb-4" type="search" placeholder="Search the menu" value={q} onChange={(e) => setQ(e.target.value)} />
      <nav className="sticky top-0 z-10 -mx-5 mb-2 flex gap-5 overflow-x-auto border-b t-line px-5 py-3 text-sm" style={{ background: 'var(--t-bg)' }}>
        {cats.map((c) => <a key={c.id} href={`#c-${c.id}`} className="whitespace-nowrap t-muted">{c.name}</a>)}
      </nav>
      {cats.map((c) => {
        const items = c.items.filter(match);
        if (!items.length) return null;
        return (
          <section key={c.id} id={`c-${c.id}`} className="scroll-mt-14 pt-6">
            <h2 className="display mb-2 text-xl">{c.name}</h2>
            {items.map((i) => (
              <button key={i.id} disabled={!i.available} onClick={() => open(i)} className="flex w-full items-start justify-between gap-4 border-b t-line py-4 text-left disabled:opacity-45" data-testid="menu-item">
                <span className="min-w-0">
                  <span className="block">{i.name}{i.dietary.includes('veg') || i.dietary.includes('vegan') ? <span className="ml-2 text-[10px] text-green-800">VEG</span> : null}</span>
                  {i.description && <span className="mt-0.5 block text-sm t-muted">{i.description}</span>}
                  {!i.available && <span className="mt-1 block text-xs">Sold out</span>}
                </span>
                <span className="shrink-0 tabular-nums">{inr(i.price)}</span>
              </button>
            ))}
          </section>
        );
      })}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-5 pb-[env(safe-area-inset-bottom)]">
          <button className="t-btn t-btn-accent mx-auto flex w-full max-w-xl justify-between" onClick={() => setCheckout(true)} data-testid="view-cart"><span>{count} item{count > 1 ? 's' : ''}</span><span>View order · {inr(total)}</span></button>
        </div>
      )}
      <Sheet open={!!item} onClose={() => setItem(null)} title={item?.name ?? ''}>
        {item && (
          <div className="space-y-5">
            {item.description && <p className="t-muted">{item.description}</p>}
            {item.allergens.length > 0 && <p className="text-xs t-muted">Contains {item.allergens.join(', ').replace(/_/g, ' ')}</p>}
            {groups.map(([k, opts]) => {
              const variant = k.startsWith('variant');
              return (
                <fieldset key={k}>
                  <legend className="mb-2 text-sm font-medium">{opts[0]!.groupName} <span className="t-muted font-normal">{variant ? '· choose one' : '· optional'}</span></legend>
                  {opts.map((o) => (
                    <label key={o.id} className={`flex items-center justify-between border-b t-line py-3 ${o.available ? '' : 'opacity-40'}`}>
                      <span className="flex items-center gap-3">
                        <input type={variant ? 'radio' : 'checkbox'} name={k} disabled={!o.available} checked={sel.includes(o.id)} onChange={(e) => setSel(variant ? [...sel.filter((x) => !opts.some((y) => y.id === x)), o.id] : e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id))} />
                        {o.name}
                      </span>
                      <span className="text-sm tabular-nums t-muted">{o.priceDelta ? `+${inr(o.priceDelta)}` : ''}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
            <label className="block"><span className="t-label">Notes for the kitchen</span><input className="t-input" placeholder="No onion, extra crispy…" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="flex items-center gap-3">
              <div className="flex items-center border t-line" style={{ borderRadius: 'var(--t-radius)' }}>
                <button className="h-12 w-12 text-xl" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
                <span className="w-8 text-center tabular-nums" data-testid="qty">{qty}</span>
                <button className="h-12 w-12 text-xl" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="More">+</button>
              </div>
              <button className="t-btn flex-1" onClick={add} data-testid="add-to-order">Add · {inr(unit * qty)}</button>
            </div>
          </div>
        )}
      </Sheet>
      <Sheet open={checkout} onClose={() => setCheckout(false)} title="Your order">
        <ul className="mb-5">
          {cart.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-3 border-b t-line py-3">
              <span><span className="tabular-nums">{l.quantity}×</span> {l.name}{l.optionNames.length > 0 && <span className="block text-sm t-muted">{l.optionNames.join(', ')}</span>}{l.notes && <span className="block text-sm t-muted">“{l.notes}”</span>}</span>
              <span className="flex shrink-0 items-center gap-3"><span className="tabular-nums">{inr(l.unit * l.quantity)}</span><button className="text-sm t-muted" onClick={() => setCart(cart.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name}`}>Remove</button></span>
            </li>
          ))}
        </ul>
        <div className="space-y-4">
          {type.locationMode === 'room' && <p className="text-sm">Delivered to your room.</p>}
          {type.locationMode === 'area' && <label className="block"><span className="t-label">Where are you?</span><select className="t-input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} required><option value="">Choose…</option>{type.areas.map((a) => <option key={a}>{a}</option>)}</select></label>}
          {type.locationMode === 'custom' && <label className="block"><span className="t-label">Where should we bring it?</span><input className="t-input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></label>}
          {type.allowScheduling && <label className="block"><span className="t-label">When</span><input className="t-input" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /><span className="mt-1 block text-xs t-muted">Leave empty for as soon as possible.</span></label>}
          <label className="block"><span className="t-label">Instructions</span><input className="t-input" placeholder="Please knock softly — baby sleeping" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
          <fieldset><legend className="t-label">Payment</legend>{type.paymentModes.map((m) => <label key={m} className="flex items-center gap-3 border-b t-line py-3"><input type="radio" name="pay" checked={(f.pay || type.paymentModes[0]) === m} onChange={() => setF({ ...f, pay: m })} />{PAYLABEL[m] ?? m}</label>)}</fieldset>
          {err && <Notice tone="error">{err}</Notice>}
          <p className="flex justify-between text-sm t-muted"><span>Taxes added at checkout</span><span className="tabular-nums">Subtotal {inr(total)}</span></p>
          <button className="t-btn t-btn-accent w-full" disabled={busy || !cart.length || (type.locationMode === 'area' && !f.area) || !type.paymentModes.length} onClick={place} data-testid="place-order">{busy ? 'Sending to the kitchen…' : 'Place order'}</button>
        </div>
      </Sheet>
    </>
  );
}
export default function Page() { return <Suspense><OrderPage /></Suspense>; }
