'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { Drawer, Empty, ErrorNote, Field, Loading, PageHeader, Pager, Segmented, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Fb = { id: string; guestName: string; reference: string; checkOut: string; overall: number; recommend: number | null; aspects: Record<string, number>; comment: string | null; publicConsent: boolean; staffReply: string | null; repliedAt: string | null; createdAt: string };
type Resp = { data: Fb[]; meta: { page: number; pages: number; total: number }; summary: { average: number | null; responses: number; nps: number | null } };
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export default function FeedbackPage() {
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState<'all' | '1' | '2' | '3' | '4' | '5'>('all');
  const { data, error, mutate } = useStaff<Resp>(`/admin/feedback?page=${page}${rating === 'all' ? '' : `&rating=${rating}`}`);
  const [open, setOpen] = useState<Fb | null>(null);
  const [reply, setReply] = useState('');
  const { busy, run } = useAction();
  const can = useCan();
  const s = data?.summary;
  return (
    <>
      <PageHeader title="Guest feedback" sub="Ratings guests leave after their stay. Reply to thank them or put things right — they get your reply by email.">
        {s && (
          <dl className="mt-3 flex gap-8 text-[13px]">
            <div><dt className="text-muted">Average</dt><dd className="num text-xl" data-testid="fb-average">{s.average ?? '—'}</dd></div>
            <div><dt className="text-muted">Net promoter score</dt><dd className="num text-xl">{s.nps ?? '—'}</dd></div>
            <div><dt className="text-muted">Responses</dt><dd className="num text-xl">{s.responses}</dd></div>
          </dl>
        )}
      </PageHeader>
      <div className="px-6 py-3"><Segmented value={rating} onChange={(v) => { setRating(v); setPage(1); }} items={[{ value: 'all', label: 'All' }, ...(['5', '4', '3', '2', '1'] as const).map((v) => ({ value: v, label: `${v}★` }))]} /></div>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No feedback yet">Guests are asked for feedback the day after they check out.</Empty> : (
        <div className="overflow-x-auto bg-panel"><table className="tbl">
          <thead><tr><th>Guest</th><th>Stay</th><th>Rating</th><th>Would recommend</th><th>Comment</th><th>Reply</th></tr></thead>
          <tbody>
            {data.data.map((f) => (
              <tr key={f.id} className="is-link" onClick={() => { setOpen(f); setReply(f.staffReply ?? ''); }}>
                <td className="font-medium">{f.guestName}</td>
                <td className="text-muted"><span className="font-mono text-xs">{f.reference}</span> · {date(f.checkOut)}</td>
                <td className={f.overall <= 2 ? 'text-bad' : ''}>{stars(f.overall)}</td>
                <td className="num">{f.recommend ?? '—'}</td>
                <td className="max-w-sm truncate">{f.comment ?? <span className="text-muted">—</span>}</td>
                <td className="text-muted">{f.staffReply ? 'Replied' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.guestName ?? ''} sub={open && `${stars(open.overall)} · ${date(open.createdAt)}`}
        footer={open && can.perm('guests.write') && <button className="btn btn-primary" disabled={busy || reply.trim().length < 2} onClick={() => run(() => staffApi(`/admin/feedback/${open.id}/reply`, { body: { body: reply } }), 'Reply sent').then((r) => { if (r) { setOpen(null); mutate(); } })}>{open.staffReply ? 'Send updated reply' : 'Send reply'}</button>}>
        {open && (
          <div className="space-y-4 p-5 text-[13px]">
            {open.comment && <blockquote className="border-l-2 border-line pl-3 text-[14px]">{open.comment}</blockquote>}
            {Object.keys(open.aspects).length > 0 && <ul className="grid grid-cols-2 gap-1">{Object.entries(open.aspects).map(([k, v]) => <li key={k} className="flex justify-between"><span className="capitalize text-muted">{k}</span><span>{stars(v)}</span></li>)}</ul>}
            <p className="text-muted">{open.publicConsent ? 'Happy to be quoted on the website.' : 'Not for publication.'}</p>
            <Field label="Your reply"><textarea className="input" rows={5} value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
          </div>
        )}
      </Drawer>
    </>
  );
}
