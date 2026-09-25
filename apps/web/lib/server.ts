import 'server-only';
import type { MenuData, SiteData, SiteInfo } from '@/components/site/types';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export async function publicGet<T>(host: string, path: string, revalidate = 30): Promise<T | null> {
  const res = await fetch(`${API}/api/v1${path}`, { headers: { 'x-tenant-host': host }, next: { revalidate, tags: [`site:${host}`] } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function getSite(host: string) {
  return (await publicGet<{ data: SiteInfo }>(host, '/public/site'))?.data ?? null;
}

export async function getSiteData(host: string, site: SiteInfo): Promise<SiteData> {
  const m = site.tenant.modules;
  const [rooms, rest, exps, offers] = await Promise.all([
    m.includes('room_booking') ? publicGet<{ data: SiteData['roomTypes'] }>(host, '/public/room-types') : null,
    m.includes('restaurant') ? publicGet<{ data: SiteData['restaurants'] }>(host, '/public/restaurants') : null,
    m.some((x) => ['experiences', 'spa', 'transport'].includes(x)) ? publicGet<{ data: SiteData['experiences'] }>(host, '/public/experiences') : null,
    m.includes('offers') ? publicGet<{ data: SiteData['offers'] }>(host, '/public/offers') : null,
  ]);
  const restaurants = rest?.data ?? [];
  const menus: Record<string, MenuData> = {};
  // Menus change during service (sold-out items), so they are never served from cache.
  await Promise.all(restaurants.map(async (r) => { menus[r.id] = (await publicGet<{ data: MenuData }>(host, `/public/restaurants/${r.id}/menu`, 0))?.data ?? []; }));
  return { site, roomTypes: rooms?.data ?? [], restaurants, experiences: exps?.data ?? [], offers: offers?.data ?? [], menus };
}

export const decodeHost = (h: string) => decodeURIComponent(h).toLowerCase();
