'use client';

import { use, useEffect, useState } from 'react';
import { day, Notice, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type P = { arrivalTime: string | null; travellingBy: string | null; nationality: string | null; idType: string | null; idNumberLast4: string | null; idFileId: string | null; address: string | null; purposeOfVisit: string | null; guestNames: string[]; specialRequests: string | null };
type R = { booking: { id: string; reference: string; checkIn: string; checkOut: string; adults: number; children: number; status: string; room?: string }; precheckin: P | null; completedAt: string | null };
const EMPTY: P = { arrivalTime: '', travellingBy: '', nationality: 'Indian', idType: '', idNumberLast4: '', idFileId: null, address: '', purposeOfVisit: 'leisure', guestNames: [], specialRequests: '' };

export default function PreCheckin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useGuest<{ data: R }>(`/portal/bookings/${id}/precheckin`);
  const [f, setF] = useState<P | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) setF({ ...EMPTY, ...(data.data.precheckin ?? {}) }); }, [data, f]);
  if (error) return <Notice tone="error">{(error as Error).message}</Notice>;
  if (!data || !f) return <p className="t-muted">Loading…</p>;
  const b = data.data.booking;
  const extra = Math.max(0, b.adults + b.children - 1);
  const set = (k: keyof P) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (!['confirmed', 'pending_payment'].includes(b.status)) return <><Title back="/stay">Online check-in</Title><p className="t-muted">Online check-in is for upcoming stays.</p></>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      let idFileId = f!.idFileId;
      if (file) { const fd = new FormData(); fd.append('file', file); idFileId = (await guestApi<{ data: { id: string } }>('/files?purpose=other', { form: fd })).data.id; }
      const n = (v: string | null) => (v && v.trim()) || null;
      await guestApi(`/portal/bookings/${id}/precheckin`, { method: 'PUT', body: {
        arrivalTime: n(f!.arrivalTime), travellingBy: n(f!.travellingBy), nationality: n(f!.nationality), idType: n(f!.idType), idNumberLast4: n(f!.idNumberLast4), idFileId,
        address: n(f!.address), purposeOfVisit: n(f!.purposeOfVisit), guestNames: f!.guestNames.map((g) => g.trim()).filter(Boolean), specialRequests: n(f!.specialRequests), consent,
      } });
      setMsg('Done — you’re checked in online. Just collect your key at the desk.');
      setFile(null); mutate();
    } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <Title back="/stay" sub={`${day(b.checkIn)} – ${day(b.checkOut)} · ${b.reference}`}>Online check-in</Title>
      {data.data.completedAt && <Notice>You completed online check-in on {day(data.data.completedAt)}. You can update the details below.</Notice>}
      <form className="mt-4 space-y-4" onSubmit={submit} data-testid="precheckin-form">
        <div className="grid grid-cols-2 gap-3">
          <label><span className="t-label">Arriving around</span><input className="t-input" type="time" value={f.arrivalTime ?? ''} onChange={set('arrivalTime')} /></label>
          <label><span className="t-label">Travelling by</span><select className="t-input" value={f.travellingBy ?? ''} onChange={set('travellingBy')}><option value="">—</option><option value="car">Car</option><option value="flight">Flight</option><option value="train">Train</option><option value="bus">Bus</option><option value="other">Other</option></select></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="t-label">Nationality</span><input className="t-input" value={f.nationality ?? ''} onChange={set('nationality')} /></label>
          <label><span className="t-label">Purpose of visit</span><select className="t-input" value={f.purposeOfVisit ?? ''} onChange={set('purposeOfVisit')}><option value="leisure">Leisure</option><option value="business">Business</option><option value="event">Event / wedding</option><option value="other">Other</option></select></label>
        </div>
        <label className="block"><span className="t-label">Home address</span><input className="t-input" value={f.address ?? ''} onChange={set('address')} autoComplete="street-address" /></label>
        <fieldset className="space-y-3 border-t t-line pt-4">
          <legend className="t-label">Photo ID</legend>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="t-label">Type</span><select className="t-input" value={f.idType ?? ''} onChange={set('idType')}><option value="">—</option><option value="aadhaar">Aadhaar</option><option value="passport">Passport</option><option value="driving_licence">Driving licence</option><option value="voter_id">Voter ID</option><option value="other">Other</option></select></label>
            <label><span className="t-label">Last 4 characters</span><input className="t-input font-mono" maxLength={4} value={f.idNumberLast4 ?? ''} onChange={(e) => setF({ ...f, idNumberLast4: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} /></label>
          </div>
          <label className="block"><span className="t-label">Upload a copy (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <p className="text-xs t-muted">{f.idFileId && !file ? 'A copy is on file. ' : ''}We only keep the last four characters of the number. The desk will still see the original ID at arrival, as the law requires.</p>
        </fieldset>
        {extra > 0 && (
          <fieldset className="space-y-2 border-t t-line pt-4">
            <legend className="t-label">Who’s travelling with you</legend>
            {Array.from({ length: extra }, (_, i) => <input key={i} className="t-input" placeholder={`Guest ${i + 2} full name`} value={f.guestNames[i] ?? ''} onChange={(e) => { const g = [...f.guestNames]; g[i] = e.target.value; setF({ ...f, guestNames: g }); }} />)}
          </fieldset>
        )}
        <label className="block"><span className="t-label">Anything we should prepare?</span><textarea className="t-input" rows={3} value={f.specialRequests ?? ''} onChange={set('specialRequests')} placeholder="Extra pillows, baby cot, anniversary…" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I confirm these details are correct and may be shared with local authorities where the law requires.</label>
        <button className="t-btn w-full" disabled={busy || !consent}>{busy ? 'Saving…' : 'Complete online check-in'}</button>
      </form>
      {msg && <Notice>{msg}</Notice>}
    </>
  );
}
