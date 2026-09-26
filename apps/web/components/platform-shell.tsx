'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, refreshSession, signOut } from '@/lib/api';
import { useStaff } from '@/lib/hooks';
import { ToastProvider, cx } from './ui';
import { MfaGate } from './mfa';
import { Logo } from './brand';

export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<{ user: { name: string; email: string; mfaEnabled: boolean; mfa: 'ok' | 'pending' | null } } | null>(null);
  useEffect(() => {
    (async () => {
      if (!(await refreshSession('staff'))) return router.replace('/platform/login');
      const m = await api<{ kind: string; user: { name: string; email: string; mfaEnabled: boolean; mfa: 'ok' | 'pending' | null } }>('/auth/me');
      if (m.kind !== 'platform') return router.replace('/platform/login');
      setMe(m);
    })().catch(() => router.replace('/platform/login'));
  }, [router]);
  const { data: queue } = useStaff<{ data: unknown[] }>(me && me.user.mfa !== 'pending' ? '/platform/payments' : null, { refreshInterval: 60_000 });
  const pending = queue?.data.length ?? 0;
  if (!me) return <div className="grid min-h-dvh place-items-center text-[13px] text-muted">Loading…</div>;
  if (me.user.mfa === 'pending') return <ToastProvider><MfaGate enrolled={me.user.mfaEnabled} loginPath="/platform/login" onDone={() => location.reload()} /></ToastProvider>;
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <header className="flex h-12 items-center gap-6 border-b border-line bg-ink px-6 text-white">
          <Logo size="sm" tone="light" suffix="Console" />
          <nav className="flex gap-4 text-[13px]">
            {[['/platform', 'Tenants'], ['/platform/payments', 'Payments to verify'], ['/platform/settings', 'Settings']].map(([href, label]) => (
              <Link key={href} href={href!} className={cx('flex items-center gap-1.5', (href === '/platform' ? path === '/platform' || path.startsWith('/platform/tenants') : path.startsWith(href!)) ? 'text-white' : 'text-white/60 hover:text-white')}>
                {label}{href === '/platform/payments' && pending > 0 && <span className="rounded-sm bg-[#9fd3cc] px-1 text-[11px] font-semibold text-ink tabular-nums" data-testid="pending-count">{pending}</span>}
              </Link>
            ))}
          </nav>
          <Link href="/platform/account" className="ml-auto text-[13px] text-white/70 hover:text-white">{me.user.name}</Link>
          <button className="text-[13px] text-white/70 hover:text-white" onClick={async () => { await signOut('staff'); router.replace('/platform/login'); }}>Sign out</button>
        </header>
        <main>{children}</main>
      </div>
    </ToastProvider>
  );
}
