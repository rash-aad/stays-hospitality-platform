/**
 * The Super Admin console can live on its own origin (e.g. http://localhost:3001 or https://console.example.com),
 * set with NEXT_PUBLIC_PLATFORM_URL (browser) and PLATFORM_HOST (server). Unset → it shares the admin host.
 */
export const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL?.replace(/\/$/, '') || null;

export function onPlatformSurface() {
  if (typeof location === 'undefined') return false;
  if (PLATFORM_URL) return location.host === new URL(PLATFORM_URL).host;
  return location.pathname.startsWith('/platform');
}
