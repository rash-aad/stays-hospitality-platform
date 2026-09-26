import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runtimeConfig } from '../../runtime.js';
import { REFRESH_TTL_DAYS, type Session } from './service.js';

export const COOKIE = { staff: 'hp_rt_staff', guest: 'hp_rt_guest', platform: 'hp_rt_platform' } as const; // platform sessions get their own cookie so a hotel login in the same browser can't clobber them
export type Audience = keyof typeof COOKIE;

export const sessionOut = z.object({ accessToken: z.string(), expiresIn: z.number() });
/**
 * Sign-in style endpoints: 10 a minute per address *and account* — staff at one hotel share an IP, so a
 * pure per-IP limit would lock out a whole front desk at shift change. The global per-IP limit still applies.
 */
export const loginLimit = {
  rateLimit: {
    max: 10, timeWindow: '1 minute', hook: 'preHandler' as const,
    keyGenerator: (req: FastifyRequest) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === 'string' ? `${req.ip}|${email.toLowerCase()}` : req.ip;
    },
  },
};
/** Refresh is limited per session (hashed cookie), not per IP, for the same shared-NAT reason. */
export const refreshLimit = {
  rateLimit: {
    max: 60, timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => {
      const c = req.cookies?.[COOKIE[(req.query as { aud?: Audience }).aud ?? 'staff']] ?? req.cookies?.[COOKIE.staff];
      return c ? createHash('sha256').update(c).digest('base64url') : req.ip;
    },
  },
};

/** Set the httpOnly refresh cookie (scoped to the auth endpoints) and return the access-token half. */
export function setRefreshCookie(reply: FastifyReply, aud: Audience, s: Session) {
  reply.setCookie(COOKIE[aud], s.refreshToken, {
    httpOnly: true, secure: runtimeConfig().NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/auth', maxAge: REFRESH_TTL_DAYS * 86400,
  });
  return { accessToken: s.accessToken, expiresIn: s.expiresIn };
}

export const cookieAudFor = (s: Session): Audience => (s.claims.typ === 'platform' ? 'platform' : s.claims.typ === 'guest' ? 'guest' : 'staff');
