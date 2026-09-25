'use client';

import { useEffect, useState } from 'react';
import type { MenuData, SiteData, SiteInfo } from '@/components/site/types';
import { staffApi } from '@/lib/api';

/** Load the same data the public site renders with, using the staff session (tenant from the token). */
export function useSiteData() {
  const [data, setData] = useState<SiteData | null>(null);
  useEffect(() => {
    (async () => {
      const get = <T,>(p: string) => staffApi<{ data: T }>(p).then((r) => r.data).catch(() => null);
      const site = (await get<SiteInfo>('/public/site'))!;
      const m = site.tenant.modules;
      const [roomTypes, restaurants, experiences, offers] = await Promise.all([
        m.includes('room_booking') ? get<SiteData['roomTypes']>('/public/room-types') : null,
        m.includes('restaurant') ? get<SiteData['restaurants']>('/public/restaurants') : null,
        m.some((x) => ['experiences', 'spa', 'transport'].includes(x)) ? get<SiteData['experiences']>('/public/experiences') : null,
        m.includes('offers') ? get<SiteData['offers']>('/public/offers') : null,
      ]);
      const menus: Record<string, MenuData> = {};
      await Promise.all((restaurants ?? []).map(async (r) => { menus[r.id] = (await get<MenuData>(`/public/restaurants/${r.id}/menu`)) ?? []; }));
      setData({ site, roomTypes: roomTypes ?? [], restaurants: restaurants ?? [], experiences: experiences ?? [], offers: offers ?? [], menus });
    })();
  }, []);
  return data;
}
