'use client';

import { useState } from 'react';
import { day, inr, Notice, Row, Title } from '@/components/stay/bits';
import { SignOutButton, useStay } from '@/components/stay/shell';
import { enablePush } from '@/components/pwa';
import { guestApi, signOut } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

export default function More() {
  const { home, reload } = useStay();
  const { data: bookings, mutate } = useGuest<{ data: { id: string; reference: string; checkIn: string; checkOut: string; status: string; total: number; room: string }[] }>('/portal/bookings');
  const [f, setF] = useState({ firstName: home.guest.firstName, lastName: home.guest.lastName, phone: home.guest.phone ?? '' });
  const [prefs, setPrefs] = useState({ email: home.guest.notificationPrefs.email !== false, sms: home.guest.notificationPrefs.sms !== false, whatsapp: home.guest.notificationPrefs.whatsapp !== false });
  const [msg, setMsg] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const { data: pts, mutate: reloadPts } = useGuest<{ data: { enabled: boolean; balance: number; pointValue: number; minRedeem: number; earnPerHundred: number; tier: { current: { name: string }; next: { name: string } | null; nightsToNext: number } } }>('/portal/loyalty');
  const [marketing, setMarketing] = useState<boolean>(home.guest.marketingOptIn);
  const [redeem, setRedeem] = useState<{ bookingId: string; points: string } | null>(null);
  const [eraseText, setEraseText] = useState('');
  return (
    <>
      <Title>More</Title>
      <Row href="/stay/guide" title="Property guide" />
      <Row href="/stay/messages" title="Messages" />
      <Row href="/stay/notifications" title="Updates" />
      {home.modules.some((m) => ['experiences', 'spa', 'transport'].includes(m)) && <Row href="/stay/experiences" title="Experiences & spa" />}
      {home.modules.includes('restaurant.reservations') && <Row href="/stay/reserve" title="Book a table" />}

      {pts?.data.enabled && (
        <section className="mt-8 border t-line p-4" data-testid="points">
          <p className="text-[12px] tracking-[0.16em] uppercase t-muted">Your points</p>
          <p className="mt-1 display text-3xl">{pts.data.balance.toLocaleString('en-IN')}</p>
          <p className="text-sm t-muted">Worth {inr(pts.data.balance * pts.data.pointValue)} · {pts.data.tier.current.name}{pts.data.tier.next ? ` · ${pts.data.tier.nightsToNext} nights to ${pts.data.tier.next.name}` : ''}</p>
          <p className="mt-1 text-xs t-muted">You earn {pts.data.earnPerHundred} points per ₹100 on your room. Use {pts.data.minRedeem}+ points on an upcoming stay below.</p>
        </section>
      )}
      <h2 className="mt-10 mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">Your bookings</h2>
      {bookings?.data.map((b) => (
        <Row key={b.id} title={`${day(b.checkIn)} – ${day(b.checkOut)}`} sub={`${b.room?.split(' — ')[0]} · ${b.reference} · ${b.status.replace('_', ' ')}`}
          right={<span className="flex flex-col items-end gap-1">{pts?.data.enabled && ['confirmed', 'checked_in'].includes(b.status) && pts.data.balance >= pts.data.minRedeem && <button className="t-link" onClick={() => setRedeem({ bookingId: b.id, points: String(pts.data.balance) })}>Use points</button>}{b.status === 'confirmed' && <><a className="t-link" href={`/stay/checkin/${b.id}`}>Check in online</a><a className="t-link" href={`/stay/change/${b.id}`}>Change dates</a></>}{['checked_in', 'checked_out'].includes(b.status) && <a className="t-link" href={`/stay/feedback/${b.id}`}>Share feedback</a>}{b.status === 'confirmed' ? <button className="t-link" onClick={async () => { try { const r = await guestApi<{ data: { fee: number } }>(`/portal/bookings/${b.id}/cancel`, { body: {} }); setMsg(r.data.fee ? `Cancelled. A fee of ${inr(r.data.fee)} applies under the rate’s policy.` : 'Cancelled — no fee.'); mutate(); reload(); } catch (e) { setMsg((e as Error).message); } }}>Cancel</button> : null}</span>} />
      ))}
      {redeem && pts?.data.enabled && (
        <form className="mt-3 flex items-end gap-2 border t-line p-3" data-testid="redeem-form" onSubmit={async (e) => { e.preventDefault(); try { const r = await guestApi<{ data: { value: number } }>(`/portal/bookings/${redeem.bookingId}/redeem-points`, { body: { points: Number(redeem.points) } }); setMsg(`${inr(r.data.value)} paid with points.`); setRedeem(null); reloadPts(); mutate(); } catch (err) { setMsg((err as Error).message); } }}>
          <label className="flex-1"><span className="t-label">Points to use (each {inr(pts.data.pointValue)})</span><input className="t-input" inputMode="numeric" value={redeem.points} onChange={(e) => setRedeem({ ...redeem, points: e.target.value.replace(/\D/g, '') })} /></label>
          <button className="t-btn">Use</button><button type="button" className="t-link text-sm" onClick={() => setRedeem(null)}>Cancel</button>
        </form>
      )}
      {msg && <Notice>{msg}</Notice>}

      <h2 className="mt-10 mb-3 text-[12px] tracking-[0.16em] uppercase t-muted">Profile</h2>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guestApi('/portal/profile', { method: 'PATCH', body: { ...f, phone: f.phone || null, notificationPrefs: prefs, marketingOptIn: marketing } }); setMsg('Saved.'); reload(); }}>
        <div className="grid grid-cols-2 gap-3"><label><span className="t-label">First name</span><input className="t-input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></label><label><span className="t-label">Last name</span><input className="t-input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label></div>
        <label className="block"><span className="t-label">Mobile</span><input className="t-input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <fieldset className="pt-2"><legend className="t-label">Send me updates by</legend>{(['email', 'sms', 'whatsapp'] as const).map((k) => <label key={k} className="mr-5 inline-flex items-center gap-2"><input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} />{k === 'sms' ? 'SMS' : k === 'whatsapp' ? 'WhatsApp' : 'Email'}</label>)}</fieldset>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Send me offers and news by email</label>
        <button className="t-btn t-btn-outline w-full">Save</button>
      </form>
      <button className="t-btn t-btn-outline mt-3 w-full" onClick={async () => { const r = await enablePush('guest'); setMsg(r === 'enabled' ? 'Notifications on for this device.' : r === 'denied' ? 'Notifications are blocked in your browser settings.' : 'This browser doesn’t support notifications.'); }}>Turn on notifications</button>
      <div className="mt-8"><SignOutButton /></div>

      <h2 className="mt-12 mb-2 text-[12px] tracking-[0.16em] uppercase t-muted">Your data</h2>
      <p className="text-sm t-muted">Download everything we hold about you, or ask us to erase it. Invoices are kept in anonymised form as tax law requires.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button className="t-btn t-btn-outline" onClick={async () => { try { const data = await guestApi('/portal/privacy/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'my-data.json'; a.click(); URL.revokeObjectURL(url); } catch (e) { setMsg((e as Error).message); } }}>Download my data</button>
        <button className="t-btn t-btn-outline" onClick={() => setErasing(true)}>Delete my data</button>
      </div>
      {erasing && (
        <form className="mt-4 space-y-3 border t-line p-4" onSubmit={async (e) => { e.preventDefault(); try { await guestApi('/portal/privacy/erase', { body: { confirm: eraseText } }); await signOut('guest'); location.href = '/'; } catch (err) { setMsg((err as Error).message); } }}>
          <p className="text-sm">This permanently removes your name, contact details, messages and preferences, and signs you out. Type <b>ERASE</b> to confirm.</p>
          <input className="t-input font-mono" value={eraseText} onChange={(e) => setEraseText(e.target.value)} aria-label="Type ERASE to confirm" />
          <button className="t-btn w-full" disabled={eraseText !== 'ERASE'}>Erase my data</button>
        </form>
      )}
    </>
  );
}
