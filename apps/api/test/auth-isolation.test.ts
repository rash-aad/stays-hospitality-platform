import { bookings, guests } from '@hp/db';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asSystem, withTenant } from '../src/infra/db.js';
import { addStaff, app, createTenant, platformAdmin, useApp } from './helpers.js';

useApp();

describe('authentication', () => {
  it('logs staff in, rotates refresh tokens and detects reuse', async () => {
    const t = await createTenant();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: t.ownerEmail, password: t.password } });
    expect(login.statusCode).toBe(200);
    expect(login.json().kind).toBe('staff');
    const cookie = login.cookies.find((c) => c.name === 'hp_rt_staff')!;
    expect(cookie.httpOnly).toBe(true);

    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { hp_rt_staff: cookie.value } });
    expect(noCsrf.statusCode).toBe(403);

    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: cookie.value } });
    expect(r1.statusCode).toBe(200);
    const rotated = r1.cookies.find((c) => c.name === 'hp_rt_staff')!.value;

    // The rotated token is used, so replaying the old one is theft: the whole family is revoked.
    const used = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: rotated } });
    expect(used.statusCode).toBe(200);
    const latest = used.cookies.find((c) => c.name === 'hp_rt_staff')!.value;
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: cookie.value } });
    expect(replay.statusCode).toBe(401);
    const after = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: latest } });
    expect(after.statusCode).toBe(401);
  });

  it('tolerates a lost refresh response (old token reused before its successor is ever used)', async () => {
    const t = await createTenant();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: t.ownerEmail, password: t.password } });
    const first = login.cookies.find((c) => c.name === 'hp_rt_staff')!.value;
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: first } });
    const lost = r1.cookies.find((c) => c.name === 'hp_rt_staff')!.value; // the browser never stored this
    const retry = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: first } });
    expect(retry.statusCode).toBe(200);
    // The unused successor is retired, so it can't be used later.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: lost } })).statusCode).toBe(401);
  });

  it('keeps platform sessions in their own refresh cookie', async () => {
    const pa = await platformAdmin();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: pa.user.email, password: 'Password12345' } });
    expect(login.json().kind).toBe('platform');
    const cookie = login.cookies.find((c) => c.name === 'hp_rt_platform')!;
    expect(cookie).toBeTruthy();
    expect(login.cookies.find((c) => c.name === 'hp_rt_staff')).toBeUndefined();
    // A hotel sign-in in the same browser can't stand in for (or replace) the platform session.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh?aud=staff', headers: { 'x-csrf': '1' }, cookies: { hp_rt_platform: cookie.value } })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh?aud=platform', headers: { 'x-csrf': '1' }, cookies: { hp_rt_platform: cookie.value } });
    expect(r.statusCode).toBe(200);
    expect(r.cookies.find((c) => c.name === 'hp_rt_platform')).toBeTruthy();
  });

  it('rejects bad passwords and locks after repeated failures', async () => {
    const t = await createTenant();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: t.ownerEmail, password: 'wrong-password-1' } });
      expect(r.statusCode).toBe(i < 4 ? 401 : 429); // the fifth failure triggers the lock
    }
    const locked = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: t.ownerEmail, password: t.password } });
    expect(locked.statusCode).toBe(429);
  });

  it('rejects forged and missing tokens', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/tenant', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(r.statusCode).toBe(401);
  });
});

describe('RBAC', () => {
  it('enforces permissions per role', async () => {
    const t = await createTenant();
    const kitchen = await addStaff(t, 'kitchen');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: kitchen.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/modules/restaurant', headers: kitchen.auth, payload: { enabled: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: t.auth })).statusCode).toBe(200);
  });

  it('keeps platform routes away from tenant staff', async () => {
    const t = await createTenant();
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: t.auth })).statusCode).toBe(401);
    const root = await platformAdmin();
    expect((await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: root.auth })).statusCode).toBe(200);
  });
});

describe('cross-tenant isolation', () => {
  it('scopes staff to their own tenant regardless of ids in the request', async () => {
    const a = await createTenant();
    const b = await createTenant();
    const staffB = (await app.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: b.auth })).json().data;
    // Tenant A's owner tries to edit tenant B's owner by id.
    const r = await app.inject({ method: 'PATCH', url: `/api/v1/admin/staff/${staffB[0].id}`, headers: a.auth, payload: { status: 'disabled' } });
    expect(r.statusCode).toBe(404);
    const listA = (await app.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: a.auth })).json().data;
    expect(listA.every((u: { email: string }) => u.email.includes(a.slug) || !u.email.includes(b.slug))).toBe(true);
  });

  it('row-level security hides other tenants even without a tenant filter', async () => {
    const a = await createTenant();
    const b = await createTenant();
    await asSystem((tx) => tx.insert(guests).values([
      { tenantId: a.tenant.id, email: 'x@a.test', firstName: 'A', lastName: 'Guest' },
      { tenantId: b.tenant.id, email: 'x@b.test', firstName: 'B', lastName: 'Guest' },
    ]));
    const seen = await withTenant(a.tenant.id, (tx) => tx.select().from(guests));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((g) => g.tenantId === a.tenant.id)).toBe(true);
    // Writing a row for another tenant from A's context is rejected by the policy.
    await expect(withTenant(a.tenant.id, (tx) => tx.insert(guests).values({ tenantId: b.tenant.id, email: 'evil@x.test', firstName: 'E', lastName: 'V' }))).rejects.toThrow();
    // No tenant context at all: nothing is visible.
    const none = await asSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.bypass_rls', 'off', true)`);
      return tx.select().from(bookings);
    });
    expect(none).toHaveLength(0);
  });
});

describe('token/host binding', () => {
  it('refuses a guest token presented on another property’s site', async () => {
    const { inHouseGuest } = await import('./helpers.js');
    const a = await createTenant();
    const b = await createTenant();
    const g = await inHouseGuest(a);
    expect((await app.inject({ method: 'GET', url: '/api/v1/portal/home', headers: { ...g.auth, ...a.host } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/portal/home', headers: { ...g.auth, ...b.host } })).statusCode).toBe(401);
  });
});
