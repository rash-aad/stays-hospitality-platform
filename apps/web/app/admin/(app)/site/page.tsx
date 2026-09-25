'use client';

import type { ThemeTokens } from '@hp/contracts';
import { useEffect, useState } from 'react';
import { useCan, useMe } from '@/components/admin-context';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Section, Status, Tabs, cx, useAction, useToast } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Link = { label: string; href: string };
type Site = {
  theme: { templateKey: string; tokens: ThemeTokens; logoUrl: string | null; faviconUrl: string | null } | null;
  settings: { navigation: Link[]; navCta: Link | null; footer: { columns: { title: string; links: Link[] }[]; note: string; social: Link[] }; seoDefaults: { title?: string; description?: string; ogImage?: string } } | null;
  pages: { id: string; slug: string; title: string; updatedAt: string; hasUnpublishedChanges: boolean; published: boolean }[];
  domains: { id: string; hostname: string; kind: string; verifiedAt: string | null; isPrimary: boolean; txtRecord: { name: string; value: string } | null }[];
};
type Tpl = { key: string; name: string; description: string; suitedFor: string; previewImage: string; tokens: ThemeTokens };
type Tab = 'pages' | 'templates' | 'theme' | 'navigation' | 'domains' | 'media';

export default function SiteHub() {
  const [tab, setTab] = useState<Tab>('pages');
  const { data, error, mutate } = useStaff<{ data: Site }>('/admin/site');
  const me = useMe();
  const primary = data?.data.domains.find((d) => d.isPrimary)?.hostname ?? `${me.tenant.slug}.localhost`;
  const siteUrl = `${location.protocol}//${primary}${location.port && primary.endsWith('localhost') ? `:${location.port}` : ''}`;
  return (
    <>
      <PageHeader title="Website" sub={<a className="hover:underline" href={siteUrl} target="_blank" rel="noreferrer">{primary} ↗</a>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'pages', label: 'Pages' }, { value: 'templates', label: 'Templates' }, { value: 'theme', label: 'Theme' }, { value: 'navigation', label: 'Navigation & footer' }, { value: 'domains', label: 'Domains' }, { value: 'media', label: 'Media' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {!data ? <Loading /> : tab === 'pages' ? <Pages site={data.data} reload={mutate} siteUrl={siteUrl} />
        : tab === 'templates' ? <Templates current={data.data.theme?.templateKey} reload={mutate} />
        : tab === 'theme' ? <Theme site={data.data} reload={mutate} />
        : tab === 'navigation' ? <Navigation site={data.data} reload={mutate} />
        : tab === 'domains' ? <Domains site={data.data} reload={mutate} />
        : <Media />}
    </>
  );
}

function Pages({ site, reload, siteUrl }: { site: Site; reload: () => void; siteUrl: string }) {
  const can = useCan();
  const { busy, run } = useAction();
  const [n, setN] = useState<{ title: string; slug: string; copyFromId: string } | null>(null);
  const [del, setDel] = useState<Site['pages'][number] | null>(null);
  const changes = site.pages.filter((p) => p.hasUnpublishedChanges).length;
  return (
    <div className="bg-panel">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <p className="text-[13px] text-muted">{changes ? `${changes} page${changes > 1 ? 's have' : ' has'} unpublished changes` : 'Everything is live'}</p>
        <span className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setN({ title: '', slug: '', copyFromId: '' })}>New page</button>
          {can.perm('content.publish') && changes > 0 && <button className="btn btn-sm btn-accent" disabled={busy} onClick={() => run(() => staffApi('/admin/pages/publish-all', { body: {} }), 'All pages published').then(() => reload())}>Publish all changes</button>}
        </span>
      </div>
      {site.pages.length === 0 ? <Empty title="No pages yet" action={<span className="text-[13px]">Start from a template in the Templates tab.</span>} /> : (
        <table className="tbl">
          <thead><tr><th>Page</th><th>Address</th><th>Status</th><th>Edited</th><th /></tr></thead>
          <tbody>{site.pages.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.title}</td>
              <td><a className="font-mono text-xs hover:underline" href={`${siteUrl}/${p.slug === 'home' ? '' : p.slug}`} target="_blank" rel="noreferrer">/{p.slug === 'home' ? '' : p.slug}</a></td>
              <td>{!p.published ? <Status value="pending" label="Not published" /> : p.hasUnpublishedChanges ? <Status value="awaiting_payment" label="Draft changes" /> : <Status value="active" label="Live" />}</td>
              <td className="text-muted">{ago(p.updatedAt)}</td>
              <td className="text-right"><span className="flex justify-end gap-1"><a className="btn btn-sm btn-primary" href={`/admin/site/edit/${p.id}`}>Edit</a>{p.slug !== 'home' && can.perm('content.publish') && <button className="btn btn-sm btn-ghost" onClick={() => setDel(p)}>Delete</button>}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Modal open={!!n} onClose={() => setN(null)} title="New page" footer={n && <button className="btn btn-primary" disabled={busy || !n.title || !n.slug} onClick={() => run(() => staffApi<{ data: { id: string } }>('/admin/pages', { body: { title: n.title, slug: n.slug, copyFromId: n.copyFromId || undefined } })).then((r) => { if (r) location.href = `/admin/site/edit/${r.data.id}`; })}>Create and edit</button>}>
        {n && <>
          <Field label="Title"><input className="input" autoFocus value={n.title} onChange={(e) => setN({ ...n, title: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Field>
          <Field label="Address" hint={`${siteUrl}/${n.slug}`} className="mt-3"><input className="input font-mono" value={n.slug} onChange={(e) => setN({ ...n, slug: e.target.value })} /></Field>
          <Field label="Start from" className="mt-3"><select className="input" value={n.copyFromId} onChange={(e) => setN({ ...n, copyFromId: e.target.value })}><option value="">A blank page</option>{site.pages.map((p) => <option key={p.id} value={p.id}>A copy of {p.title}</option>)}</select></Field>
        </>}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title={`Delete “${del?.title}”?`} footer={<><button className="btn" onClick={() => setDel(null)}>Keep</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/pages/${del!.id}`, { method: 'DELETE' }), 'Page deleted').then(() => { setDel(null); reload(); })}>Delete page</button></>}>
        The page comes off your website straight away. Remember to remove it from your navigation.
      </Modal>
    </div>
  );
}

function Swatches({ t }: { t: ThemeTokens }) {
  return <span className="flex">{[t.bg, t.surface, t.ink, t.accent, t.inverseBg].map((c, i) => <span key={i} className="h-4 w-4 border border-black/10" style={{ background: c }} />)}</span>;
}

function Templates({ current, reload }: { current?: string; reload: () => void }) {
  const { data } = useStaff<{ data: Tpl[] }>('/admin/site/templates');
  const [pick, setPick] = useState<Tpl | null>(null);
  const [replace, setReplace] = useState(true);
  const { busy, run } = useAction();
  if (!data) return <Loading />;
  return (
    <div className="p-6">
      <p className="mb-5 max-w-2xl text-[13px] text-muted">Ten designed starting points. Applying one changes your fonts, colours and image treatment — and, if you choose, replaces your pages with its starter pages. Your current pages are kept in History so you can go back.</p>
      <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3" data-testid="templates">
        {data.data.map((t) => (
          <li key={t.key}>
            <button className="group block w-full text-left" onClick={() => { setPick(t); setReplace(true); }}>
              <div className="relative aspect-[4/3] overflow-hidden border border-line" style={{ background: t.tokens.bg }}>
                <img src={t.previewImage} alt="" className="h-3/5 w-full object-cover" style={{ filter: t.tokens.imageTreatment === 'mono' ? 'grayscale(1)' : t.tokens.imageTreatment === 'muted' ? 'saturate(.8)' : t.tokens.imageTreatment === 'warm' ? 'sepia(.12)' : undefined }} />
                <div className="px-4 py-3" style={{ color: t.tokens.ink }}>
                  <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.tokens.fontDisplay).replace(/%20/g, '+')}&display=swap`} />
                  <p className="text-[22px] leading-tight" style={{ fontFamily: `"${t.tokens.fontDisplay}", serif`, textTransform: t.tokens.headingCase === 'uppercase' ? 'uppercase' : 'none', fontWeight: Number(t.tokens.headingWeight) }}>{t.name}</p>
                  <p className="mt-1 text-xs" style={{ color: t.tokens.muted }}>{t.tokens.fontDisplay} · {t.tokens.fontBody}</p>
                </div>
                {current === t.key && <span className="absolute top-2 right-2 bg-ink px-2 py-0.5 text-2xs text-white">Current</span>}
              </div>
              <p className="mt-2 flex items-center justify-between text-[13px] font-medium">{t.name}<Swatches t={t.tokens} /></p>
              <p className="text-xs text-muted">{t.description}</p>
              <p className="text-2xs text-faint">{t.suitedFor}</p>
            </button>
          </li>
        ))}
      </ul>
      <Modal open={!!pick} onClose={() => setPick(null)} title={`Use the ${pick?.name} template?`}
        footer={<><button className="btn" onClick={() => setPick(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/site/templates/${pick!.key}/apply`, { body: { replaceContent: replace } }), `${pick!.name} applied — review and publish your pages`).then(() => { setPick(null); reload(); })}>Apply template</button></>}>
        <p>The new look applies to your draft pages. Nothing changes on your live site until you publish.</p>
        <label className="mt-4 flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span>Also replace my pages with the template’s starter pages<span className="block text-xs text-muted">Home, Rooms, Dining, Experiences and Contact, with sample copy you can edit. Your current versions are saved in History.</span></span></label>
      </Modal>
    </div>
  );
}

const FONTS = ['Fraunces', 'Cormorant Garamond', 'Newsreader', 'Playfair Display', 'DM Serif Display', 'Libre Caslon Text', 'Lora', 'Marcellus', 'Instrument Sans', 'Inter Tight', 'Karla', 'Work Sans', 'Manrope', 'Figtree'];
const COLORS: [keyof ThemeTokens, string][] = [['bg', 'Background'], ['surface', 'Panels'], ['ink', 'Text'], ['muted', 'Secondary text'], ['line', 'Lines'], ['accent', 'Accent'], ['accentInk', 'Text on accent'], ['inverseBg', 'Dark sections'], ['inverseInk', 'Text on dark']];

function Theme({ site, reload }: { site: Site; reload: () => void }) {
  const [t, setT] = useState<ThemeTokens | null>(site.theme?.tokens ?? null);
  const [logo, setLogo] = useState(site.theme?.logoUrl ?? '');
  const { busy, run } = useAction();
  useEffect(() => setT(site.theme?.tokens ?? null), [site.theme]);
  if (!t) return <Empty title="Apply a template first" />;
  const sel = (k: keyof ThemeTokens, opts: string[], label: string) => <Field label={label}><select className="input" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>;
  return (
    <div className="grid gap-px bg-line lg:grid-cols-[1fr_1fr]">
      <div className="bg-panel">
        <Section title="Type">
          <div className="grid grid-cols-2 gap-3">
            {sel('fontDisplay', FONTS, 'Headings')}{sel('fontBody', FONTS, 'Body text')}
            {sel('headingWeight', ['300', '400', '500', '600', '700'], 'Heading weight')}{sel('headingCase', ['none', 'uppercase'], 'Heading case')}
          </div>
        </Section>
        <Section title="Colour">
          <div className="grid grid-cols-3 gap-3">
            {COLORS.map(([k, label]) => <Field key={k} label={label}><span className="flex gap-1.5"><input type="color" className="h-8 w-10 border border-line-strong" value={t[k] as string} onChange={(e) => setT({ ...t, [k]: e.target.value })} /><input className="input font-mono" value={t[k] as string} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></span></Field>)}
          </div>
        </Section>
        <Section title="Shape & photos">
          <div className="grid grid-cols-3 gap-3">{sel('radius', ['0', '2', '4', '8'], 'Corner radius (px)')}{sel('imageTreatment', ['natural', 'warm', 'muted', 'mono'], 'Photo treatment')}{sel('density', ['airy', 'balanced', 'compact'], 'Spacing')}</div>
          <Field label="Logo image URL" hint="Leave empty to use your name in the heading font" className="mt-3"><input className="input" value={logo} onChange={(e) => setLogo(e.target.value)} /></Field>
        </Section>
        <div className="px-5 py-4"><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/site/theme', { method: 'PUT', body: { tokens: t, logoUrl: logo || null } }), 'Theme saved — live on your site').then(() => reload())}>Save theme</button></div>
      </div>
      <div className="bg-panel p-6">
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${[t.fontDisplay, t.fontBody].map((f) => encodeURIComponent(f).replace(/%20/g, '+')).join('&family=')}&display=swap`} />
        <p className="eyebrow mb-3">Preview</p>
        <div className="border border-line" style={{ background: t.bg, color: t.ink, fontFamily: `"${t.fontBody}"` }}>
          <div className="p-8">
            <p className="text-[11px] tracking-[0.16em] uppercase" style={{ color: t.muted }}>Welcome</p>
            <p className="mt-2 text-4xl leading-tight" style={{ fontFamily: `"${t.fontDisplay}"`, fontWeight: Number(t.headingWeight), textTransform: t.headingCase === 'uppercase' ? 'uppercase' : 'none' }}>A house by the sea</p>
            <p className="mt-3 text-sm" style={{ color: t.muted }}>Thirty-two rooms among the palms, a short walk to a quiet beach.</p>
            <span className="mt-5 inline-flex h-10 items-center px-5 text-sm" style={{ background: t.accent, color: t.accentInk, borderRadius: `${t.radius}px` }}>Check availability</span>
          </div>
          <div className="px-8 py-5" style={{ background: t.surface, borderTop: `1px solid ${t.line}` }}><p className="text-sm">Panels and muted sections</p></div>
          <div className="px-8 py-5" style={{ background: t.inverseBg, color: t.inverseInk }}><p style={{ fontFamily: `"${t.fontDisplay}"` }} className="text-xl">Dark sections & footer</p></div>
        </div>
      </div>
    </div>
  );
}

function LinksEditor({ links, onChange, max = 8 }: { links: Link[]; onChange: (l: Link[]) => void; max?: number }) {
  return (
    <div className="space-y-1.5">
      {links.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5">
          <input className="input" placeholder="Label" value={l.label} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <input className="input font-mono text-xs" placeholder="/rooms" value={l.href} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} />
          <button className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => { const n = [...links]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n); }} aria-label="Move up">↑</button>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(links.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {links.length < max && <button className="btn btn-sm" onClick={() => onChange([...links, { label: '', href: '/' }])}>Add link</button>}
    </div>
  );
}

function Navigation({ site, reload }: { site: Site; reload: () => void }) {
  const s0 = site.settings ?? { navigation: [], navCta: null, footer: { columns: [], note: '', social: [] }, seoDefaults: {} };
  const [s, setS] = useState(s0);
  const { busy, run } = useAction();
  return (
    <div className="max-w-3xl bg-panel">
      <Section title="Main navigation"><LinksEditor links={s.navigation} onChange={(navigation) => setS({ ...s, navigation })} /><p className="hint mt-2">“Your stay” is added automatically when the guest portal is on.</p></Section>
      <Section title="Header button">
        <div className="grid grid-cols-2 gap-2"><input className="input" placeholder="Label, e.g. Book" value={s.navCta?.label ?? ''} onChange={(e) => setS({ ...s, navCta: e.target.value ? { label: e.target.value, href: s.navCta?.href ?? '/book' } : null })} /><input className="input font-mono text-xs" value={s.navCta?.href ?? ''} onChange={(e) => setS({ ...s, navCta: { label: s.navCta?.label ?? 'Book', href: e.target.value } })} /></div>
      </Section>
      <Section title="Footer columns" actions={s.footer.columns.length < 4 && <button className="btn btn-sm" onClick={() => setS({ ...s, footer: { ...s.footer, columns: [...s.footer.columns, { title: 'New column', links: [] }] } })}>Add column</button>}>
        {s.footer.columns.map((c, i) => (
          <div key={i} className="mb-4 border border-line p-3">
            <div className="mb-2 flex gap-2"><input className="input" value={c.title} onChange={(e) => setS({ ...s, footer: { ...s.footer, columns: s.footer.columns.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) } })} /><button className="btn btn-sm btn-ghost" onClick={() => setS({ ...s, footer: { ...s.footer, columns: s.footer.columns.filter((_, j) => j !== i) } })}>Remove column</button></div>
            <LinksEditor links={c.links} max={10} onChange={(links) => setS({ ...s, footer: { ...s.footer, columns: s.footer.columns.map((x, j) => (j === i ? { ...x, links } : x)) } })} />
          </div>
        ))}
        <Field label="Footer note" hint="Registered name, address, GSTIN"><input className="input" value={s.footer.note} onChange={(e) => setS({ ...s, footer: { ...s.footer, note: e.target.value } })} /></Field>
        <p className="label mt-3">Social links</p><LinksEditor links={s.footer.social} onChange={(social) => setS({ ...s, footer: { ...s.footer, social } })} />
      </Section>
      <Section title="Search defaults">
        <Field label="Site title"><input className="input" maxLength={70} value={s.seoDefaults.title ?? ''} onChange={(e) => setS({ ...s, seoDefaults: { ...s.seoDefaults, title: e.target.value } })} /></Field>
        <Field label="Site description" className="mt-3"><textarea className="input" rows={2} maxLength={170} value={s.seoDefaults.description ?? ''} onChange={(e) => setS({ ...s, seoDefaults: { ...s.seoDefaults, description: e.target.value } })} /></Field>
      </Section>
      <div className="px-5 py-4"><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/site/settings', { method: 'PUT', body: { navigation: s.navigation.filter((l) => l.label), navCta: s.navCta, footer: s.footer, seoDefaults: { title: s.seoDefaults.title || undefined, description: s.seoDefaults.description || undefined, ogImage: s.seoDefaults.ogImage || undefined } } }), 'Navigation saved — live on your site').then(() => reload())}>Save</button></div>
    </div>
  );
}

function Domains({ site, reload }: { site: Site; reload: () => void }) {
  const [host, setHost] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();
  return (
    <div className="max-w-3xl bg-panel">
      <ul className="divide-y divide-line">
        {site.domains.map((d) => (
          <li key={d.id} className="px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[13px]">{d.hostname}{d.isPrimary && <span className="chip chip-accent ml-2 font-sans">Primary</span>}</p>
              <span className="flex items-center gap-2">
                {d.verifiedAt ? <Status value="active" label="Connected" /> : <Status value="pending" label="Waiting for DNS" />}
                {!d.verifiedAt && <button className="btn btn-sm" disabled={busy} onClick={() => run(() => staffApi(`/admin/domains/${d.id}/verify`, { body: {} }), 'Domain connected').then(() => reload())}>Check now</button>}
                {d.verifiedAt && !d.isPrimary && <button className="btn btn-sm" onClick={() => run(() => staffApi(`/admin/domains/${d.id}/primary`, { body: {} }), 'Primary domain changed').then(() => reload())}>Make primary</button>}
                {d.kind === 'custom' && <button className="btn btn-sm btn-ghost" onClick={() => run(() => staffApi(`/admin/domains/${d.id}`, { method: 'DELETE' }), 'Domain removed').then(() => reload())}>Remove</button>}
              </span>
            </div>
            {!d.verifiedAt && d.txtRecord && (
              <div className="mt-3 rounded-sm bg-sunk p-3 text-xs">
                <p className="mb-2 text-[13px]">Add these records at your domain provider, then press Check now:</p>
                <table className="w-full font-mono"><tbody>
                  <tr><td className="pr-3 text-muted">TXT</td><td className="pr-3 select-all">{d.txtRecord.name}</td><td className="select-all break-all">{d.txtRecord.value}</td><td><button className="font-sans underline" onClick={() => { navigator.clipboard.writeText(d.txtRecord!.value); toast('Copied'); }}>copy</button></td></tr>
                  <tr><td className="pr-3 text-muted">CNAME</td><td className="pr-3">{d.hostname}</td><td>sites.stays.app</td><td /></tr>
                </tbody></table>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2 border-t border-line px-6 py-4" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/domains', { body: { hostname: host } }), 'Domain added — now add the DNS records').then((r) => { if (r) { setHost(''); reload(); } }); }}>
        <input className="input" placeholder="www.yourhotel.com" value={host} onChange={(e) => setHost(e.target.value)} required /><button className="btn" disabled={busy}>Connect a domain</button>
      </form>
    </div>
  );
}

function Media() {
  const { data, mutate } = useStaff<{ data: { id: string; url: string; alt: string; createdAt: string }[] }>('/admin/media');
  const { busy, run } = useAction();
  const toast = useToast();
  const [url, setUrl] = useState('');
  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap gap-2">
        <label className={cx('btn btn-primary', busy && 'opacity-50')}>Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); run(() => staffApi('/files?purpose=media', { form: fd }), 'Uploaded').then(() => mutate()); e.target.value = ''; }} /></label>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/media', { body: { url } }), 'Added').then((r) => { if (r) { setUrl(''); mutate(); } }); }}><input className="input w-80" type="url" placeholder="Or paste an https:// image address" value={url} onChange={(e) => setUrl(e.target.value)} required /><button className="btn">Add</button></form>
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="Your media library is empty" /> : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {data.data.map((m) => (
            <li key={m.id}>
              <img src={m.url} alt={m.alt} className="aspect-[4/3] w-full border border-line object-cover" />
              <input className="input mt-1 h-7 text-xs" placeholder="Describe the photo" defaultValue={m.alt} onBlur={(e) => e.target.value !== m.alt && run(() => staffApi(`/admin/media/${m.id}`, { method: 'PATCH', body: { alt: e.target.value } }), 'Saved')} />
              <p className="mt-1 flex justify-between text-2xs text-muted"><button onClick={() => { navigator.clipboard.writeText(m.url); toast('Image address copied — paste it into a section'); }} className="underline">Copy address</button><button className="hover:text-bad" onClick={() => run(() => staffApi(`/admin/media/${m.id}`, { method: 'DELETE' }), 'Removed').then(() => mutate())}>Remove</button></p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
void dateTime;
