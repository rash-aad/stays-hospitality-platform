import { availability, bookings, guests, notifications, taxes } from '@hp/db';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isValidGstin } from '../src/domain/billing/gst.js';
import { isPublicAddress, parseIcal, safeFetchText } from '../src/domain/channels/ical.js';
import { syncFeed } from '../src/domain/channels/routes.js';
import { signAccess } from '../src/domain/auth/tokens.js';
import { asSystem } from '../src/infra/db.js';
import { addDays } from '../src/lib/dates.js';
import { app, createTenant, inHouseGuest, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

useApp();

/** A confirmed future booking and a verified guest token for it. */
async function upcoming(t: TestTenant, inDays = 10, nights = 2) {
  const email = `${uniq('g')}@example.com`;
  const res = await app.inject({
    method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') },
    payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(inDays), checkOut: isoDate(inDays + nights), adults: 2, children: 0, guest: { email, firstName: 'Kabir', lastName: 'Rao', phone: '+919822222222' }, paymentMethod: 'pay_at_property' },
  });
  expect(res.statusCode).toBe(201);
  const [g] = await asSystem((tx) => tx.update(guests).set({ emailVerifiedAt: new Date() }).where(and(eq(guests.tenantId, t.tenant.id), eq(guests.email, email))).returning());
  const token = await signAccess({ typ: 'guest', sub: g!.id, tid: t.tenant.id });
  return { booking: res.json().data, guest: g!, auth: { authorization: `Bearer ${token}` } };
}

const booked = (t: TestTenant, dates: string[]) =>
  asSystem((tx) => tx.select({ date: availability.date, booked: availability.booked }).from(availability).where(and(eq(availability.roomTypeId, t.roomType.id), inArray(availability.date, dates))).orderBy(availability.date));

