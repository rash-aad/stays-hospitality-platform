'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, refreshSession, signOut } from '@/lib/api';
import { ToastProvider, cx } from './ui';

export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<{ user: { name: string; email: string } } | null>(null);
  useEffect(() => {
    (async () => {
      if (!(await refreshSession('staff'))) return router.replace('/admin/login');
      const m = await api<{ kind: string; user: { name: string; email: string } }>('/auth/me');
      if (m.kind !== 'platform') return router.replace('/admin');
      setMe(m);
    })().catch(() => router.replace('/admin/login'));
  }, [router]);
  if (!me) return <div className="grid min-h-dvh place-items-center text-[13px] text-muted">Loading…</div>;
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <header className="flex h-12 items-center gap-6 border-b border-line bg-ink px-6 text-white">
          <span className="font-serif text-lg">Stays <span className="text-white/60">Platform</span></span>
          <nav className="flex gap-4 text-[13px]"><Link href="/platform" className={cx(path === '/platform' ? 'text-white' : 'text-white/60 hover:text-white')}>Tenants</Link></nav>
          <span className="ml-auto text-[13px] text-white/70">{me.user.name}</span>
          <button className="text-[13px] text-white/70 hover:text-white" onClick={async () => { await signOut('staff'); router.replace('/admin/login'); }}>Sign out</button>
        </header>
        <main>{children}</main>
      </div>
    </ToastProvider>
  );
}
