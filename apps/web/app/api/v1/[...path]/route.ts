import type { NextRequest } from 'next/server';

/**
 * Same-origin gateway to the API. Keeps the refresh cookie first-party on every tenant domain and
 * stamps the site host so public/guest endpoints resolve the right tenant.
 */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const PASS_REQ = ['authorization', 'content-type', 'idempotency-key', 'x-csrf', 'cookie', 'user-agent', 'accept', 'x-request-id'];
const PASS_RES = ['content-type', 'content-disposition', 'cache-control', 'x-request-id', 'idempotent-replayed'];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(`${API}/api/v1/${path.map(encodeURIComponent).join('/')}`);
  url.search = req.nextUrl.search;
  const headers = new Headers();
  for (const h of PASS_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('x-tenant-host', (req.headers.get('host') ?? '').split(':')[0]!);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const res = await fetch(url, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual', cache: 'no-store' });
  const out = new Headers();
  for (const h of PASS_RES) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
