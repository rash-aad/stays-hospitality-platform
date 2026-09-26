import { availability, bookingItems, bookings, housekeepingTasks, ratePlans, rooms, roomTypes } from '@hp/db';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asSystem } from '../src/infra/db.js';
import { app, createTenant, inHouseGuest, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

useApp();

async function book(t: TestTenant, inDays: number, nights: number) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') },
    payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(inDays), checkOut: isoDate(inDays + nights), adults: 2, children: 0, guest: { email: `${uniq('g')}@example.com`, firstName: 'Tape', lastName: 'Chart', phone: '+919800000000' }, paymentMethod: 'pay_at_property' },
  });
  expect(r.statusCode).toBe(201);
  return r.json().data as { id: string; total: number };
}

/** A second, pricier room type ("Suite") with one room and a BAR plan. */
async function addSuite(t: TestTenant) {
  return asSystem(async (tx) => {
    const [rt] = await tx.insert(roomTypes).values({ tenantId: t.tenant.id, propertyId: t.property.id, name: 'Suite', slug: 'suite', baseOccupancy: 2, maxOccupancy: 3, maxAdults: 3, maxChildren: 1 }).returning();
    const [room] = await tx.insert(rooms).values({ tenantId: t.tenant.id, propertyId: t.property.id, roomTypeId: rt!.id, number: '501' }).returning();
    await tx.insert(ratePlans).values({ tenantId: t.tenant.id, roomTypeId: rt!.id, name: 'Best available', code: 'BAR', basePrice: 1500000 });
    return { roomType: rt!, room: room! };
  });
}

const booked = (roomTypeId: string, dates: string[]) =>
  asSystem((tx) => tx.select({ date: availability.date, booked: availability.booked }).from(availability).where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates))).orderBy(availability.date)).then((r) => r.map((x) => x.booked));

describe('tape chart', () => {
  it('shows rooms, bars and availability for the window', async () => {
    const t = await createTenant({ rooms: 2 });
    const b = await book(t, 3, 2);
    const chart = (await app.inject({ method: 'GET', url: `/api/v1/admin/tape-chart?from=${isoDate(0)}&days=14`, headers: t.auth })).json().data;
    expect(chart.days).toHaveLength(14);
    expect(chart.roomTypes[0].rooms).toHaveLength(2);
    const bar = chart.bars.find((x: { bookingId: string }) => x.bookingId === b.id);
    expect(bar).toMatchObject({ checkIn: isoDate(3), checkOut: isoDate(5), roomId: null, guestName: 'Tape Chart' });
    expect(chart.roomTypes[0].availability[isoDate(3)].left).toBe(1);
  });

  it('assigns rooms, refuses double-assignment, shifts dates with a re-quote, and upgrades at the same rate', async () => {
    const t = await createTenant({ rooms: 2 });
    const [r1, r2] = t.rooms;
    const a = await book(t, 5, 2);
    const b = await book(t, 6, 2);
    const move = (id: string, body: object) => app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${id}/move`, headers: t.auth, payload: body });
    expect((await move(a.id, { roomId: r1!.id })).statusCode).toBe(200);
    expect((await move(b.id, { roomId: r1!.id })).statusCode).toBe(409); // overlaps night 6
    expect((await move(b.id, { roomId: r2!.id })).statusCode).toBe(200);

    // Drag A two days later: inventory follows and the price is re-quoted.
    const shifted = await move(a.id, { checkIn: isoDate(10), checkOut: isoDate(12), roomId: r1!.id });
    expect(shifted.statusCode).toBe(200);
    expect(await booked(t.roomType.id, [isoDate(5), isoDate(10), isoDate(11)])).toEqual([0, 1, 1]);

    // Free upgrade to the suite: suite inventory taken, price unchanged.
    const suite = await addSuite(t);
    const before = shifted.json().data.total;
    const up = await move(a.id, { roomId: suite.room.id, pricing: 'keep' });
    expect(up.statusCode).toBe(200);
    expect(up.json().data.total).toBe(before);
    expect(await booked(suite.roomType.id, [isoDate(10), isoDate(11)])).toEqual([1, 1]);
    expect(await booked(t.roomType.id, [isoDate(10), isoDate(11)])).toEqual([0, 0]);
    // Moving B to the suite at the suite's rate re-prices it.
    const paid = await move(b.id, { roomId: suite.room.id, pricing: 'reprice' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().data.total).toBeGreaterThan(b.total);
  });

  it('moves an in-house guest to another room and extends or shortens the stay', async () => {
    const t = await createTenant({ rooms: 3 });
    const g = await inHouseGuest(t); // today → +2, checked in
    const [bk] = await asSystem((tx) => tx.select().from(bookings).where(eq(bookings.id, g.booking.id)));
    const [item] = await asSystem((tx) => tx.select().from(bookingItems).where(eq(bookingItems.bookingId, bk!.id)));
    const oldRoom = item!.roomId!;
    const other = t.rooms.find((r) => r.id !== oldRoom)!;
    const move = (body: object) => app.inject({ method: 'POST', url: `/api/v1/admin/bookings/${bk!.id}/move`, headers: t.auth, payload: body });

    expect((await move({ checkIn: isoDate(1) })).statusCode).toBe(409);
    const moved = await move({ roomId: other.id });
    expect(moved.statusCode).toBe(200);
    const [old] = await asSystem((tx) => tx.select().from(rooms).where(eq(rooms.id, oldRoom)));
    expect(old!.housekeepingStatus).toBe('dirty');
    const tasks = await asSystem((tx) => tx.select().from(housekeepingTasks).where(eq(housekeepingTasks.roomId, oldRoom)));
    expect(tasks.some((x) => x.notes?.includes('Room move'))).toBe(true);

    const ext = await move({ checkOut: isoDate(4) });
    expect(ext.statusCode).toBe(200);
    expect(ext.json().data.total).toBeGreaterThan(bk!.total);
    expect(await booked(t.roomType.id, [isoDate(2), isoDate(3)])).toEqual([1, 1]);
    const back = await move({ checkOut: isoDate(2) });
    expect(back.json().data.total).toBe(bk!.total);
    expect(await booked(t.roomType.id, [isoDate(2), isoDate(3)])).toEqual([0, 0]);
    expect((await move({ checkOut: isoDate(0) })).statusCode).toBe(400); // can't end before it began
  });
});
