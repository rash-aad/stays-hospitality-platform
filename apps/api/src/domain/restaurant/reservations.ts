import { diningAreas, guests, restaurantHours, restaurantReservations, restaurants, restaurantSpecialHours, restaurantTables, RESERVATION_STATUSES } from '@hp/db';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { addDays, todayIn, zonedTime } from '../../lib/dates.js';
import { reference } from '../../lib/ids.js';
import { notify } from '../notifications/notify.js';

type Restaurant = typeof restaurants.$inferSelect;
type Reservation = typeof restaurantReservations.$inferSelect;
type Status = (typeof RESERVATION_STATUSES)[number];
const ACTIVE: Status[] = ['confirmed', 'seated'];

/** Opening windows for a date (special hours override the weekly schedule; closed → none). */
export async function serviceWindows(tx: Tx, r: Restaurant, date: string, timezone: string) {
  const [special] = await tx.select().from(restaurantSpecialHours).where(and(eq(restaurantSpecialHours.restaurantId, r.id), eq(restaurantSpecialHours.date, date)));
  if (special?.closed) return { closedNote: special.note ?? 'Closed', windows: [] as { service: string; start: Date; end: Date }[] };
  if (special?.opens && special.closes) {
    return { closedNote: null, windows: [{ service: special.note ?? 'Special hours', start: zonedTime(date, special.opens, timezone), end: zonedTime(date, special.closes, timezone) }] };
  }
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const hours = await tx.select().from(restaurantHours).where(and(eq(restaurantHours.restaurantId, r.id), eq(restaurantHours.dayOfWeek, dow))).orderBy(asc(restaurantHours.opens));
  return {
    closedNote: hours.length ? null : 'Closed',
    windows: hours.map((h) => {
      const start = zonedTime(date, h.opens, timezone);
      let end = zonedTime(date, h.closes, timezone);
      if (end <= start) end = new Date(end.getTime() + 86_400_000); // past midnight
      return { service: h.service, start, end };
    }),
  };
}

async function busyTables(tx: Tx, restaurantId: string, start: Date, end: Date, excludeId?: string) {
  const rows = await tx
    .select({ tableId: restaurantReservations.tableId, partySize: restaurantReservations.partySize, startsAt: restaurantReservations.startsAt })
    .from(restaurantReservations)
    .where(and(
      eq(restaurantReservations.restaurantId, restaurantId), inArray(restaurantReservations.status, ACTIVE),
      lt(restaurantReservations.startsAt, end), gt(restaurantReservations.endsAt, start),
      excludeId ? ne(restaurantReservations.id, excludeId) : undefined,
    ));
  return rows;
}

/** Smallest free table that fits the party, preferring the requested area. */
export async function pickTable(tx: Tx, r: Restaurant, partySize: number, start: Date, end: Date, opts: { areaId?: string | null; excludeReservationId?: string } = {}) {
  const tables = await tx.select().from(restaurantTables).where(and(eq(restaurantTables.restaurantId, r.id), ne(restaurantTables.status, 'out_of_service')));
  const busy = new Set((await busyTables(tx, r.id, start, end, opts.excludeReservationId)).map((b) => b.tableId));
  const fits = tables
    .filter((t) => !busy.has(t.id) && t.capacity >= partySize && t.minCapacity <= partySize)
    .sort((a, b) => Number(b.diningAreaId === opts.areaId) - Number(a.diningAreaId === opts.areaId) || a.capacity - b.capacity || a.sort - b.sort);
  return fits[0] ?? null;
}

export async function slotsFor(tx: Tx, tenant: TenantInfo, r: Restaurant, date: string, partySize: number, now = new Date()) {
  const s = r.settings;
  const today = todayIn(tenant.timezone, now);
  if (date < today || date > addDays(today, s.reservationWindowDays)) return { date, closedNote: 'Outside the booking window', slots: [] };
  const { closedNote, windows } = await serviceWindows(tx, r, date, tenant.timezone);
  const slots: { time: string; startsAt: string; service: string; available: boolean }[] = [];
  const earliest = now.getTime() + s.minLeadMinutes * 60_000;
  for (const w of windows) {
    // Last seating leaves time for one slot before close.
    for (let t = w.start.getTime(); t <= w.end.getTime() - s.slotMinutes * 60_000; t += s.slotMinutes * 60_000) {
      const start = new Date(t);
      const end = new Date(t + s.defaultDurationMinutes * 60_000);
      let available = t >= earliest && partySize <= s.maxPartySize;
      if (available) available = !!(await pickTable(tx, r, partySize, start, end));
      if (available && s.maxCoversPerSlot) {
        const covers = (await busyTables(tx, r.id, start, new Date(t + s.slotMinutes * 60_000))).filter((b) => b.startsAt.getTime() === t).reduce((n, b) => n + b.partySize, 0);
        available = covers + partySize <= s.maxCoversPerSlot;
      }
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, hour: '2-digit', minute: '2-digit' }).format(start);
      slots.push({ time, startsAt: start.toISOString(), service: w.service, available });
    }
  }
  return { date, closedNote, slots };
}

