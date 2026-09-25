const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export async function GET(_req: Request, ctx: { params: Promise<{ host: string }> }) {
  const { host } = await ctx.params;
  const res = await fetch(`${API}/api/v1/public/manifest`, { headers: { 'x-tenant-host': decodeURIComponent(host) }, next: { revalidate: 3600 } });
  if (!res.ok) return new Response('Not found', { status: 404 });
  const m = await res.json();
  m.icons = [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }];
  return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
}
