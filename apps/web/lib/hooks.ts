'use client';

import { useSyncExternalStore } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import { api, type Audience } from './api';

export function useApi<T = unknown>(path: string | null, aud: Audience = 'staff', config?: SWRConfiguration) {
  return useSWR<T>(path ? [path, aud] : null, ([p, a]: [string, Audience]) => api<T>(p, { aud: a }), { revalidateOnFocus: true, ...config });
}
export const useStaff = <T = unknown>(path: string | null, config?: SWRConfiguration) => useApi<T>(path, 'staff', config);
export const useGuest = <T = unknown>(path: string | null, config?: SWRConfiguration) => useApi<T>(path, 'guest', config);

/** False during server render and hydration; true once React handles events (so early taps aren't lost to a native form submit). */
export function useHydrated() {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}