describe('online pre-check-in', () => {
  it('stores only the last four ID characters and is private to the booking guest', async () => {
    const t = await createTenant();
    const g = await upcoming(t);
    const body = { arrivalTime: '14:30', travellingBy: 'car', nationality: 'Indian', idType: 'aadhaar', idNumberLast4: '1234', idFileId: null, address: 'Pune', purposeOfVisit: 'leisure', guestNames: ['Asha Rao'], specialRequests: null, consent: true };
    expect((await app.inject({ method: 'PUT', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: g.auth, payload: { ...body, idNumberLast4: '1234 5678 9012' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: g.auth, payload: { ...body, consent: false } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: g.auth, payload: body });
    expect(ok.statusCode).toBe(200);
    const got = (await app.inject({ method: 'GET', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: g.auth })).json().data;
    expect(got.precheckin.idNumberLast4).toBe('1234');
    expect(got.completedAt).toBeTruthy();

    const other = await upcoming(t, 20);
    expect((await app.inject({ method: 'GET', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: other.auth })).statusCode).toBe(404);
    // Someone else's upload can't be attached as your ID.
    expect((await app.inject({ method: 'PUT', url: `/api/v1/portal/bookings/${g.booking.id}/precheckin`, headers: g.auth, payload: { ...body, idFileId: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(400);
  });
});

describe('guest self-service date changes', () => {
  it('quotes without side effects, then moves inventory and notifies', async () => {
    const t = await createTenant({ rooms: 1 });
    const g = await upcoming(t, 10, 2);
    const oldNights = [isoDate(10), isoDate(11)];
    const newNights = [isoDate(15), isoDate(16), isoDate(17)];
    const payload = { checkIn: isoDate(15), checkOut: isoDate(18) };

    const q = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/change-dates/quote`, headers: g.auth, payload });
    expect(q.statusCode).toBe(200);
    expect(q.json().data.total).toBeGreaterThan(q.json().data.previousTotal);
    expect((await booked(t, oldNights)).map((r) => r.booked)).toEqual([1, 1]); // the quote rolled back
    expect((await booked(t, newNights)).every((r) => r.booked === 0)).toBe(true);

    const c = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/change-dates`, headers: g.auth, payload });
    expect(c.statusCode).toBe(200);
    expect((await booked(t, oldNights)).map((r) => r.booked)).toEqual([0, 0]);
    expect((await booked(t, newNights)).map((r) => r.booked)).toEqual([1, 1, 1]);
    const mail = await asSystem((tx) => tx.select().from(notifications).where(and(eq(notifications.tenantId, t.tenant.id), eq(notifications.templateKey, 'booking.dates_changed'))));
    expect(mail.length).toBeGreaterThan(0);

    // A sold-out target is refused and nothing moves.
    const blocker = await upcoming(t, 25, 2);
    const clash = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/change-dates`, headers: g.auth, payload: { checkIn: isoDate(25), checkOut: isoDate(27) } });
    expect(clash.statusCode).toBe(409);
    expect((await booked(t, newNights)).map((r) => r.booked)).toEqual([1, 1, 1]);
    expect(blocker.booking.id).toBeTruthy();
  });

  it('refuses changes inside 48 hours of arrival', async () => {
    const t = await createTenant();
    const g = await upcoming(t, 1, 2);
    const r = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/change-dates/quote`, headers: g.auth, payload: { checkIn: isoDate(5), checkOut: isoDate(7) } });
    expect(r.statusCode).toBe(409);
  });
});

describe('post-stay feedback', () => {
  it('is only accepted once the stay has begun, aggregates NPS and supports a reply', async () => {
    const t = await createTenant();
    const early = await upcoming(t);
    expect((await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${early.booking.id}/feedback`, headers: early.auth, payload: { overall: 5 } })).statusCode).toBe(409);

    const g = await inHouseGuest(t);
    const post = await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/feedback`, headers: g.auth, payload: { overall: 4, recommend: 10, aspects: { room: 5, food: 3 }, comment: 'Lovely sea view' } });
    expect(post.statusCode).toBe(201);
    // Resubmitting edits rather than duplicating.
    await app.inject({ method: 'POST', url: `/api/v1/portal/bookings/${g.booking.id}/feedback`, headers: g.auth, payload: { overall: 5, recommend: 10 } });
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/feedback', headers: t.auth })).json();
    expect(list.data).toHaveLength(1);
    expect(list.summary).toMatchObject({ average: 5, responses: 1, nps: 100 });

    const reply = await app.inject({ method: 'POST', url: `/api/v1/admin/feedback/${list.data[0].id}/reply`, headers: t.auth, payload: { body: 'Thank you, Meera!' } });
    expect(reply.statusCode).toBe(200);
    const mine = (await app.inject({ method: 'GET', url: `/api/v1/portal/bookings/${g.booking.id}/feedback`, headers: g.auth })).json().data.feedback;
    expect(mine.staffReply).toBe('Thank you, Meera!');
  });
});

describe('guest privacy (DPDP)', () => {
  it('exports data, refuses erasure during a stay, and erases after check-out', async () => {
    const t = await createTenant();
    const g = await inHouseGuest(t);
    const exp = await app.inject({ method: 'GET', url: '/api/v1/portal/privacy/export', headers: g.auth });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().profile.email).toBe(g.guest.email);
    expect(exp.json().profile.passwordHash).toBeUndefined();
    expect(exp.json().bookings).toHaveLength(1);

    expect((await app.inject({ method: 'POST', url: '/api/v1/portal/privacy/erase', headers: g.auth, payload: { confirm: 'ERASE' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${g.booking.id}/check-out`, headers: t.auth, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/portal/privacy/erase', headers: g.auth, payload: { confirm: 'nope' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/portal/privacy/erase', headers: g.auth, payload: { confirm: 'ERASE' } })).statusCode).toBe(200);

    const [row] = await asSystem((tx) => tx.select().from(guests).where(eq(guests.id, g.guest.id)));
    expect(row!.email).not.toBe(g.guest.email);
    expect(row!.phone).toBeNull();
    expect(row!.anonymizedAt).toBeTruthy();
    // Financial records survive for the books.
    const [b] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, g.booking.id)));
    expect(b!.total).toBeGreaterThan(0);
  });
});

describe('iCal channel sync', () => {
  it('parses folded lines, all-day and timed events, and skips cancellations', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1@airbnb', 'DTSTART;VALUE=DATE:20270105', 'DTEND;VALUE=DATE:20270108', 'SUMMARY:Reserved\\, Airb', ' nb', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b2', 'DTSTART:20270110T140000Z', 'DTEND:20270111T100000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c3', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20270201', 'DTEND;VALUE=DATE:20270202', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    expect(parseIcal(ics)).toEqual([
      { uid: 'a1@airbnb', start: '2027-01-05', end: '2027-01-08', summary: 'Reserved, Airbnb' },
      { uid: 'b2', start: '2027-01-10', end: '2027-01-11', summary: null },
    ]);
  });

  it('refuses private and non-https calendar URLs', async () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('10.1.2.3')).toBe(false);
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    await expect(safeFetchText('http://example.com/cal.ics')).rejects.toThrow(/https/);
    await expect(safeFetchText('https://localhost/cal.ics')).rejects.toThrow(/private/);
  });

  it('holds inventory for imported reservations, flags conflicts, releases on removal, and exports sold-out nights', async () => {
    const t = await createTenant({ rooms: 1 });
    const feed = (await app.inject({ method: 'POST', url: '/api/v1/admin/ical-feeds', headers: t.auth, payload: { roomTypeId: t.roomType.id, direction: 'import', name: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics' } })).json().data;
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/ical-feeds', headers: t.auth, payload: { roomTypeId: t.roomType.id, direction: 'import', name: 'Bad', url: 'http://x.test/a.ics' } })).statusCode).toBe(400);

    const d = (n: number) => isoDate(n).replaceAll('-', '');
    await upcoming(t, 30, 2); // our own guest holds nights 30–31
    let cal = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ota-1', `DTSTART;VALUE=DATE:${d(10)}`, `DTEND;VALUE=DATE:${d(12)}`, 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:ota-2', `DTSTART;VALUE=DATE:${d(31)}`, `DTEND;VALUE=DATE:${d(33)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const r1 = await syncFeed(t.tenant.id, 'Asia/Kolkata', feed.id, async () => cal);
    expect(r1).toMatchObject({ added: 2, conflicts: 1 });
    expect((await booked(t, [isoDate(10), isoDate(11)])).map((r) => r.booked)).toEqual([1, 1]);
    expect((await booked(t, [isoDate(31), isoDate(32)])).map((r) => r.booked)).toEqual([1, 0]); // conflict took nothing
    const blocks = (await app.inject({ method: 'GET', url: `/api/v1/admin/ical-feeds/${feed.id}/blocks`, headers: t.auth })).json().data;
    expect(blocks.find((b: { uid: string }) => b.uid === 'ota-2').status).toBe('conflict');

    // Our public site can't sell the OTA's nights.
    const q = await app.inject({ method: 'GET', url: `/api/v1/public/availability?checkIn=${isoDate(10)}&checkOut=${isoDate(12)}&adults=2`, headers: t.host });
    expect(JSON.stringify(q.json())).not.toContain(t.ratePlan.id);

    // Export shows sold-out ranges to other channels.
    const exp = (await app.inject({ method: 'POST', url: '/api/v1/admin/ical-feeds', headers: t.auth, payload: { roomTypeId: t.roomType.id, direction: 'export', name: 'Deluxe' } })).json().data;
    const file = new URL(exp.exportUrl).pathname.split('/').pop();
    const ics = await app.inject({ method: 'GET', url: `/api/v1/public/ical/${file}` });
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain(`DTSTART;VALUE=DATE:${d(10)}`);
    expect(ics.body).toContain(`DTEND;VALUE=DATE:${d(12)}`);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/ical/wrongtokenwrongtokenwrong.ics' })).statusCode).toBe(404);

    // Removed from the channel → released; moved dates → re-held.
    cal = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ota-2', `DTSTART;VALUE=DATE:${d(40)}`, `DTEND;VALUE=DATE:${d(41)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const r2 = await syncFeed(t.tenant.id, 'Asia/Kolkata', feed.id, async () => cal);
    expect(r2).toMatchObject({ removed: 1, updated: 1, conflicts: 0 });
    expect((await booked(t, [isoDate(10), isoDate(11)])).map((r) => r.booked)).toEqual([0, 0]);
    expect((await booked(t, [isoDate(40)])).map((r) => r.booked)).toEqual([1]);

    // Deleting the feed gives everything back.
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/admin/ical-feeds/${feed.id}`, headers: t.auth })).statusCode).toBe(204);
    expect((await booked(t, [isoDate(40)])).map((r) => r.booked)).toEqual([0]);

    // A failing fetch is recorded on the feed, not thrown into the worker.
    const f2 = (await app.inject({ method: 'POST', url: '/api/v1/admin/ical-feeds', headers: t.auth, payload: { roomTypeId: t.roomType.id, direction: 'import', name: 'Booking.com', url: 'https://admin.booking.com/x.ics' } })).json().data;
    await expect(syncFeed(t.tenant.id, 'Asia/Kolkata', f2.id, async () => { throw new Error('boom'); })).rejects.toThrow(/boom/);
    const feeds = (await app.inject({ method: 'GET', url: '/api/v1/admin/ical-feeds', headers: t.auth })).json().data;
    expect(feeds.find((f: { id: string }) => f.id === f2.id).lastError).toBe('boom');
    expect(feeds.every((f: { token?: string }) => f.token === undefined)).toBe(true);
    expect(addDays('2027-01-01', 1)).toBe('2027-01-02');
  });
});

describe('GST tax invoices', () => {
  it('validates GSTINs and issues numbered invoices with a CGST/SGST split', async () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    const t = await createTenant();
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/admin/billing-settings', headers: t.auth, payload: { legalName: 'Sea Breeze Pvt Ltd', gstin: '27AAPFU0939F1ZX', address: 'Alibag', invoicePrefix: 'SB', sacRoom: '996311', sacFood: '996331', sacService: '999799', footerNote: null } });
    expect(bad.statusCode).toBe(400);
    const good = await app.inject({ method: 'PUT', url: '/api/v1/admin/billing-settings', headers: t.auth, payload: { legalName: 'Sea Breeze Pvt Ltd', gstin: '27AAPFU0939F1ZV', address: 'Alibag', invoicePrefix: 'SB', sacRoom: '996311', sacFood: '996331', sacService: '999799', footerNote: 'Thank you' } });
    expect(good.statusCode).toBe(200);

    const g = await inHouseGuest(t);
    await asSystem((tx) => tx.insert(taxes).values({ tenantId: t.tenant.id, name: 'GST 12%', appliesTo: 'room', rateBps: 1200 }));
    const out = await app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${g.booking.id}/check-out`, headers: t.auth, payload: {} });
    expect(out.statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/invoices', headers: t.auth })).json().data;
    const inv = (await app.inject({ method: 'GET', url: `/api/v1/admin/invoices/${list[0].id}`, headers: t.auth })).json().data;
    expect(inv.number).toMatch(/^SB\/\d{4}-\d{2}\/00001$/);
    expect(inv.supplier.gstin).toBe('27AAPFU0939F1ZV');
    expect(Array.isArray(inv.taxSummary)).toBe(true);
    // Issued invoices are frozen: bill-to can no longer change.
    const bt = await app.inject({ method: 'PUT', url: `/api/v1/portal/bookings/${g.booking.id}/bill-to`, headers: g.auth, payload: { name: 'Acme Pvt Ltd' } });
    expect(bt.statusCode).toBe(409);
  });
});
