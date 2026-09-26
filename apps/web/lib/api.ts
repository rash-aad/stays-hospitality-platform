'use client';

import { onPlatformSurface } from './surface';

export type Audience = 'staff' | 'guest';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

// Access tokens live in memory only; the refresh token is an httpOnly cookie scoped to /api/v1/auth.
const tokens: Record<Audience, string | null> = { staff: null, guest: null };
const inflight: Record<Audience, Promise<boolean> | null> = { staff: null, guest: null };
const listeners = new Set<(aud: Audience, signedIn: boolean) => void>();

export function onAuthChange(fn: (aud: Audience, signedIn: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setAccessToken(aud: Audience, token: string | null) {
  tokens[aud] = token;
  listeners.forEach((l) => l(aud, !!token));
}

/** Which refresh cookie a session uses: platform consoles keep their own, separate from hotel staff. */
const cookieAud = (aud: Audience) => (aud === 'staff' && onPlatformSurface() ? 'platform' : aud);

export function refreshSession(aud: Audience): Promise<boolean> {
  inflight[aud] ??= (async () => {
    try {
      // Only a definite "no session" signs you out; rate limits, server hiccups and flaky Wi-Fi are retried.
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(`/api/v1/auth/refresh?aud=${cookieAud(aud)}`, { method: 'POST', headers: { 'x-csrf': '1' }, credentials: 'same-origin' }).catch(() => null);
        if (r?.ok) {
          setAccessToken(aud, (await r.json()).accessToken);
          return true;
        }
        if ((r && r.status < 500 && r.status !== 429) || attempt >= 3) {
          if (r && r.status < 500 && r.status !== 429) setAccessToken(aud, null);
          return false;
        }
        const wait = Number(r?.headers.get('retry-after')) || 0.5 * 2 ** attempt;
        await new Promise((res) => setTimeout(res, Math.min(wait, 5) * 1000));
      }
    } finally {
      setTimeout(() => (inflight[aud] = null), 0);
    }
  })();
  return inflight[aud]!;
}

export async function signOut(aud: Audience) {
  await fetch(`/api/v1/auth/logout?aud=${cookieAud(aud)}`, { method: 'POST', headers: { 'x-csrf': '1' } }).catch(() => {});
  setAccessToken(aud, null);
}

type Opts = { method?: string; body?: unknown; aud?: Audience; idempotencyKey?: string; form?: FormData; raw?: boolean; site?: string };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const aud = opts.aud ?? 'staff';
  if (!tokens[aud]) await refreshSession(aud);
  const run = () => {
    const headers: Record<string, string> = {};
    if (tokens[aud]) headers.authorization = `Bearer ${tokens[aud]}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    return fetch(`/api/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
    });
  };
  let res = await run();
  if (res.status === 401 && (await refreshSession(aud))) res = await run();
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    // Surface the first field message for validation errors — it tells the user what to fix.
    const field = e.code === 'validation_error' && Array.isArray(e.details) ? e.details[0]?.message : null;
    throw new ApiError(res.status, e.code ?? 'error', field ?? e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const staffApi = <T = unknown>(path: string, o: Omit<Opts, 'aud'> = {}) => api<T>(path, { ...o, aud: 'staff' });
export const guestApi = <T = unknown>(path: string, o: Omit<Opts, 'aud'> = {}) => api<T>(path, { ...o, aud: 'guest' });

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
