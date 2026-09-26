import { bookings, experienceBookings, experiences, experienceSlots, guests, properties, restaurantReservations, restaurants, tenants } from '@hp/db';
import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { asSystem, withTenant } from '../../infra/db.js';
import { addDays, formatDate, todayIn } from '../../lib/dates.js';
import { siteUrl } from '../../lib/site-url.js';
import { createOneTimeToken } from '../auth/service.js';
import { notify } from '../notifications/notify.js';

const fmt = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o }).format(d);

/**
 * Timely guest messages, idempotent via *_sent_at columns:
 * pre-arrival (day before, with online check-in), experience reminders (within 24 h),
 * same-day table reminders (within 3 h), and post-stay feedback requests.
 */
export async function sendReminders(now = new Date()) {
  const counts = { preArrival: 0, experiences: 0, tables: 0, feedback: 0 };
  const ts = await asSystem((tx) => tx.select({ id: tenants.id, slug: tenants.slug, timezone: tenants.timezone, name: tenants.name }).from(tenants).where(eq(tenants.status, 'active')));
  for (const t of ts) {
    await withTenant(t.id, async (tx) => {
      const base = await siteUrl(tx, t.id);
      const [prop] = await tx.select().from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      const propertyName = prop?.name ?? t.name;
      const tomorrow = addDays(todayIn(t.timezone, now), 1);
      const link = async (guestId: string, bookingId: string, path: string) => {
        const token = await createOneTimeToken(tx, { kind: 'guest_access', tenantId: t.id, guestId, bookingId, ttlMinutes: 60 * 72 });
        return `${base}/stay/access?token=${token}&next=${encodeURIComponent(path)}`;
      };

      // Pre-arrival: confirmed bookings arriving tomorrow.
      const arriving = await tx.select({ b: bookings, g: guests }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId))
        .where(and(eq(bookings.tenantId, t.id), eq(bookings.status, 'confirmed'), eq(bookings.checkIn, tomorrow), isNull(bookings.preArrivalSentAt), isNull(guests.anonymizedAt)));
      for (const { b, g } of arriving) {
        await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: g.id }, templateKey: 'booking.pre_arrival', channels: ['email', 'sms', 'in_app'],
          vars: { name: g.firstName, property: propertyName, checkIn: formatDate(b.checkIn), checkInTime: prop?.checkInTime.slice(0, 5), link: await link(g.id, b.id, `/stay/checkin/${b.id}`) }, related: { type: 'booking', id: b.id } });
        await tx.update(bookings).set({ preArrivalSentAt: now }).where(eq(bookings.id, b.id));
        counts.preArrival++;
      }

      // Experiences starting within 24 hours.
      const exps = await tx.select({ eb: experienceBookings, name: experiences.name, location: experiences.location, startsAt: experienceSlots.startsAt, g: guests })
        .from(experienceBookings).innerJoin(experiences, eq(experiences.id, experienceBookings.experienceId)).innerJoin(experienceSlots, eq(experienceSlots.id, experienceBookings.slotId)).innerJoin(guests, eq(guests.id, experienceBookings.guestId))
        .where(and(eq(experienceBookings.tenantId, t.id), eq(experienceBookings.status, 'confirmed'), isNull(experienceBookings.reminderSentAt), gte(experienceSlots.startsAt, now), lte(experienceSlots.startsAt, new Date(now.getTime() + 24 * 3_600_000))));
      for (const x of exps) {
        await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: x.g.id }, templateKey: 'experience.reminder', channels: ['email', 'in_app', 'push'],
          vars: { name: x.g.firstName, experience: x.name, time: fmt(x.startsAt, t.timezone, { hour: 'numeric', minute: '2-digit' }), when: fmt(x.startsAt, t.timezone, { weekday: 'long', day: 'numeric', month: 'short' }), participants: x.eb.participants, location: x.location ?? 'reception' },
          related: { type: 'experience_booking', id: x.eb.id } });
        await tx.update(experienceBookings).set({ reminderSentAt: now }).where(eq(experienceBookings.id, x.eb.id));
        counts.experiences++;
      }

      // Table bookings within the next 3 hours (guests we can reach).
      const tables = await tx.select({ r: restaurantReservations, rest: restaurants.name, g: guests }).from(restaurantReservations)
        .innerJoin(restaurants, eq(restaurants.id, restaurantReservations.restaurantId)).innerJoin(guests, eq(guests.id, restaurantReservations.guestId))
        .where(and(eq(restaurantReservations.tenantId, t.id), eq(restaurantReservations.status, 'confirmed'), isNull(restaurantReservations.reminderSentAt), isNotNull(restaurantReservations.guestId),
          gte(restaurantReservations.startsAt, new Date(now.getTime() + 30 * 60_000)), lte(restaurantReservations.startsAt, new Date(now.getTime() + 3 * 3_600_000))));
      for (const x of tables) {
        await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: x.g.id }, templateKey: 'restaurant.reservation_reminder', channels: ['email', 'in_app', 'push'],
          vars: { name: x.g.firstName, restaurant: x.rest, time: fmt(x.r.startsAt, t.timezone, { hour: 'numeric', minute: '2-digit' }), partySize: x.r.partySize, link: `${base}/stay/reserve` }, related: { type: 'restaurant_reservation', id: x.r.id } });
        await tx.update(restaurantReservations).set({ reminderSentAt: now }).where(eq(restaurantReservations.id, x.r.id));
        counts.tables++;
      }

      // Post-stay feedback: checked out in the last 3 days.
      const departed = await tx.select({ b: bookings, g: guests }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId))
        .where(and(eq(bookings.tenantId, t.id), eq(bookings.status, 'checked_out'), isNull(bookings.feedbackRequestedAt), isNull(guests.anonymizedAt),
          gte(bookings.checkOut, addDays(todayIn(t.timezone, now), -3)), sql`${bookings.updatedAt} < ${new Date(now.getTime() - 2 * 3_600_000)}`));
      for (const { b, g } of departed) {
        await notify(tx, { tenantId: t.id, recipient: { type: 'guest', id: g.id }, templateKey: 'stay.feedback_request', channels: ['email'],
          vars: { name: g.firstName, property: propertyName, link: await link(g.id, b.id, `/stay/feedback/${b.id}`) }, related: { type: 'booking', id: b.id } });
        await tx.update(bookings).set({ feedbackRequestedAt: now }).where(eq(bookings.id, b.id));
        counts.feedback++;
      }
    });
  }
  return counts;
}
