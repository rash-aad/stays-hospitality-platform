'use client';

import { use, useEffect, useState } from 'react';
import { day, Notice, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type F = { overall: number; recommend: number | null; aspects: Record<string, number>; comment: string | null; publicConsent: boolean; staffReply: string | null };
type R = { booking: { id: string; reference: string; checkIn: string; checkOut: string; status: string }; feedback: F | null };
const ASPECTS = [['room', 'Room'], ['cleanliness', 'Cleanliness'], ['service', 'Service'], ['food', 'Food'], ['value', 'Value'], ['location', 'Location']] as const;

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${n} of 5`} onClick={() => onChange(n)} className="text-2xl leading-none" style={{ color: n <= value ? 'var(--t-accent)' : 'var(--t-line)' }}>★</button>)}
    </span>
  );
}

export default function Feedback({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useGuest<{ data: R }>(`/portal/bookings/${id}/feedback`);
  const [f, setF] = useState<F | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) setF(data.data.feedback ?? { overall: 0, recommend: null, aspects: {}, comment: '', publicConsent: false, staffReply: null }); }, [data, f]);
  if (error) return <Notice tone="error">{(error as Error).message}</Notice>;
  if (!data || !f) return <p className="t-muted">Loading…</p>;
  const b = data.data.booking;
  if (!['checked_in', 'checked_out'].includes(b.status)) return <><Title back="/stay/more">Your feedback</Title><p className="t-muted">You can share feedback once your stay has begun.</p></>;
  return (
    <>
      <Title back="/stay/more" sub={`${day(b.checkIn)} – ${day(b.checkOut)}`}>How was your stay?</Title>
      {data.data.feedback?.staffReply && <div className="mb-6 border-l-2 pl-3 text-sm" style={{ borderColor: 'var(--t-accent)' }}><p className="t-muted text-xs">Reply from the team</p><p data-testid="staff-reply">{data.data.feedback.staffReply}</p></div>}
      <form className="space-y-6" data-testid="feedback-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!f.overall) return setMsg('Please choose an overall rating.');
        setBusy(true);
        try {
          await guestApi(`/portal/bookings/${id}/feedback`, { body: { overall: f.overall, recommend: f.recommend, aspects: f.aspects, comment: f.comment || null, publicConsent: f.publicConsent } });
          setMsg('Thank you — the team reads every one.'); mutate();
        } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
      }}>
        <div><p className="t-label">Overall</p><Stars label="Overall" value={f.overall} onChange={(n) => setF({ ...f, overall: n })} /></div>
        <div className="space-y-2">{ASPECTS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between border-b t-line pb-2"><span className="text-sm">{label}</span><Stars label={label} value={f.aspects[k] ?? 0} onChange={(n) => setF({ ...f, aspects: { ...f.aspects, [k]: n } })} /></div>
        ))}</div>
        <div>
          <p className="t-label">How likely are you to recommend us to a friend?</p>
          <div className="mt-1 grid grid-cols-11 gap-1">{Array.from({ length: 11 }, (_, n) => (
            <button type="button" key={n} aria-pressed={f.recommend === n} onClick={() => setF({ ...f, recommend: n })} className="h-9 rounded-sm border t-line text-sm tabular-nums" style={f.recommend === n ? { background: 'var(--t-ink)', color: 'var(--t-bg)' } : undefined}>{n}</button>
          ))}</div>
        </div>
        <label className="block"><span className="t-label">Anything to tell us?</span><textarea className="t-input" rows={4} value={f.comment ?? ''} onChange={(e) => setF({ ...f, comment: e.target.value })} /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.publicConsent} onChange={(e) => setF({ ...f, publicConsent: e.target.checked })} /> You may quote my comment (first name only) on your website.</label>
        <button className="t-btn w-full" disabled={busy}>{data.data.feedback ? 'Update feedback' : 'Send feedback'}</button>
      </form>
      {msg && <Notice>{msg}</Notice>}
    </>
  );
}
