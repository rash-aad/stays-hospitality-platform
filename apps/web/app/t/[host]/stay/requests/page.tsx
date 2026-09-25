'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { day, Notice, Row, Sheet, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type Field = { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'datetime' | 'time' | 'select'; required?: boolean; options?: string[] };
type RType = { id: string; key: string; name: string; description: string | null; category: string; formSchema: Field[]; slaMinutes: number; available: boolean; unavailableReason: string | null };
type Req = { id: string; reference: string; title: string; statusLabel: string; status: string; createdAt: string };
const CAT_LABEL: Record<string, string> = { housekeeping: 'Housekeeping', maintenance: 'Repairs', front_desk: 'Front desk', concierge: 'Concierge', transport: 'Transport', room_service: 'Room service', spa: 'Spa', activities: 'Activities', dining: 'Dining' };
const OPT: Record<string, string> = { hvac: 'Air-conditioning', electrical: 'Lights or power', plumbing: 'Water, tap or toilet', appliance: 'TV, fridge or kettle', furniture: 'Furniture', it: 'Wi-Fi', other: 'Something else' };

function Requests() {
  const cat = useSearchParams().get('cat')?.split(',');
  const router = useRouter();
  const { data: types } = useGuest<{ data: RType[] }>('/portal/request-types');
  const { data: mine } = useGuest<{ data: Req[] }>('/portal/requests', { refreshInterval: 20_000 });
  const [t, setT] = useState<RType | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [desc, setDesc] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = (types?.data ?? []).filter((x) => !cat || cat.includes(x.category));
  const grouped = [...new Set(shown.map((x) => x.category))];
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      let attachmentIds: string[] | undefined;
      if (photo) {
        const fd = new FormData(); fd.append('file', photo);
        attachmentIds = [(await guestApi<{ data: { id: string } }>('/files?purpose=maintenance', { form: fd })).data.id];
      }
      const r = await guestApi<{ data: { id: string } }>('/portal/requests', { body: { typeId: t!.id, description: desc || undefined, details: vals, attachmentIds } });
      router.push(`/stay/requests/${r.data.id}`);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <Title sub="Ask for anything — the right team gets it straight away.">Requests</Title>
      {grouped.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">{CAT_LABEL[g] ?? g}</h2>
          {shown.filter((x) => x.category === g).map((x) => x.available
            ? <Row key={x.id} onClick={() => { setT(x); setVals({}); setDesc(''); setPhoto(null); setErr(null); }} title={x.name} sub={x.description} />
            : <Row key={x.id} title={<span className="t-muted">{x.name}</span>} sub={x.unavailableReason} right=" " />)}
        </section>
      ))}
      {mine && mine.data.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">Your requests</h2>
          {mine.data.map((r) => <Row key={r.id} href={`/stay/requests/${r.id}`} title={r.title} sub={`${r.statusLabel} · ${day(r.createdAt)}`} />)}
        </section>
      )}
      <Sheet open={!!t} onClose={() => setT(null)} title={t?.name ?? ''}>
        {t && (
          <form onSubmit={send} className="space-y-4" data-testid="request-form">
            {t.formSchema.map((f) => (
              <label key={f.key} className="block">
                <span className="t-label">{f.label}{f.required ? '' : ' (optional)'}</span>
                {f.type === 'select' ? (
                  <select className="t-input" name={f.key} required={f.required} value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options?.map((o) => <option key={o} value={o}>{OPT[o] ?? o}</option>)}</select>
                ) : f.type === 'textarea' ? (
                  <textarea className="t-input" name={f.key} rows={3} required={f.required} value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                ) : (
                  <input className="t-input" name={f.key} required={f.required} type={f.type === 'datetime' ? 'datetime-local' : f.type} value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                )}
              </label>
            ))}
            <label className="block"><span className="t-label">Anything else?</span><textarea className="t-input" name="description" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
            {t.category === 'maintenance' && <label className="block"><span className="t-label">Add a photo (optional)</span><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} data-testid="photo" /></label>}
            <p className="text-sm t-muted">We aim to respond within {t.slaMinutes < 60 ? `${t.slaMinutes} minutes` : `${Math.round(t.slaMinutes / 60)} hours`}.</p>
            {err && <Notice tone="error">{err}</Notice>}
            <button className="t-btn w-full" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </form>
        )}
      </Sheet>
    </>
  );
}
export default function Page() { return <Suspense><Requests /></Suspense>; }
