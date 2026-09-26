'use client';

import { useEffect, useRef, useState } from 'react';
import { hm, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

export default function Messages() {
  const { data, mutate } = useGuest<{ data: { id: string; body: string; senderType: 'guest' | 'staff'; createdAt: string }[] }>('/portal/messages', { refreshInterval: 10_000 });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data]);
  return (
    <>
      <Title back="/stay" sub="The front desk replies here, usually within minutes.">Messages</Title>
      <div className="space-y-3 pb-24">
        {data?.data.map((m) => (
          <div key={m.id} className={m.senderType === 'guest' ? 'text-right' : ''}>
            <p className="inline-block max-w-[85%] px-4 py-2.5 text-left whitespace-pre-wrap" style={{ background: m.senderType === 'guest' ? 'var(--t-ink)' : 'var(--t-surface)', color: m.senderType === 'guest' ? 'var(--t-bg)' : undefined, borderRadius: 'calc(var(--t-radius) + 10px)' }}>{m.body}</p>
            <p className="mt-0.5 text-xs t-muted">{hm(m.createdAt)}</p>
          </div>
        ))}
        {data?.data.length === 0 && <p className="t-muted">Ask us anything — we’re here around the clock.</p>}
        <div ref={end} />
      </div>
      <form className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-xl gap-2 px-5 py-2" style={{ background: 'var(--t-bg)' }} onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await guestApi('/portal/messages', { body: { body: text } }); setText(''); mutate(); }}>
        <input className="t-input" placeholder="Write a message" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="t-btn">Send</button>
      </form>
    </>
  );
}
