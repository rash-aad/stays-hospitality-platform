'use client';

import { createContext, useContext } from 'react';

export type Me = {
  kind: 'staff';
  user: { id: string; name: string; email: string };
  isOwner: boolean;
  permissions: string[];
  tenant: { id: string; slug: string; name: string; currency: string; timezone: string; modules: string[] };
};

export const MeCtx = createContext<Me | null>(null);
export function useMe() {
  const me = useContext(MeCtx);
  if (!me) throw new Error('useMe outside admin shell');
  return me;
}
export function useCan() {
  const me = useMe();
  return {
    perm: (p: string) => me.isOwner || me.permissions.includes(p),
    mod: (m: string) => me.tenant.modules.includes(m),
  };
}
