import { housekeepingTasks, refreshTokens, rooms, users } from '@hp/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/domain/auth/service.js';
import { weakPin } from '../src/domain/auth/device-routes.js';
import { asSystem } from '../src/infra/db.js';
import { addStaff, app, createTenant, useApp, type TestTenant } from './helpers.js';

useApp();

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function withPassword(t: TestTenant, role: string) {
  const s = await addStaff(t, role);
  const passwordHash = await hashPassword('Staff-password-26');
  await asSystem((tx) => tx.update(users).set({ passwordHash }).where(eq(users.id, s.user.id)));
  return s;
}

describe('shared devices and PIN sign-in', () => {
  it('rejects guessable PINs', () => {
    for (const p of ['0000', '1111', '1234', '4321', '123456', '987654']) expect(weakPin(p)).toBe(true);
    for (const p of ['2580', '1379', '4827', '731946']) expect(weakPin(p)).toBe(false);
  });

  it('enrols a device, signs staff in by PIN for one shift, locks after wrong PINs, and stops when revoked', async () => {
    const t = await createTenant();
    const hk = await withPassword(t, 'housekeeping');
    expect((await app.inject({ method: 'PUT', url: '/api/v1/auth/pin', headers: hk.auth, payload: { pin: '1234', password: 'Staff-password-26' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/auth/pin', headers: hk.auth, payload: { pin: '4827', password: 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/auth/pin', headers: hk.auth, payload: { pin: '4827', password: 'Staff-password-26' } })).statusCode).toBe(200);
    // Owners never appear on shared devices, even with a PIN.
    const ownerPin = await app.inject({ method: 'PUT', url: '/api/v1/auth/pin', headers: t.auth, payload: { pin: '5093', password: t.password } });
    expect(ownerPin.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/device' })).statusCode).toBe(404);
    const enrol = await app.inject({ method: 'POST', url: '/api/v1/admin/devices', headers: t.auth, payload: { name: 'Front desk iPad' } });
    expect(enrol.statusCode).toBe(201);
    const device = enrol.cookies.find((c) => c.name === 'hp_device')!;
    expect(device.httpOnly).toBe(true);
    const cookies = { hp_device: device.value };

    const who = (await app.inject({ method: 'GET', url: '/api/v1/auth/device', cookies })).json().data;
    expect(who.device).toBe('Front desk iPad');
    expect(who.people.map((p: { id: string }) => p.id)).toEqual([hk.user.id]);

    // Without the device cookie a PIN is useless.
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/pin-login', payload: { userId: hk.user.id, pin: '4827' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/pin-login', cookies, payload: { userId: hk.user.id, pin: '4827' } });
    expect(ok.statusCode).toBe(200);
    const [row] = await asSystem((tx) => tx.select().from(refreshTokens).where(eq(refreshTokens.userId, hk.user.id)));
    expect(row!.deviceId).toBeTruthy();
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3600_000 + 5000);
    // Refreshing keeps the end of the shift.
    const rt = ok.cookies.find((c) => c.name === 'hp_rt_staff')!.value;
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: rt } });
    expect(r1.statusCode).toBe(200);
    const rows = await asSystem((tx) => tx.select().from(refreshTokens).where(eq(refreshTokens.userId, hk.user.id)));
    expect(new Set(rows.map((x) => x.expiresAt.getTime())).size).toBe(1);
    // The session works and /auth/me knows it's a shared device.
    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(ok.json().accessToken), cookies })).json();
    expect(me.sharedDevice).toBe('Front desk iPad');
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/pin-login', cookies, payload: { userId: t.ownerId, pin: '5093' } })).statusCode).toBe(401);

    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/v1/auth/pin-login', cookies, payload: { userId: hk.user.id, pin: '9999' } });
    const locked = await app.inject({ method: 'POST', url: '/api/v1/auth/pin-login', cookies, payload: { userId: hk.user.id, pin: '4827' } });
    expect(locked.statusCode).toBe(429);

    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/devices', headers: t.auth, cookies })).json().data;
    expect(list[0]).toMatchObject({ name: 'Front desk iPad', current: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/devices/${list[0].id}`, headers: t.auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/device', cookies })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-csrf': '1' }, cookies: { hp_rt_staff: r1.cookies.find((c) => c.name === 'hp_rt_staff')!.value } })).statusCode).toBe(401);
  });
});

describe('scan-to-clean', () => {
  it('starts, finishes and inspects the room’s task from its QR page, and reports faults', async () => {
    const t = await createTenant();
    const room = t.rooms[0]!;
    const hk = await addStaff(t, 'housekeeping');
    const url = `/api/v1/admin/housekeeping/rooms/${room.id}/scan`;
    const view = (await app.inject({ method: 'GET', url, headers: hk.auth })).json().data;
    expect(view).toMatchObject({ room: { number: room.number }, occupancy: 'vacant', task: null });
    expect((await app.inject({ method: 'POST', url, headers: hk.auth, payload: { action: 'done' } })).statusCode).toBe(409);

    await app.inject({ method: 'POST', url: '/api/v1/admin/housekeeping/tasks', headers: t.auth, payload: { roomId: room.id, kind: 'departure' } });
    const started = (await app.inject({ method: 'POST', url, headers: hk.auth, payload: { action: 'start' } })).json().data;
    expect(started.task).toMatchObject({ kind: 'departure', status: 'in_progress', assignedUserId: hk.user.id });
    const done = (await app.inject({ method: 'POST', url, headers: hk.auth, payload: { action: 'done' } })).json().data;
    expect(done.room.housekeepingStatus).toBe('clean');
    const inspected = (await app.inject({ method: 'POST', url, headers: t.auth, payload: { action: 'inspected' } })).json().data;
    expect(inspected.room.housekeepingStatus).toBe('inspected');
    expect(inspected.task).toBeNull();

    // No task today: Start creates a touch-up for the person who scanned.
    const touch = (await app.inject({ method: 'POST', url, headers: hk.auth, payload: { action: 'start' } })).json().data;
    expect(touch.task).toMatchObject({ kind: 'touch_up', status: 'in_progress' });

    const issue = await app.inject({ method: 'POST', url: `/api/v1/admin/housekeeping/rooms/${room.id}/issue`, headers: hk.auth, payload: { title: 'Shower mixer leaking', category: 'plumbing', blocksRoom: true } });
    expect(issue.statusCode).toBe(201);
    expect(issue.json().data.locationLabel).toBe(`Room ${room.number}`);
    const [r] = await asSystem((tx) => tx.select().from(rooms).where(eq(rooms.id, room.id)));
    expect(r!.status).toBe('out_of_service');

    const qr = (await app.inject({ method: 'GET', url: '/api/v1/admin/housekeeping/qr-codes', headers: hk.auth })).json().data;
    expect(qr).toHaveLength(t.rooms.length);
    expect(qr[0].qr).toContain('<svg');
    expect(qr[0].url).toMatch(/\/admin\/hk\/[0-9a-f-]{36}$/);
    const tasks = await asSystem((tx) => tx.select().from(housekeepingTasks).where(eq(housekeepingTasks.roomId, room.id)));
    expect(tasks).toHaveLength(2);
  });
});
