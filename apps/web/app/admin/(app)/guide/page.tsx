'use client';

import { useState } from 'react';
import { Resource } from '@/components/resource';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, Tabs, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Block = { type: 'p' | 'h' | 'list' | 'kv' | 'callout'; text?: string; items?: string[]; rows?: { k: string; v: string }[]; tone?: string };
type Page = { id: string; propertyId: string; category: string; slug: string; title: string; summary: string | null; body: Block[]; published: boolean; sort: number };
const CATS = ['about', 'dining', 'facilities', 'wifi', 'house_rules', 'emergency', 'nearby', 'transport', 'contact', 'faq', 'custom'];

/** Guide text is edited as plain blocks: paragraphs, headings, lists, key/value rows and callouts. */
function toText(b: Block[]) {
  return b.map((x) => x.type === 'h' ? `## ${x.text}` : x.type === 'list' ? x.items!.map((i) => `- ${i}`).join('\n') : x.type === 'kv' ? x.rows!.map((r) => `${r.k}: ${r.v}`).join('\n') : x.type === 'callout' ? `! ${x.tone === 'emergency' ? '!' : ''}${x.text}` : x.text).join('\n\n');
}
function fromText(t: string): Block[] {
  return t.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).map((c) => {
    const lines = c.split('\n');
    if (c.startsWith('## ')) return { type: 'h' as const, text: c.slice(3) };
    if (c.startsWith('!!')) return { type: 'callout' as const, tone: 'emergency', text: c.slice(2).trim() };
    if (c.startsWith('! ')) return { type: 'callout' as const, tone: 'info', text: c.slice(2).trim() };
    if (lines.every((l) => l.startsWith('- '))) return { type: 'list' as const, items: lines.map((l) => l.slice(2)) };
    if (lines.every((l) => /^[^:]{1,60}:\s/.test(l))) return { type: 'kv' as const, rows: lines.map((l) => { const i = l.indexOf(':'); return { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() }; }) };
    return { type: 'p' as const, text: c };
  });
}

export default function Guide() {
  const [tab, setTab] = useState<'pages' | 'notices'>('pages');
  const { data, error, mutate } = useStaff<{ data: Page[] }>('/admin/guide-pages');
  const { data: props } = useStaff<{ data: { id: string }[] }>('/admin/properties');
  const [e, setE] = useState<{ p: Partial<Page>; text: string } | null>(null);
  const { busy, run } = useAction();
  return (
    <>
      <PageHeader title="Guest guide" sub="What guests see under Property guide in their portal — saved on their phone for when the Wi-Fi drops."
        actions={tab === 'pages' && <button className="btn btn-primary" onClick={() => setE({ p: { category: 'custom', published: true, sort: (data?.data.length ?? 0) }, text: '' })}>New page</button>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'pages', label: 'Guide pages' }, { value: 'notices', label: 'Announcements' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {tab === 'notices' ? (
        <Resource<{ id: string; title: string; body: string; published: boolean; endsAt: string | null }> endpoint="/admin/announcements" noun="Announcement"
          fields={[{ key: 'title', label: 'Title', required: true, wide: true }, { key: 'body', label: 'Message', type: 'textarea', required: true }, { key: 'startsAt', label: 'Show from', type: 'datetime', nullable: true }, { key: 'endsAt', label: 'Show until', type: 'datetime', nullable: true }, { key: 'published', label: 'Published', type: 'bool', defaultValue: true }]}
          columns={[{ label: 'Announcement', render: (r) => <><p className="font-medium">{r.title}</p><p className="max-w-lg truncate text-xs text-muted">{r.body}</p></> }, { label: 'Until', render: (r) => (r.endsAt ? date(r.endsAt) : '—') }, { label: 'Published', render: (r) => (r.published ? 'Yes' : 'No') }]} />
      ) : !data ? <Loading /> : (
        <ul className="divide-y divide-line bg-panel">
          {[...data.data].sort((a, b) => a.sort - b.sort).map((p) => (
            <li key={p.id}><button className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-[#faf9f7]" onClick={() => setE({ p, text: toText(p.body) })}>
              <span><span className="block text-[13px] font-medium">{p.title}</span><span className="block text-xs text-muted">{human(p.category)}{p.summary ? ` · ${p.summary}` : ''}</span></span>
              <span className="text-xs text-muted">{p.published ? 'Published' : 'Draft'}</span>
            </button></li>
          ))}
        </ul>
      )}
      <Drawer open={!!e} onClose={() => setE(null)} title={e?.p.id ? e.p.title! : 'New guide page'} width={680}
        footer={e && <>{e.p.id && <button className="btn btn-danger mr-auto" onClick={() => run(() => staffApi(`/admin/guide-pages/${e.p.id}`, { method: 'DELETE' }), 'Page deleted').then(() => { setE(null); mutate(); })}>Delete</button>}<button className="btn btn-primary" disabled={busy || !e.p.title} onClick={() => {
          const body = { propertyId: e.p.propertyId ?? props?.data[0]?.id, category: e.p.category, slug: e.p.slug || e.p.title!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: e.p.title, summary: e.p.summary || null, body: fromText(e.text), published: e.p.published, sort: e.p.sort ?? 0 };
          run(() => e.p.id ? staffApi(`/admin/guide-pages/${e.p.id}`, { method: 'PATCH', body }) : staffApi('/admin/guide-pages', { body }), 'Guide page saved').then((r) => { if (r) { setE(null); mutate(); } });
        }}>Save</button></>}>
        {e && (
          <Section>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title"><input className="input" value={e.p.title ?? ''} onChange={(x) => setE({ ...e, p: { ...e.p, title: x.target.value } })} /></Field>
              <Field label="Section"><select className="input" value={e.p.category} onChange={(x) => setE({ ...e, p: { ...e.p, category: x.target.value } })}>{CATS.map((c) => <option key={c} value={c}>{human(c)}</option>)}</select></Field>
              <Field label="Summary" className="col-span-2"><input className="input" value={e.p.summary ?? ''} onChange={(x) => setE({ ...e, p: { ...e.p, summary: x.target.value } })} /></Field>
            </div>
            <Field label="Content" className="mt-3" hint="Blank line between blocks. ## heading · - list item · Label: value rows · ! note · !! emergency note">
              <textarea className="input font-mono text-xs leading-relaxed" rows={16} value={e.text} onChange={(x) => setE({ ...e, text: x.target.value })} />
            </Field>
            <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!e.p.published} onChange={(x) => setE({ ...e, p: { ...e.p, published: x.target.checked } })} /> Published</label>
          </Section>
        )}
      </Drawer>
    </>
  );
}
