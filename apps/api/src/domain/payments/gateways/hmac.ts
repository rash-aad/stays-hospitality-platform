import { createHmac, timingSafeEqual } from 'node:crypto';

export function hmacHex(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
