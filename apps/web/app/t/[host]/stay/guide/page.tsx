'use client';

import { useState } from 'react';
import { Title } from '@/components/stay/bits';
import { useGuest } from '@/lib/hooks';

type Block = { type: 'p' | 'h' | 'list' | 'kv' | 'callout'; text?: string; items?: string[]; rows?: { k: string; v: string }[]; tone?: string };
type G = { property: { name: string; phone: string | null; email: string | null } | null; pages: { id: string; slug: string; title: string; summary: string | null; category: string; body: Block[] }[]; announcements: { id: string; title: string; body: string }[] };

function Body({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => b.type === 'p' ? <p key={i} className="leading-relaxed">{b.text}</p>
        : b.type === 'h' ? <h3 key={i} className="pt-2 font-medium">{b.text}</h3>
        : b.type === 'list' ? <ul key={i} className="list-disc space-y-1 pl-5">{b.items?.map((x, j) => <li key={j}>{x}</li>)}</ul>
        : b.type === 'kv' ? <dl key={i} className="border-t t-line">{b.rows?.map((r, j) => <div key={j} className="flex justify-between gap-4 border-b t-line py-2.5"><dt className="t-muted">{r.k}</dt><dd className="text-right font-medium">{r.v}</dd></div>)}</dl>
        : <p key={i} className="border-l-2 py-1 pl-3" style={{ borderColor: b.tone === 'emergency' ? '#9b2c1f' : 'var(--t-accent)' }}>{b.text}</p>)}
    </div>
  );
}

export default function Guide() {
  const { data } = useGuest<{ data: G }>('/public/guide');
  const [open, setOpen] = useState<string | null>(null);
  const g = data?.data;
  if (!g) return <p className="t-muted">Loading the guide…</p>;
  return (
    <>
      <Title back="/stay" sub="Saved on this device — works even when the Wi-Fi doesn’t.">Property guide</Title>
      {g.announcements.map((a) => <div key={a.id} className="t-surface mb-3 p-4"><p className="font-medium">{a.title}</p><p className="mt-1 text-sm t-muted">{a.body}</p></div>)}
      <div className="mt-4 border-t t-line">
        {g.pages.map((p) => (
          <section key={p.id} className="border-b t-line">
            <button className="flex w-full items-center justify-between py-4 text-left" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
              <span><span className="block">{p.title}</span>{p.summary && <span className="block text-sm t-muted">{p.summary}</span>}</span><span className="t-muted">{open === p.id ? '−' : '+'}</span>
            </button>
            {open === p.id && <div className="pb-6"><Body blocks={p.body} /></div>}
          </section>
        ))}
      </div>
      {g.property?.phone && <a href={`tel:${g.property.phone}`} className="t-btn t-btn-outline mt-8 w-full">Call reception</a>}
    </>
  );
}
