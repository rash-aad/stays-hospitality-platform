import { describe, expect, it } from 'vitest';
import { setTxtResolver } from '../src/domain/content/domains.js';
import { resolveHost } from '../src/domain/tenants/tenant-cache.js';
import { addStaff, app, createTenant, platformAdmin, useApp } from './helpers.js';

useApp();

describe('website builder', () => {
  it('applies a template, autosaves with revisions, publishes, and rolls back', async () => {
    const t = await createTenant();
    const apply = await app.inject({ method: 'POST', url: '/api/v1/admin/site/templates/hill_station/apply', headers: t.auth, payload: {} });
    expect(apply.json().data.pages).toBe(5);
    const site = (await app.inject({ method: 'GET', url: '/api/v1/admin/site', headers: t.auth })).json().data;
    expect(site.theme.templateKey).toBe('hill_station');
    const home = site.pages.find((p: { slug: string }) => p.slug === 'home');

    // Not public until published.
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/pages/home', headers: t.host })).statusCode).toBe(404);

    const page = (await app.inject({ method: 'GET', url: `/api/v1/admin/pages/${home.id}`, headers: t.auth })).json().data;
    const doc = page.draftDoc;
    doc.sections[0].props.heading = 'Hello <script>alert(1)</script>from the hills';
    const save = await app.inject({ method: 'PUT', url: `/api/v1/admin/pages/${home.id}/draft`, headers: t.auth, payload: { doc, revision: page.draftRevision } });
    expect(save.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PUT', url: `/api/v1/admin/pages/${home.id}/draft`, headers: t.auth, payload: { doc, revision: page.draftRevision } });
    expect(stale.statusCode).toBe(409);

    const pub1 = await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${home.id}/publish`, headers: t.auth, payload: {} });
    expect(pub1.statusCode).toBe(200);
    const live = (await app.inject({ method: 'GET', url: '/api/v1/public/pages/home', headers: t.host })).json().data;
    expect(live.doc.sections[0].props.heading).toBe('Hello alert(1)from the hills'); // tags stripped

    const v1 = pub1.json().data.id;
    doc.sections[0].props.heading = 'Second version';
    await app.inject({ method: 'PUT', url: `/api/v1/admin/pages/${home.id}/draft`, headers: t.auth, payload: { doc, revision: save.json().data.revision } });
    await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${home.id}/publish`, headers: t.auth, payload: {} });
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/pages/home', headers: t.host })).json().data.doc.sections[0].props.heading).toBe('Second version');

    const rb = await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${home.id}/rollback`, headers: t.auth, payload: { versionId: v1, publish: true } });
    expect(rb.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/pages/home', headers: t.host })).json().data.doc.sections[0].props.heading).toBe('Hello alert(1)from the hills');
  });

  it('rejects invalid documents with field paths', async () => {
    const t = await createTenant();
    await app.inject({ method: 'POST', url: '/api/v1/admin/site/templates/beach/apply', headers: t.auth, payload: {} });
    const site = (await app.inject({ method: 'GET', url: '/api/v1/admin/site', headers: t.auth })).json().data;
    const home = site.pages.find((p: { slug: string }) => p.slug === 'home');
    const page = (await app.inject({ method: 'GET', url: `/api/v1/admin/pages/${home.id}`, headers: t.auth })).json().data;
    const doc = page.draftDoc;
    doc.sections[0].props.primaryCta = { label: 'Pwn', href: 'javascript:alert(document.cookie)' };
    const r = await app.inject({ method: 'PUT', url: `/api/v1/admin/pages/${home.id}/draft`, headers: t.auth, payload: { doc, revision: page.draftRevision } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.details[0].path).toContain('primaryCta.href');
  });

  it('only publishers can publish; builder module toggle is enforced', async () => {
    const t = await createTenant();
    await app.inject({ method: 'POST', url: '/api/v1/admin/site/templates/luxury/apply', headers: t.auth, payload: {} });
    const site = (await app.inject({ method: 'GET', url: '/api/v1/admin/site', headers: t.auth })).json().data;
    const kitchen = await addStaff(t, 'kitchen');
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${site.pages[0].id}/publish`, headers: kitchen.auth, payload: {} })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/website_builder', headers: t.auth, payload: { enabled: false } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/site', headers: t.auth })).statusCode).toBe(403);
  });
});

describe('domain resolution', () => {
  it('resolves platform subdomains and only verified custom domains', async () => {
    const t = await createTenant();
    expect(await resolveHost(`${t.slug}.localhost`, 'localhost')).toBe(t.tenant.id);
    expect(await resolveHost(`${t.slug.toUpperCase()}.LOCALHOST:3000`, 'localhost')).toBe(t.tenant.id);
    expect(await resolveHost('nope-does-not-exist.localhost', 'localhost')).toBeNull();

    const host = `www.${t.slug}-hotel.com`;
    const add = await app.inject({ method: 'POST', url: '/api/v1/admin/domains', headers: t.auth, payload: { hostname: `https://${host}/` } });
    expect(add.statusCode).toBe(201);
    const d = add.json().data;
    expect(d.hostname).toBe(host);
    expect(await resolveHost(host, 'localhost')).toBeNull(); // unverified

    setTxtResolver(async () => [['stays-verify=wrong']]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/domains/${d.id}/verify`, headers: t.auth })).statusCode).toBe(409);
    setTxtResolver(async (name) => (name === `_bookez-verify.${host}` ? [[d.txtRecord.value]] : []));
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/domains/${d.id}/verify`, headers: t.auth })).statusCode).toBe(200);
    expect(await resolveHost(host, 'localhost')).toBe(t.tenant.id);

    // Another tenant cannot claim the same hostname.
    const other = await createTenant();
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/domains', headers: other.auth, payload: { hostname: host } })).statusCode).toBe(409);
    // Public API scoped by host serves the right tenant.
    const site = (await app.inject({ method: 'GET', url: '/api/v1/public/site', headers: { 'x-tenant-host': host } })).json().data;
    expect(site.tenant.slug).toBe(t.slug);
  });

  it('reports whether a site is live, uncached, and 404s once the property is suspended', async () => {
    const t = await createTenant();
    const pa = await platformAdmin();
    const live = await app.inject({ method: 'GET', url: '/api/v1/public/site-status', headers: t.host });
    expect(live.statusCode).toBe(200);
    expect(live.headers['cache-control']).toBe('no-store');
    await app.inject({ method: 'PATCH', url: `/api/v1/platform/tenants/${t.tenant.id}`, headers: pa.auth, payload: { status: 'suspended' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/site-status', headers: t.host })).statusCode).toBe(404);
  });

  it('serves a per-tenant PWA manifest', async () => {
    const t = await createTenant();
    const m = await app.inject({ method: 'GET', url: '/api/v1/public/manifest', headers: t.host });
    expect(m.headers['content-type']).toContain('application/manifest+json');
    expect(m.json().name).toBe(t.tenant.name);
    expect(m.json().display).toBe('standalone');
  });
});
