'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState } from 'react';
import { ErrorNote, Loading, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

type Item = { path: string; label: string; text: string; translation: string; stale: boolean };
const NAMES: Record<string, string> = { hi: 'Hindi (हिन्दी)', ta: 'Tamil (தமிழ்)', ml: 'Malayalam (മലയാളം)' };

function Translate({ scope }: { scope: string }) {
  const lang = useSearchParams().get('lang') ?? 'hi';
  const { data, error, mutate } = useStaff<{ data: { title: string; items: Item[] } }>(`/admin/translations/${scope}?locale=${lang}`);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data && !draft) setDraft(Object.fromEntries(data.data.items.map((i) => [i.path, i.translation]))); }, [data, draft]);
  if (!data || !draft) return <div className="p-6"><ErrorNote error={error} /><Loading /></div>;
  const items = data.data.items;
  const done = items.filter((i) => draft[i.path]?.trim()).length;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-panel px-6 py-3">
        <div>
          <a className="text-xs text-muted hover:underline" href="/admin/site">← Website</a>
          <h1 className="text-[15px] font-semibold">{data.data.title} — {NAMES[lang] ?? lang}</h1>
          <p className="text-xs text-muted">{done} of {items.length} translated</p>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/translations/${scope}`, { method: 'PUT', body: { locale: lang, strings: draft } }), 'Translations saved — live on the site').then((r) => { if (r) { setDraft(null); mutate(); } })}>Save</button>
      </header>
      <table className="mx-auto w-full max-w-5xl text-[13px]" data-testid="translate-table">
        <tbody>{items.map((i) => (
          <tr key={i.path} className="border-b border-line align-top">
            <td className="w-1/2 px-6 py-3"><p className="text-2xs uppercase tracking-wide text-muted">{i.label}</p><p className="mt-1 whitespace-pre-wrap">{i.text}</p></td>
            <td className="w-1/2 py-3 pr-6">
              <textarea aria-label={`${i.label} in ${NAMES[lang] ?? lang}`} className={cx('input min-h-10', i.stale && 'border-warn')} rows={Math.min(8, Math.max(1, Math.ceil(i.text.length / 60)))} lang={lang}
                value={draft[i.path] ?? ''} onChange={(e) => setDraft({ ...draft, [i.path]: e.target.value })} />
              {i.stale && <p className="mt-1 text-xs text-warn">The English changed since this was translated — showing English on the site until you update it.</p>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ scope: string }> }) {
  const { scope } = use(params);
  return <Suspense><Translate scope={scope} /></Suspense>;
}
