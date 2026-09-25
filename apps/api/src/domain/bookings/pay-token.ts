import { createHmac, timingSafeEqual } from 'node:crypto';
import { runtimeConfig } from '../../runtime.js';

/** Capability token letting an anonymous booker view/pay one booking (emailed and returned on create). */
export function payToken(bookingId: string) {
  return createHmac('sha256', runtimeConfig().JWT_SECRET).update(`pay:${bookingId}`).digest('base64url');
}

export function checkPayToken(bookingId: string, token: string | undefined) {
  if (!token) return false;
  const a = Buffer.from(payToken(bookingId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
