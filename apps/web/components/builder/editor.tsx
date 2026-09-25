'use client';

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SECTION_LABELS, SECTION_TYPES, type PageDoc, type PageSection, type SectionType } from '@hp/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditCtx } from '@/components/site/edit';
import { Section as SiteSection, sectionEnabled } from '@/components/site/sections';
import { fontHref, themeVars } from '@/components/site/theme';
import { Drawer, Field, Modal, Segmented, Section, cx, useAction, useToast } from '@/components/ui';
import { ApiError, staffApi } from '@/lib/api';
import { ago, dateTime, human } from '@/lib/format';
import { useCan } from '../admin-context';
import { newSectionId, SECTION_DEFAULTS } from './defaults';
import { Inspector } from './inspector';
import { useSiteData } from './site-data';

type Seo = { title?: string; description?: string; ogImage?: string; noindex?: boolean };
type PageRow = { id: string; slug: string; title: string; draftDoc: PageDoc; draftSeo: Seo; draftRevision: number; publishedVersionId: string | null; hasUnpublishedChanges: boolean; versions: { id: string; version: number; kind: string; note: string | null; createdAt: string }[] };
type Save = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
const WIDTH = { desktop: '100%', tablet: '820px', mobile: '390px' } as const;

function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  const clone: Record<string, unknown> | unknown[] = Array.isArray(obj) ? [...obj] : { ...obj };
  const key = /^\d+$/.test(head!) ? Number(head) : head!;
  (clone as Record<string | number, unknown>)[key] = rest.length ? setPath(((obj as Record<string | number, unknown>)[key] ?? {}) as Record<string, unknown>, rest.join('.'), value) : value;
  return clone as Record<string, unknown>;
}

function OutlineItem({ s, selected, onSelect, onToggle, onDup, onDel, disabled }: { s: PageSection; selected: boolean; onSelect: () => void; onToggle: () => void; onDup: () => void; onDel: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx('group flex items-center gap-1 border-b border-line bg-panel', selected && 'bg-accent-soft', isDragging && 'relative z-10 shadow-sm')}>
      <button {...attributes} {...listeners} className="cursor-grab px-2 py-2.5 text-faint active:cursor-grabbing" aria-label={`Reorder ${SECTION_LABELS[s.type]}`}>⋮⋮</button>
      <button className={cx('min-w-0 flex-1 truncate py-2 text-left text-[13px]', s.hidden && 'text-faint line-through', disabled && 'text-faint')} onClick={onSelect}>
        {SECTION_LABELS[s.type]}{disabled && <span className="ml-1 text-2xs">(module off)</span>}
        <span className="block truncate text-2xs text-muted">{String((s.props as { heading?: string }).heading ?? '')}</span>
      </button>
      <span className="hidden gap-1 pr-1 text-2xs text-muted group-hover:flex">
        <button onClick={onToggle} title={s.hidden ? 'Show' : 'Hide'}>{s.hidden ? 'show' : 'hide'}</button>
        <button onClick={onDup}>copy</button>
        <button onClick={onDel} className="hover:text-bad">del</button>
      </span>
    </li>
  );
}

