import { describe, expect, it } from 'vitest';
import { app, createTenant, useApp } from './helpers.js';

useApp();

describe('content translations', () => {
  it('serves translated pages and menus in enabled languages, and falls back to English for stale or missing text', async () => {
    const t = await createTenant();
    await app.inject({ method: 'POST', url: '/api/v1/admin/site/templates/beach/apply', headers: t.auth, payload: {} });
    const site = (await app.inject({ method: 'GET', url: '/api/v1/admin/site', headers: t.auth })).json().data;
    const home = site.pages.find((p: { slug: string }) => p.slug === 'home');
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${home.id}/publish`, headers: t.auth, payload: { note: 'Launch' } })).statusCode).toBe(200);

    const list = (await app.inject({ method: 'GET', url: `/api/v1/admin/translations/${home.id}?locale=hi`, headers: t.auth })).json().data;
    const heading = list.items.find((i: { path: string }) => /^[^.]+\.heading$/.test(i.path));
    expect(heading).toBeTruthy();
    expect(heading.translation).toBe('');

    expect((await app.inject({ method: 'PUT', url: `/api/v1/admin/translations/${home.id}`, headers: t.auth, payload: { locale: 'en', strings: {} } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/admin/translations/${home.id}`, headers: t.auth, payload: { locale: 'hi', strings: { 'nope.heading': 'x' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/admin/translations/${home.id}`, headers: t.auth, payload: { locale: 'hi', strings: { [heading.path]: 'समुद्र के किनारे जागिए' } } })).json().data.saved).toBe(1);

    const menu = (await app.inject({ method: 'GET', url: '/api/v1/admin/translations/site?locale=hi', headers: t.auth })).json().data.items;
    const first = menu.find((i: { path: string }) => i.path.startsWith('navigation.'));
    await app.inject({ method: 'PUT', url: '/api/v1/admin/translations/site', headers: t.auth, payload: { locale: 'hi', strings: { [first.path]: 'कमरे' } } });

    const page = (lang?: string) => app.inject({ method: 'GET', url: `/api/v1/public/pages/home${lang ? `?lang=${lang}` : ''}`, headers: t.host }).then((r) => r.json().data.doc.sections[0].props.heading);
    const nav = (lang?: string) => app.inject({ method: 'GET', url: `/api/v1/public/site${lang ? `?lang=${lang}` : ''}`, headers: t.host }).then((r) => r.json().data);
    // Hindi not enabled yet → English everywhere.
    expect((await nav('hi')).locale).toBe('en');
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/site-languages', headers: t.auth, payload: { languages: ['hi', 'ml'] } })).json().data.languages).toEqual(['en', 'hi', 'ml']);
    expect(await page('hi')).toBe('समुद्र के किनारे जागिए');
    expect(await page()).toBe(heading.text);
    const s = await nav('hi');
    expect(s.locale).toBe('hi');
    expect(s.settings.navigation[Number(first.path.split('.')[1])].label).toBe('कमरे');
    expect(s.settings.languages).toEqual(['en', 'hi', 'ml']);

    // Change the English and republish: the old translation is stale, so English shows until updated.
    const draft = (await app.inject({ method: 'GET', url: `/api/v1/admin/pages/${home.id}`, headers: t.auth })).json().data;
    draft.draftDoc.sections[0].props.heading = 'Wake to the waves';
    await app.inject({ method: 'PUT', url: `/api/v1/admin/pages/${home.id}/draft`, headers: t.auth, payload: { doc: draft.draftDoc, revision: draft.draftRevision } });
    await app.inject({ method: 'POST', url: `/api/v1/admin/pages/${home.id}/publish`, headers: t.auth, payload: { note: 'Copy edit' } });
    expect(await page('hi')).toBe('Wake to the waves');
    expect((await app.inject({ method: 'GET', url: `/api/v1/admin/translations/${home.id}?locale=hi`, headers: t.auth })).json().data.items.find((i: { path: string }) => i.path === heading.path)).toMatchObject({ stale: true, translation: 'समुद्र के किनारे जागिए' });
  });
});
