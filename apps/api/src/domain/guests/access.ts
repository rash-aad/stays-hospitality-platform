import { bookings, guests, properties, rooms, stays } from '@hp/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { createOneTimeToken } from '../auth/service.js';
import { notify } from '../notifications/notify.js';
import { siteUrl } from '../../lib/site-url.js';

export async function sendGuestAccessLink(
  tx: Tx,
  input: { tenant: TenantInfo; email: string; reference: string; webUrl: string },
) {
  const [row] = await tx
    .select({ booking: bookings, guest: guests })
    .from(bookings)
    .innerJoin(guests, eq(guests.id, bookings.guestId))
    .where(and(
      eq(bookings.tenantId, input.tenant.id),
      eq(sql`upper(${bookings.reference})`, input.reference.trim().toUpperCase()),
      eq(sql`lower(${guests.email})`, input.email.trim().toLowerCase()),
    ));
  if (!row || ['cancelled', 'expired'].includes(row.booking.status)) return;
  await issueAccessLink(tx, input.tenant, row.guest, row.booking, input.webUrl);
}

export async function issueAccessLink(
  tx: Tx,
  tenant: Pick<TenantInfo, 'id' | 'slug' | 'name'>,
  guest: { id: string; firstName: string },
  booking: { id: string; reference: string },
  _webUrl: string,
) {
  const token = await createOneTimeToken(tx, { kind: 'guest_access', tenantId: tenant.id, guestId: guest.id, bookingId: booking.id, ttlMinutes: 60 * 24 });
  const base = await siteUrl(tx, tenant.id);
  const [prop] = await tx.select({ name: properties.name }).from(properties).limit(1);
  await notify(tx, {
    tenantId: tenant.id, recipient: { type: 'guest', id: guest.id }, templateKey: 'guest.access_link', channels: ['email'],
    vars: { name: guest.firstName, property: prop?.name ?? tenant.name, reference: booking.reference, link: `${base}/stay/access?token=${token}` },
  });
  return token;
}

export type StayContext = {
  guest: typeof guests.$inferSelect;
  verified: boolean;
  /** The stay the guest is currently in (checked in), or the next upcoming one. */
  stay: null | {
    id: string; status: string; bookingId: string; reference: string; checkIn: string; checkOut: string;
    roomId: string | null; roomNumber: string | null; propertyId: string; inHouse: boolean;
  };
};

/**
 * Server-side stay resolution. The room a guest may order to or request service in is derived from
 * their verified booking — never taken from the client.
 */
export async function resolveStayContext(tx: Tx, tenantId: string, guestId: string): Promise<StayContext> {
  const [guest] = await tx.select().from(guests).where(and(eq(guests.id, guestId), eq(guests.tenantId, tenantId)));
  if (!guest) throw new AppError(401, 'unauthorized', 'Guest not found');
  const verified = !!guest.emailVerifiedAt;
  if (!verified) return { guest, verified, stay: null };
  const rows = await tx
    .select({
      id: stays.id, status: stays.status, bookingId: bookings.id, reference: bookings.reference, checkIn: bookings.checkIn,
      checkOut: bookings.checkOut, roomId: stays.roomId, roomNumber: rooms.number, propertyId: bookings.propertyId,
    })
    .from(stays)
    .innerJoin(bookings, eq(bookings.id, stays.bookingId))
    .leftJoin(rooms, eq(rooms.id, stays.roomId))
    .where(and(eq(stays.tenantId, tenantId), eq(stays.guestId, guestId), inArray(stays.status, ['in_house', 'upcoming']), inArray(bookings.status, ['confirmed', 'checked_in'])))
    .orderBy(desc(sql`${stays.status} = 'in_house'`), asc(bookings.checkIn))
    .limit(1);
  const s = rows[0];
  return { guest, verified, stay: s ? { ...s, inHouse: s.status === 'in_house' } : null };
}

export function requireInHouse(ctx: StayContext) {
  if (!ctx.verified) throw new AppError(403, 'email_unverified', 'Please verify your email to access your stay');
  if (!ctx.stay?.inHouse || !ctx.stay.roomId) throw new AppError(403, 'no_active_stay', 'This is available once you have checked in');
  return ctx.stay as NonNullable<StayContext['stay']> & { roomId: string };
}