export type ReservationInput = {
  restaurantId: string;
  startsAt: Date;
  partySize: number;
  guestName: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  guestId?: string | null;
  stayId?: string | null;
  areaPreferenceId?: string | null;
  seatingPreference?: string | null;
  occasion?: string | null;
  specialRequests?: string | null;
  joinWaitlist?: boolean;
  tableId?: string | null;
  source: Reservation['source'];
  createdByUserId?: string | null;
};

export async function createReservation(tx: Tx, tenant: TenantInfo, input: ReservationInput) {
  // Serialise reservation writes per restaurant so allocation is race-free (the exclusion constraint is the backstop).
  const [r] = await tx.select().from(restaurants).where(and(eq(restaurants.id, input.restaurantId), eq(restaurants.tenantId, tenant.id), eq(restaurants.active, true))).for('update');
  if (!r || !r.acceptsReservations) throw notFound('Restaurant');
  const s = r.settings;
  const staff = !!input.createdByUserId;
  if (input.partySize > s.maxPartySize && !staff) throw badRequest(`For parties larger than ${s.maxPartySize}, please contact the restaurant`);
  const start = input.startsAt;
  const end = new Date(start.getTime() + s.defaultDurationMinutes * 60_000);
  if (!staff) {
    if (start.getTime() < Date.now() + s.minLeadMinutes * 60_000) throw badRequest(`Reservations need at least ${s.minLeadMinutes} minutes' notice`);
    const date = todayIn(tenant.timezone, start);
    if (date > addDays(todayIn(tenant.timezone), s.reservationWindowDays)) throw badRequest(`Reservations open ${s.reservationWindowDays} days ahead`);
    const { windows } = await serviceWindows(tx, r, date, tenant.timezone);
    if (!windows.some((w) => start >= w.start && start.getTime() <= w.end.getTime() - s.slotMinutes * 60_000)) throw badRequest('The restaurant is not taking reservations at that time');
  }
  if (input.areaPreferenceId) {
    const [a] = await tx.select().from(diningAreas).where(and(eq(diningAreas.id, input.areaPreferenceId), eq(diningAreas.restaurantId, r.id)));
    if (!a) throw badRequest('Unknown dining area');
  }
  let table = null;
  if (input.tableId) {
    if (!staff) throw badRequest('Tables are assigned by the restaurant');
    const [t] = await tx.select().from(restaurantTables).where(and(eq(restaurantTables.id, input.tableId), eq(restaurantTables.restaurantId, r.id)));
    if (!t) throw badRequest('Unknown table');
    const clash = (await busyTables(tx, r.id, start, end)).some((b) => b.tableId === t.id);
    if (clash) throw conflict(`Table ${t.label} is already booked at that time`);
    table = t;
  } else {
    table = await pickTable(tx, r, input.partySize, start, end, { areaId: input.areaPreferenceId });
  }
  if (!table && !input.joinWaitlist) {
    const alternatives = (await slotsFor(tx, tenant, r, todayIn(tenant.timezone, start), input.partySize)).slots.filter((x) => x.available).slice(0, 6);
    throw conflict('No table is free at that time', { alternatives });
  }
  const status: Status = table ? (s.autoConfirm || staff ? 'confirmed' : 'requested') : 'waitlisted';
  const [row] = await tx.insert(restaurantReservations).values({
    tenantId: tenant.id, restaurantId: r.id, guestId: input.guestId ?? null, stayId: input.stayId ?? null, reference: reference('RS'),
    guestName: input.guestName, guestEmail: input.guestEmail, guestPhone: input.guestPhone, partySize: input.partySize, startsAt: start, endsAt: end,
    tableId: status === 'confirmed' ? table!.id : null, areaPreferenceId: input.areaPreferenceId, seatingPreference: input.seatingPreference, occasion: input.occasion,
    status, specialRequests: input.specialRequests, source: input.source, createdByUserId: input.createdByUserId ?? null,
  }).returning();
  await notifyReservation(tx, tenant, r, row!, status === 'waitlisted' ? 'restaurant.reservation_waitlisted' : 'restaurant.reservation_confirmed');
  return row!;
}

