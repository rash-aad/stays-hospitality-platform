import { createHash, randomBytes, randomInt } from 'node:crypto';

// Crockford-ish alphabet without ambiguous characters (0/O, 1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Human-friendly reference, e.g. BK-7K3Q9M. Uniqueness is enforced by a per-tenant unique index. */
export function reference(prefix: string, length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${out}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
