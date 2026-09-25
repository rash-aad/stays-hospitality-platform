import { NextResponse, type NextRequest } from 'next/server';

/**
 * Host-based routing. The platform host (APP_HOSTS) serves the Super Admin, Tenant Admin and landing
 * page. Every other host is a tenant website: its paths are rewritten to /t/<host>/… where the site,
 * booking flow and guest portal are rendered for that tenant.
 */
const APP_HOSTS = (process.env.APP_HOSTS ?? 'localhost,127.0.0.1').split(',').map((h) => h.trim());

export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0]!.toLowerCase();
  const { pathname } = req.nextUrl;
  if (APP_HOSTS.includes(host)) return NextResponse.next();
  if (pathname.startsWith('/t/')) return new NextResponse('Not found', { status: 404 }); // internal path, never addressable from a tenant host
  if (/\.[a-z0-9]+$/i.test(pathname) && pathname !== '/manifest.webmanifest') return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/t/${host}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico).*)'],
};
