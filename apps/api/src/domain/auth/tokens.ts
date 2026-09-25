import { jwtVerify, SignJWT } from 'jose';

export type AccessClaims =
  | { typ: 'staff'; sub: string; tid: string }
  | { typ: 'platform'; sub: string }
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
    if (typ === 'platform') return { typ, sub: payload.sub };
    if ((typ === 'staff' || typ === 'guest') && typeof payload.tid === 'string') return { typ, sub: payload.sub, tid: payload.tid };
    return null;
  } catch {
    return null;
  }
}