export function PageEditor({ pageId }: { pageId: string }) {
  const toast = useToast();
  const can = useCan();
  const data = useSiteData();
  const [page, setPage] = useState<PageRow | null>(null);
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [seo, setSeo] = useState<Seo>({});
  const [title, setTitle] = useState('');
  const [past, setPast] = useState<PageDoc[]>([]);
  const [future, setFuture] = useState<PageDoc[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [device, setDevice] = useState<keyof typeof WIDTH>('desktop');
  const [save, setSave] = useState<Save>('saved');
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [panel, setPanel] = useState<null | 'add' | 'seo' | 'versions'>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const rev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { busy, run } = useAction();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const load = useCallback(async () => {
    const r = await staffApi<{ data: PageRow }>(`/admin/pages/${pageId}`);
    setPage(r.data); docRef.current = r.data.draftDoc; setDoc(r.data.draftDoc); setSeo(r.data.draftSeo ?? {}); setTitle(r.data.title); rev.current = r.data.draftRevision; setSave('saved'); pastRef.current = []; futureRef.current = []; setPast([]); setFuture([]);
  }, [pageId]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (d: PageDoc, s: Seo, t: string) => {
    setSave('saving');
    try {
      const r = await staffApi<{ data: { revision: number } }>(`/admin/pages/${pageId}/draft`, { method: 'PUT', body: { doc: d, seo: s, title: t, revision: rev.current } });
      rev.current = r.data.revision; setSave('saved'); setErrors([]); setLastSaved(new Date());
      setPage((p) => (p ? { ...p, hasUnpublishedChanges: true } : p));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setSave('conflict');
      else { setSave('error'); if (e instanceof ApiError && Array.isArray(e.details)) setErrors(e.details as { path: string; message: string }[]); }
    }
  }, [pageId]);

  // Every mutation reads the *current* document from refs. Handlers captured by third-party code
  // (dnd-kit, contentEditable blur) may come from an older render; closures over `doc` would then
  // silently resurrect stale content.
  const docRef = useRef<PageDoc | null>(null);
  const pastRef = useRef<PageDoc[]>([]);
  const futureRef = useRef<PageDoc[]>([]);
  const seoRef = useRef<Seo>({});
  const titleRef = useRef('');
  docRef.current = doc; seoRef.current = seo; titleRef.current = title;

  const schedule = useCallback(() => {
    setSave('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (docRef.current) void persist(docRef.current, seoRef.current, titleRef.current); }, 1200);
  }, [persist]);
  const setHistory = (p: PageDoc[], f: PageDoc[]) => { pastRef.current = p; futureRef.current = f; setPast(p); setFuture(f); };
  const apply = useCallback((next: PageDoc) => { docRef.current = next; setDoc(next); schedule(); }, [schedule]);
  const commit = useCallback((next: PageDoc) => {
    if (docRef.current) setHistory([...pastRef.current.slice(-60), docRef.current], []);
    apply(next);
  }, [apply]);
  const updateSection = useCallback((id: string, fn: (s: PageSection) => PageSection) => {
    const cur = docRef.current;
    if (cur) commit({ sections: cur.sections.map((s) => (s.id === id ? fn(s) : s)) });
  }, [commit]);

  const undo = () => {
    const p = pastRef.current; const cur = docRef.current;
    if (!p.length || !cur) return;
    setHistory(p.slice(0, -1), [cur, ...futureRef.current]);
    apply(p[p.length - 1]!);
  };
  const redo = () => {
    const f = futureRef.current; const cur = docRef.current;
    if (!f.length || !cur) return;
    setHistory([...pastRef.current, cur], f.slice(1));
    apply(f[0]!);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(timer.current); if (docRef.current) void persist(docRef.current, seoRef.current, titleRef.current); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save === 'dirty' || save === 'saving') e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  const editApi = useMemo(() => ({
    editing: true, selected: sel, select: setSel,
    update: (sid: string, path: string, value: unknown) => updateSection(sid, (s) => ({ ...s, props: setPath(s.props, path, value) })),
  }), [sel, updateSection]);

  async function publish() {
    clearTimeout(timer.current);
    if (save !== 'saved' && docRef.current) await persist(docRef.current, seoRef.current, titleRef.current);
    const r = await run(() => staffApi(`/admin/pages/${pageId}/publish`, { body: {} }), 'Published — live on your website');
    if (r) void load();
  }
  function onDragEnd(e: DragEndEvent) {
    const cur = docRef.current;
    if (!cur || !e.over || e.active.id === e.over.id) return;
    const from = cur.sections.findIndex((s) => s.id === e.active.id);
    const to = cur.sections.findIndex((s) => s.id === e.over!.id);
    commit({ sections: arrayMove(cur.sections, from, to) });
  }
  function add(type: SectionType) {
    const doc = docRef.current;
    if (!doc) return;
    const s: PageSection = { id: newSectionId(type), type, props: structuredClone(SECTION_DEFAULTS[type]) };
    const idx = sel ? doc.sections.findIndex((x) => x.id === sel) + 1 : doc.sections.length;
    commit({ sections: [...doc.sections.slice(0, idx), s, ...doc.sections.slice(idx)] });
    setSel(s.id); setPanel(null);
    setTimeout(() => document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  if (!page || !doc || !data) return <div className="grid h-dvh place-items-center text-[13px] text-muted">Opening the editor…</div>;
  const selected = doc.sections.find((s) => s.id === sel);
  const tokens = data.site.theme?.tokens;
  const href = fontHref(tokens);
  const saveLabel = { saved: lastSaved ? `Saved ${ago(lastSaved)}` : 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Couldn’t save — fix the highlighted fields', conflict: 'Changed elsewhere' }[save];

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {href && <link rel="stylesheet" href={href} />}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <a href="/admin/site" className="btn btn-ghost btn-sm">← Website</a>
        <input className="w-44 bg-transparent text-[14px] font-semibold outline-none focus:underline" value={title} aria-label="Page title" onChange={(e) => { titleRef.current = e.target.value; setTitle(e.target.value); schedule(); }} />
        <span className="font-mono text-xs text-muted">/{page.slug === 'home' ? '' : page.slug}</span>
        <span className={cx('text-xs', save === 'error' || save === 'conflict' ? 'text-bad' : 'text-muted')} data-testid="save-state" aria-live="polite">{saveLabel}</span>
        {save === 'conflict' && <button className="btn btn-sm" onClick={load}>Reload latest</button>}
        <div className="ml-auto flex items-center gap-2">
          <Segmented value={device} onChange={setDevice} items={[{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'mobile', label: 'Mobile' }]} />
          <button className="btn btn-sm" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">Undo</button>
          <button className="btn btn-sm" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button className="btn btn-sm" onClick={() => setPanel('seo')}>SEO</button>
          <button className="btn btn-sm" onClick={() => setPanel('versions')}>History</button>
          <a className="btn btn-sm" href={`/admin/site/preview/${pageId}`} target="_blank" rel="noreferrer">Preview</a>
          {can.perm('content.publish') && <button className="btn btn-sm btn-accent" disabled={busy || save === 'conflict' || save === 'error' || (!page.hasUnpublishedChanges && save === 'saved' && !!page.publishedVersionId)} onClick={publish}>{page.publishedVersionId && !page.hasUnpublishedChanges && save === 'saved' ? 'Published' : 'Publish'}</button>}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="eyebrow">Sections</span><button className="btn btn-sm" onClick={() => setPanel('add')}>Add</button></div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex-1 overflow-y-auto" data-testid="outline">
                {doc.sections.map((s) => (
                  <OutlineItem key={s.id} s={s} selected={s.id === sel} disabled={!sectionEnabled(s.type, data.site.tenant.modules)}
                    onSelect={() => { setSel(s.id); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                    onToggle={() => updateSection(s.id, (x) => ({ ...x, hidden: !x.hidden }))}
                    onDup={() => { const i = doc.sections.findIndex((x) => x.id === s.id); const c = { ...structuredClone(s), id: newSectionId(s.type) }; commit({ sections: [...doc.sections.slice(0, i + 1), c, ...doc.sections.slice(i + 1)] }); }}
                    onDel={() => { commit({ sections: doc.sections.filter((x) => x.id !== s.id) }); if (sel === s.id) setSel(null); }} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4" onClick={() => setSel(null)}>
          <div className="site mx-auto min-h-full border border-line transition-[max-width] duration-200" style={{ ...themeVars(tokens), maxWidth: WIDTH[device] }} data-testid="canvas">
            <EditCtx.Provider value={editApi}>
              {doc.sections.map((s) => {
                const on = sectionEnabled(s.type, data.site.tenant.modules);
                return (
                  <div key={s.id} id={`sec-${s.id}`} onClick={(e) => { e.stopPropagation(); setSel(s.id); }}
                    className={cx('relative outline-offset-[-2px]', s.id === sel ? 'outline-2 outline-[#0e5a57] outline' : 'hover:outline hover:outline-1 hover:outline-[#0e5a57]/40', (s.hidden || !on) && 'opacity-40')}>
                    {s.id === sel && <span className="absolute top-0 left-0 z-10 bg-[#0e5a57] px-2 py-0.5 font-sans text-2xs text-white">{SECTION_LABELS[s.type]}{s.hidden ? ' · hidden' : ''}{!on ? ' · module off' : ''}</span>}
                    <SiteSection s={s} d={data} />
                  </div>
                );
              })}
              {doc.sections.length === 0 && <div className="grid h-96 place-items-center font-sans text-[13px] text-muted"><button className="btn" onClick={() => setPanel('add')}>Add your first section</button></div>}
            </EditCtx.Provider>
          </div>
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel" onClick={(e) => e.stopPropagation()}>
          {selected ? (
            <div className="p-4" data-testid="inspector">
              <p className="mb-3 flex items-center justify-between"><span className="text-[14px] font-semibold">{SECTION_LABELS[selected.type]}</span><button className="text-xs text-muted" onClick={() => setSel(null)}>Done</button></p>
              {errors.filter((e) => e.path.startsWith(`sections.${doc.sections.indexOf(selected)}.`)).map((e) => <p key={e.path} className="mb-2 rounded-sm bg-bad-soft px-2 py-1 text-xs text-bad">{e.path.split('.').slice(3).join(' › ')}: {e.message}</p>)}
              <Inspector type={selected.type} props={selected.props} onChange={(p) => updateSection(selected.id, (s) => ({ ...s, props: p }))} />
            </div>
          ) : (
            <div className="p-4 text-[13px] text-muted">
              <p className="mb-2 font-medium text-ink">Editing tips</p>
              <p>Click any text on the page to edit it directly. Select a section to change photos, buttons and layout here.</p>
              <p className="mt-2">Drag sections in the list to reorder. Changes save automatically; guests see them after you publish.</p>
              {errors.length > 0 && <div className="mt-4 rounded-sm bg-bad-soft p-2 text-xs text-bad">{errors.map((e) => <p key={e.path}>{e.path}: {e.message}</p>)}</div>}
            </div>
          )}
        </aside>
      </div>

      <Drawer open={panel === 'add'} onClose={() => setPanel(null)} title="Add a section" sub={sel ? 'It will go below the selected section.' : 'It will go at the end of the page.'} width={420}>
        <ul className="divide-y divide-line">
          {SECTION_TYPES.map((t) => {
            const on = sectionEnabled(t, data.site.tenant.modules);
            return <li key={t}><button disabled={!on} onClick={() => add(t)} className="flex w-full items-center justify-between px-5 py-2.5 text-left text-[13px] hover:bg-sunk disabled:opacity-40">{SECTION_LABELS[t]}{!on && <span className="text-2xs text-muted">module off</span>}</button></li>;
          })}
        </ul>
      </Drawer>
      <Drawer open={panel === 'seo'} onClose={() => setPanel(null)} title="Search & sharing" width={460}>
        <Section>
          <Field label="Page title in search results" hint={`${(seo.title ?? '').length}/70`}><input className="input" maxLength={70} value={seo.title ?? ''} onChange={(e) => { const s = { ...seo, title: e.target.value }; seoRef.current = s; setSeo(s); schedule(); }} /></Field>
          <Field label="Description" hint={`${(seo.description ?? '').length}/170`} className="mt-3"><textarea className="input" rows={3} maxLength={170} value={seo.description ?? ''} onChange={(e) => { const s = { ...seo, description: e.target.value }; seoRef.current = s; setSeo(s); schedule(); }} /></Field>
          <Field label="Sharing image URL" className="mt-3"><input className="input" value={seo.ogImage ?? ''} onChange={(e) => { const s = { ...seo, ogImage: e.target.value || undefined }; seoRef.current = s; setSeo(s); schedule(); }} /></Field>
          <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!seo.noindex} onChange={(e) => { const s = { ...seo, noindex: e.target.checked }; seoRef.current = s; setSeo(s); schedule(); }} /> Hide this page from search engines</label>
          <div className="mt-5 rounded-sm border border-line p-3">
            <p className="text-xs text-muted">{data.site.primaryHost}/{page.slug === 'home' ? '' : page.slug}</p>
            <p className="text-[15px] text-[#1a0dab]">{seo.title || title}</p>
            <p className="text-[13px] text-muted">{seo.description || 'Add a description to control how this page appears in search.'}</p>
          </div>
        </Section>
      </Drawer>
      <Drawer open={panel === 'versions'} onClose={() => setPanel(null)} title="History" sub="Every publish, template change and restore is kept." width={460}>
        <ul className="divide-y divide-line">
          {page.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
              <div><p className="font-medium">Version {v.version} <span className="font-normal text-muted">· {human(v.kind)}</span>{v.id === page.publishedVersionId && <span className="chip chip-ok ml-2">Live</span>}</p><p className="text-xs text-muted">{dateTime(v.createdAt)}{v.note ? ` · ${v.note}` : ''}</p></div>
              {can.perm('content.publish') && <span className="flex gap-1">
                <button className="btn btn-sm" disabled={busy} onClick={() => run(() => staffApi(`/admin/pages/${pageId}/rollback`, { body: { versionId: v.id, publish: false } }), `Version ${v.version} restored to your draft`).then(() => { setPanel(null); void load(); })}>Restore</button>
                <button className="btn btn-sm" disabled={busy || v.id === page.publishedVersionId} onClick={() => run(() => staffApi(`/admin/pages/${pageId}/rollback`, { body: { versionId: v.id, publish: true } }), `Version ${v.version} is live again`).then(() => { setPanel(null); void load(); })}>Make live</button>
              </span>}
            </li>
          ))}
          {!page.versions.length && <li className="px-5 py-6 text-[13px] text-muted">No versions yet — publish to create the first.</li>}
        </ul>
      </Drawer>
      <Modal open={save === 'conflict'} onClose={() => setSave('dirty')} title="This page changed in another window"
        footer={<button className="btn btn-primary" onClick={() => { void load(); toast('Loaded the latest version'); }}>Load the latest version</button>}>
        Someone saved this page elsewhere since you opened it. Load their version to continue — your unsaved edits in this window will be discarded.
      </Modal>
    </div>
  );
}
