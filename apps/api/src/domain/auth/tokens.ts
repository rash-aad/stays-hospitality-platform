import { jwtVerify, SignJWT } from 'jose';

/** `mfa`: 'ok' = second factor presented; 'pending' = the account must set up / present one before anything else. */
export type MfaState = 'ok' | 'pending';
export type AccessClaims =
  | { typ: 'staff'; sub: string; tid: string; mfa?: MfaState }
  | { typ: 'platform'; sub: string; mfa?: MfaState }
  | { typ: 'guest'; sub: string; tid: string };

export const ACCESS_TTL_SECONDS = 15 * 60;

let key: Uint8Array;
export function initTokens(secret: string) {
  key = new TextEncoder().encode(secret);
}

export async function signAccess(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('hp-api')
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAccess(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'hp-api', algorithms: ['HS256'] });
    const typ = payload.typ;
    if (typeof payload.sub !== 'string') return null;
    const mfa = payload.mfa === 'ok' || payload.mfa === 'pending' ? payload.mfa : undefined;
    if (typ === 'platform') return { typ, sub: payload.sub, ...(mfa && { mfa }) };
    if (typ === 'staff' && typeof payload.tid === 'string') return { typ, sub: payload.sub, tid: payload.tid, ...(mfa && { mfa }) };
    if (typ === 'guest' && typeof payload.tid === 'string') return { typ, sub: payload.sub, tid: payload.tid };
    return null;
  } catch {
    return null;
  }
}

/** Short-lived proof that the password step passed; exchanged for a session with a TOTP or recovery code. */
export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({ typ: 'mfa_challenge' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt()
    .setIssuer('hp-api').setAudience('mfa').setExpirationTime('5m').sign(key);
}

export async function verifyMfaChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'hp-api', audience: 'mfa', algorithms: ['HS256'] });
    return payload.typ === 'mfa_challenge' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
