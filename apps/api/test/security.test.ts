import { users } from '@hp/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asSystem } from '../src/infra/db.js';
import { totp } from '../src/lib/totp.js';
import { runtimeConfig } from '../src/runtime.js';
import { addStaff, app, createTenant, platformAdmin, useApp, type TestTenant } from './helpers.js';
import { hashPassword } from '../src/domain/auth/service.js';

useApp();

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email, password } });

/** Enrol the caller in two-step sign-in; returns the secret and recovery codes. */
async function enrol(auth: Record<string, string>) {
  const setup = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/setup', headers: auth });
  expect(setup.statusCode).toBe(200);
  const secret = setup.json().data.secret as string;
  expect(setup.json().data.qr).toMatch(/^data:image\/png;base64,/);
  const on = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/enable', headers: auth, payload: { code: totp(secret) } });
  expect(on.statusCode).toBe(200);
  return { secret, recoveryCodes: on.json().recoveryCodes as string[], token: on.json().accessToken as string };
}

/** A code from the *next* 30 s step — valid (clock drift allowance) and not yet used. */
const nextCode = (secret: string) => totp(secret, Date.now() + 30_000);

async function staffWithPassword(t: TestTenant, role: string, password: string) {
  const s = await addStaff(t, role);
  const passwordHash = await hashPassword(password);
  await asSystem((tx) => tx.update(users).set({ passwordHash }).where(eq(users.id, s.user.id)));
  return s;
}

describe('two-step sign-in', () => {
  it('enrols, then requires a one-time code at sign-in; codes and recovery codes work once', async () => {
    const t = await createTenant();
    const { secret, recoveryCodes } = await enrol(t.auth);
    expect(recoveryCodes).toHaveLength(10);

    const step1 = await login(t.ownerEmail, t.password);
    expect(step1.json()).toMatchObject({ mfaRequired: true });
    expect(step1.json().accessToken).toBeUndefined();
    expect(step1.cookies.find((c) => c.name === 'hp_rt_staff')).toBeUndefined();
    const challenge = step1.json().challenge;

    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa', payload: { challenge, code: '000000' } })).statusCode).toBe(401);
    const code = nextCode(secret);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa', payload: { challenge, code } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mfa).toBe('ok');
    // The same code can't be replayed.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa', payload: { challenge, code } })).statusCode).toBe(401);
    // A recovery code works exactly once (any case, with or without the dash).
    const rc = recoveryCodes[0]!;
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa', payload: { challenge, code: rc.toUpperCase().replace('-', '') } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa', payload: { challenge, code: rc } })).statusCode).toBe(401);
    // A challenge is not an access token.
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: bearer(challenge) })).statusCode).toBe(401);
    const status = (await app.inject({ method: 'GET', url: '/api/v1/auth/mfa', headers: bearer(ok.json().accessToken) })).json().data;
    expect(status).toMatchObject({ enabled: true, recoveryCodesLeft: 9 });
  });

  it('a tenant policy forces enrolment before anything else, and owners must enrol first', async () => {
    const t = await createTenant();
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/security-settings', headers: t.auth, payload: { requireMfa: 'all' } })).statusCode).toBe(409);
    const owner = await enrol(t.auth);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/admin/security-settings', headers: bearer(owner.token), payload: { requireMfa: 'all' } })).statusCode).toBe(200);

    const desk = await staffWithPassword(t, 'front_desk', 'Desk-password-2026');
    const r = await login(desk.user.email, 'Desk-password-2026');
    expect(r.json().mfa).toBe('pending');
    const pending = bearer(r.json().accessToken);
    const blocked = await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: pending });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('mfa_required');
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: pending })).json().user.mfa).toBe('pending');
    const enrolled = await enrol(pending);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/bookings', headers: bearer(enrolled.token) })).statusCode).toBe(200);
    // Can't switch it off while the policy requires it.
    const off = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa/disable', headers: bearer(enrolled.token), payload: { password: 'Desk-password-2026', code: nextCode(enrolled.secret) } });
    expect(off.statusCode).toBe(409);

    // Lost phone: the owner resets it; the staff member's sessions end and they must enrol again.
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/staff/${desk.user.id}/reset-mfa`, headers: bearer(owner.token) })).statusCode).toBe(200);
    const again = await login(desk.user.email, 'Desk-password-2026');
    expect(again.json().mfa).toBe('pending');
  });

  it('platform admins must use it when required, and the console honours an IP allow-list', async () => {
    const cfg = runtimeConfig();
    const pa = await platformAdmin();
    cfg.PLATFORM_REQUIRE_MFA = '1';
    try {
      const r = await login(pa.user.email, 'Password12345');
      expect(r.json().mfa).toBe('pending');
      expect((await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: bearer(r.json().accessToken) })).statusCode).toBe(403);
      const e = await enrol(bearer(r.json().accessToken));
      expect((await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: bearer(e.token) })).statusCode).toBe(200);

      cfg.PLATFORM_IP_ALLOWLIST = '203.0.113.0/24';
      const denied = await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: bearer(e.token) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('ip_not_allowed');
      cfg.PLATFORM_IP_ALLOWLIST = '127.0.0.1, ::1';
      expect((await app.inject({ method: 'GET', url: '/api/v1/platform/tenants', headers: bearer(e.token) })).statusCode).toBe(200);
    } finally {
      cfg.PLATFORM_REQUIRE_MFA = undefined;
      cfg.PLATFORM_IP_ALLOWLIST = undefined;
    }
  });
});

describe('signed-in devices', () => {
  it('lists sessions per device and signs out the others', async () => {
    const t = await createTenant();
    const a = await login(t.ownerEmail, t.password);
    await login(t.ownerEmail, t.password);
    const cookie = a.cookies.find((c) => c.name === 'hp_rt_staff')!.value;
    const headers = bearer(a.json().accessToken);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers, cookies: { hp_rt_staff: cookie } })).json().data;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/sessions/sign-out-others', headers, cookies: { hp_rt_staff: cookie } });
    expect(out.json().signedOut).toBeGreaterThanOrEqual(1);
    const after = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers, cookies: { hp_rt_staff: cookie } })).json().data;
    expect(after).toHaveLength(1);
    expect(after[0].current).toBe(true);
    // The current device still refreshes.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: cookie } })).statusCode).toBe(200);
  });
});