async function notifyReservation(tx: Tx, tenant: TenantInfo, r: Restaurant, res: Reservation, key: string) {
  if (!res.guestId) return;
  const [g] = await tx.select().from(guests).where(eq(guests.id, res.guestId));
  const when = new Intl.DateTimeFormat('en-IN', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(res.startsAt);
  await notify(tx, { tenantId: tenant.id, recipient: { type: 'guest', id: res.guestId }, templateKey: key, vars: { name: g?.firstName, restaurant: r.name, partySize: res.partySize, when, reference: res.reference }, related: { type: 'restaurant_reservation', id: res.id } });
}

const TRANSITIONS: Record<Status, Status[]> = {
  waitlisted: ['confirmed', 'cancelled'],
  requested: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function transitionReservation(tx: Tx, tenant: TenantInfo, id: string, to: Status, opts: { tableId?: string | null; guestId?: string } = {}) {
  const [res] = await tx.select().from(restaurantReservations).where(and(eq(restaurantReservations.id, id), eq(restaurantReservations.tenantId, tenant.id))).for('update');
  if (!res || (opts.guestId && res.guestId !== opts.guestId)) throw notFound('Reservation');
  if (!TRANSITIONS[res.status].includes(to)) throw conflict(`Cannot move a ${res.status} reservation to ${to}`);
  if (opts.guestId && to !== 'cancelled') throw badRequest('Guests can only cancel');
  const [r] = await tx.select().from(restaurants).where(eq(restaurants.id, res.restaurantId)).for('update');
  let tableId = res.tableId;
  if (to === 'confirmed' && !tableId) {
    const t = opts.tableId
      ? (await tx.select().from(restaurantTables).where(and(eq(restaurantTables.id, opts.tableId), eq(restaurantTables.restaurantId, r!.id))))[0]
      : await pickTable(tx, r!, res.partySize, res.startsAt, res.endsAt, { areaId: res.areaPreferenceId, excludeReservationId: res.id });
    if (!t) throw conflict('No table is free for this party at that time');
    tableId = t.id;
  }
  const [updated] = await tx.update(restaurantReservations).set({ status: to, tableId }).where(eq(restaurantReservations.id, res.id)).returning();
  if (to === 'confirmed' && res.status === 'waitlisted') await notifyReservation(tx, tenant, r!, updated!, 'restaurant.reservation_confirmed');
  if (to === 'cancelled') await notifyReservation(tx, tenant, r!, updated!, 'restaurant.reservation_cancelled');
  return updated!;
}

/** Staff edit of time, party size or table, re-checking conflicts. */
export async function updateReservation(tx: Tx, tenant: TenantInfo, id: string, patch: { startsAt?: Date; partySize?: number; tableId?: string | null; internalNotes?: string | null; specialRequests?: string | null }) {
  const [res] = await tx.select().from(restaurantReservations).where(and(eq(restaurantReservations.id, id), eq(restaurantReservations.tenantId, tenant.id))).for('update');
  if (!res) throw notFound('Reservation');
  const [r] = await tx.select().from(restaurants).where(eq(restaurants.id, res.restaurantId)).for('update');
  const start = patch.startsAt ?? res.startsAt;
  const end = new Date(start.getTime() + r!.settings.defaultDurationMinutes * 60_000);
  const party = patch.partySize ?? res.partySize;
  let tableId = patch.tableId !== undefined ? patch.tableId : res.tableId;
  if (ACTIVE.includes(res.status)) {
    if (tableId) {
      const [t] = await tx.select().from(restaurantTables).where(and(eq(restaurantTables.id, tableId), eq(restaurantTables.restaurantId, r!.id)));
      if (!t) throw badRequest('Unknown table');
      if ((await busyTables(tx, r!.id, start, end, res.id)).some((b) => b.tableId === tableId)) throw conflict(`Table ${t.label} is already booked at that time`);
    } else {
      const t = await pickTable(tx, r!, party, start, end, { areaId: res.areaPreferenceId, excludeReservationId: res.id });
      if (!t) throw conflict('No table is free for this party at that time');
      tableId = t.id;
    }
  }
  const [u] = await tx.update(restaurantReservations).set({ startsAt: start, endsAt: end, partySize: party, tableId, internalNotes: patch.internalNotes, specialRequests: patch.specialRequests }).where(eq(restaurantReservations.id, res.id)).returning();
  return u!;
}
