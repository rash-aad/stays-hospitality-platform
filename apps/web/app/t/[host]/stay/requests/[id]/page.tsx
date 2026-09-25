'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { dayTime, hm, Notice, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

type D = { id: string; reference: string; title: string; description: string | null; statusLabel: string; status: string; canCancel: boolean; createdAt: string; timeline: { kind: string; label: string | null; body: string | null; fromGuest: boolean; createdAt: string }[] };

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, mutate, error } = useGuest<{ data: D }>(`/portal/requests/${id}`, { refreshInterval: 15_000 });
  const [note, setNote] = useState('');
  if (error) return <Notice tone="error">{error.message}</Notice>;
  const r = data?.data;
  if (!r) return <p className="t-muted">Loading…</p>;
  return (
    <div data-testid="request-detail">
      <Title back="/stay/requests" sub={`${r.reference} · sent ${dayTime(r.createdAt)}`}>{r.title}</Title>
      <p className="display text-2xl" data-testid="request-status">{r.statusLabel}</p>
      {r.description && <p className="mt-3 t-muted">{r.description}</p>}
      <ol className="mt-8 border-l t-line pl-5">
        {r.timeline.map((e, i) => (
          <li key={i} className="relative pb-5">
            <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--t-ink)' }} />
            <p className="text-xs t-muted">{hm(e.createdAt)}</p>
            <p>{e.kind === 'note' ? (e.fromGuest ? `You: ${e.body}` : e.body) : e.kind === 'attachment' ? 'Photo attached' : e.label}</p>
          </li>
        ))}
      </ol>
      <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await guestApi(`/portal/requests/${id}/notes`, { body: { body: note } }); setNote(''); mutate(); }}>
        <input className="t-input" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} /><button className="t-btn">Send</button>
      </form>
      {r.canCancel && <button className="t-btn t-btn-outline mt-6 w-full" onClick={async () => { await guestApi(`/portal/requests/${id}/cancel`, { method: 'POST' }); mutate(); }}>Cancel request</button>}
    </div>
  );
}
