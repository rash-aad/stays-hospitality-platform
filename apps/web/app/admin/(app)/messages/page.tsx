'use client';

import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorNote, Loading, PageHeader, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Thread = { guestId: string; guestName: string; body: string; senderType: string; createdAt: string; unread: number; roomNumber: string | null };
type Msg = { id: string; body: string; senderType: 'guest' | 'staff'; staffName: string | null; createdAt: string };

export default function Messages() {
  const { data, error, mutate } = useStaff<{ data: Thread[] }>('/admin/messages', { refreshInterval: 15_000 });
  const [sel, setSel] = useState<string | null>(null);
  const { data: thread, mutate: reload } = useStaff<{ data: Msg[] }>(sel ? `/admin/messages/${sel}` : null, { refreshInterval: 10_000 });
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [thread]);
  const current = data?.data.find((t) => t.guestId === sel);
  return (
    <>
      <PageHeader title="Messages" sub="Conversations with guests from the portal and your website contact form." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No conversations yet" /> : (
        <div className="grid h-[calc(100dvh-86px)] grid-cols-1 bg-panel md:grid-cols-[300px_1fr]">
          <ul className={cx('overflow-y-auto border-r border-line', sel && 'hidden md:block')}>
            {data.data.map((t) => (
              <li key={t.guestId}>
                <button onClick={() => { setSel(t.guestId); setTimeout(() => mutate(), 500); }} className={cx('block w-full border-b border-line px-4 py-3 text-left', sel === t.guestId ? 'bg-sunk' : 'hover:bg-[#faf9f7]')}>
                  <p className="flex justify-between text-[13px]"><span className={cx(t.unread ? 'font-semibold' : 'font-medium')}>{t.guestName}{t.roomNumber && <span className="font-normal text-muted"> · {t.roomNumber}</span>}</span><span className="text-xs text-muted">{ago(t.createdAt)}</span></p>
                  <p className="mt-0.5 truncate text-xs text-muted">{t.senderType === 'staff' ? 'You: ' : ''}{t.body}</p>
                </button>
              </li>
            ))}
          </ul>
          {sel ? (
            <section className="flex min-h-0 flex-col">
              <header className="flex items-center gap-3 border-b border-line px-5 py-3"><button className="btn btn-sm md:hidden" onClick={() => setSel(null)}>Back</button><p className="text-[14px] font-medium">{current?.guestName}</p>{current?.roomNumber && <span className="text-[13px] text-muted">Room {current.roomNumber}</span>}</header>
              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {thread?.data.map((m) => (
                  <div key={m.id} className={cx('max-w-[75%]', m.senderType === 'staff' && 'ml-auto text-right')}>
                    <p className={cx('inline-block rounded-sm px-3 py-2 text-left text-[13px] leading-relaxed whitespace-pre-wrap', m.senderType === 'staff' ? 'bg-ink text-white' : 'border border-line bg-canvas')}>{m.body}</p>
                    <p className="mt-0.5 text-2xs text-muted">{m.senderType === 'staff' ? m.staffName : ''} {dateTime(m.createdAt)}</p>
                  </div>
                ))}
                <div ref={end} />
              </div>
              <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; run(() => staffApi(`/admin/messages/${sel}`, { body: { body: text } })).then((r) => { if (r) { setText(''); reload(); mutate(); } }); }}>
                <textarea className="input h-10 min-h-10 flex-1 resize-none" rows={1} placeholder="Reply…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
                <button className="btn btn-primary h-10" disabled={busy || !text.trim()}>Send</button>
              </form>
            </section>
          ) : <div className="hidden place-items-center text-[13px] text-muted md:grid">Choose a conversation</div>}
        </div>
      )}
    </>
  );
}
