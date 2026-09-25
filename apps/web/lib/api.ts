'use client';

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

export function refreshSession(aud: Audience): Promise<boolean> {
  inflight[aud] ??= (async () => {
    try {
      const r = await fetch(`/api/v1/auth/refresh?aud=${aud}`, { method: 'POST', headers: { 'x-csrf': '1' }, credentials: 'same-origin' });
      if (!r.ok) {
        setAccessToken(aud, null);
        return false;
      }
      setAccessToken(aud, (await r.json()).accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (inflight[aud] = null), 0);
    }
  })();
  return inflight[aud]!;
}

export async function signOut(aud: Audience) {
  await fetch(`/api/v1/auth/logout?aud=${aud}`, { method: 'POST', headers: { 'x-csrf': '1' } }).catch(() => {});
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
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const staffApi = <T = unknown>(path: string, o: Omit<Opts, 'aud'> = {}) => api<T>(path, { ...o, aud: 'staff' });
export const guestApi = <T = unknown>(path: string, o: Omit<Opts, 'aud'> = {}) => api<T>(path, { ...o, aud: 'guest' });

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
