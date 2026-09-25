'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, refreshSession, signOut } from '@/lib/api';
import { useStaff } from '@/lib/hooks';
import { MeCtx, type Me } from './admin-context';
import { cx, ToastProvider } from './ui';
import { InstallPwa } from './pwa';

type Item = { href: string; label: string; perm?: string; mod?: string; anyMod?: string[]; badge?: 'payments' | 'requests' | 'orders' | 'messages' };
const NAV: { group: string; items: Item[] }[] = [
  { group: '', items: [{ href: '/admin', label: 'Today' }] },
  { group: 'Front office', items: [
    { href: '/admin/reservations', label: 'Reservations', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/calendar', label: 'Rates & availability', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/guests', label: 'Guests', perm: 'guests.read' },
    { href: '/admin/payments', label: 'Payments', perm: 'payments.read', badge: 'payments' },
    { href: '/admin/messages', label: 'Messages', perm: 'messages.manage', badge: 'messages' },
    { href: '/admin/events', label: 'Events & banquets', perm: 'events.manage', mod: 'events' },
  ] },
  { group: 'Dining', items: [
    { href: '/admin/dining/reservations', label: 'Table bookings', perm: 'restaurant.reservations', mod: 'restaurant.reservations' },
    { href: '/admin/dining/kitchen', label: 'Kitchen', perm: 'orders.manage', mod: 'restaurant.ordering', badge: 'orders' },
    { href: '/admin/dining/menus', label: 'Menus & outlets', perm: 'restaurant.manage', mod: 'restaurant' },
  ] },
  { group: 'Guest services', items: [
    { href: '/admin/requests', label: 'Requests', perm: 'requests.manage', badge: 'requests' },
    { href: '/admin/housekeeping', label: 'Housekeeping', perm: 'housekeeping.manage', mod: 'housekeeping' },
    { href: '/admin/maintenance', label: 'Maintenance', perm: 'maintenance.manage', mod: 'maintenance' },
    { href: '/admin/experiences', label: 'Experiences', perm: 'experiences.manage', anyMod: ['experiences', 'spa', 'transport'] },
  ] },
  { group: 'Website', items: [
    { href: '/admin/site', label: 'Website', perm: 'content.manage', mod: 'website_builder' },
    { href: '/admin/guide', label: 'Guest guide', perm: 'content.manage', mod: 'guest_portal' },
  ] },
  { group: 'Insights', items: [{ href: '/admin/reports', label: 'Reports', perm: 'reports.read', mod: 'reports' }] },
  { group: 'Settings', items: [
    { href: '/admin/settings/property', label: 'Property & rooms', perm: 'property.manage' },
    { href: '/admin/settings/rates', label: 'Rates, taxes & offers', perm: 'property.manage' },
    { href: '/admin/settings/payments', label: 'Payment methods', perm: 'payments.read' },
    { href: '/admin/settings/modules', label: 'Modules', perm: 'tenant.settings' },
    { href: '/admin/settings/staff', label: 'Staff & roles', perm: 'staff.manage' },
    { href: '/admin/settings/requests', label: 'Request types', perm: 'requests.configure' },
    { href: '/admin/settings/notifications', label: 'Notifications', perm: 'tenant.settings', mod: 'notifications' },
    { href: '/admin/settings/integrations', label: 'Integrations', perm: 'integrations.manage', mod: 'integrations' },
    { href: '/admin/settings/audit', label: 'Audit log', perm: 'audit.read' },
  ] },
];

type Dash = { paymentsToVerify: number; openRequests: number; liveOrders: number; unreadMessages: number };

export function AdminShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    (async () => {
      if (!(await refreshSession('staff'))) return router.replace('/admin/login');
      const m = await api<Me | { kind: string }>('/auth/me');
      if (m.kind === 'platform') return router.replace('/platform');
      setMe(m as Me);
    })().catch(() => router.replace('/admin/login'));
  }, [router]);
  useEffect(() => setMenu(false), [path]);

  const { data: dash } = useStaff<{ data: Dash }>(me ? '/admin/dashboard' : null, { refreshInterval: 30_000 });

  if (!me) return <div className="grid min-h-dvh place-items-center text-[13px] text-muted">Loading workspace…</div>;
  if (bare) return <MeCtx.Provider value={me}><ToastProvider>{children}</ToastProvider></MeCtx.Provider>;
  const can = (it: Item) =>
    (!it.perm || me.isOwner || me.permissions.includes(it.perm)) &&
    (!it.mod || me.tenant.modules.includes(it.mod)) &&
    (!it.anyMod || it.anyMod.some((m) => me.tenant.modules.includes(m)));
  const badge = (b?: Item['badge']) => {
    const d = dash?.data;
    if (!d || !b) return 0;
    return { payments: d.paymentsToVerify, requests: d.openRequests, orders: d.liveOrders, messages: d.unreadMessages }[b];
  };

  const nav = (
    <nav className="flex-1 overflow-y-auto px-2 pb-6">
      {NAV.map((g) => {
        const items = g.items.filter(can);
        if (!items.length) return null;
        return (
          <div key={g.group} className="mt-4 first:mt-2">
            {g.group && <p className="eyebrow px-2 pb-1">{g.group}</p>}
            {items.map((it) => {
              const active = it.href === '/admin' ? path === '/admin' : path.startsWith(it.href);
              const n = badge(it.badge);
              return (
                <Link key={it.href} href={it.href} className={cx('flex h-7 items-center justify-between rounded-sm px-2 text-[13px]', active ? 'bg-sunk font-medium text-ink' : 'text-ink-2 hover:bg-sunk/70')}>
                  {it.label}
                  {n > 0 && <span className={cx('num text-2xs', it.badge === 'payments' ? 'font-semibold text-warn' : 'text-muted')}>{n}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <MeCtx.Provider value={me}>
      <ToastProvider>
        <div className="flex min-h-dvh">
          <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-line bg-panel transition-transform lg:translate-x-0', menu ? 'translate-x-0' : '-translate-x-full')}>
            <div className="px-4 pt-4 pb-2">
              <p className="truncate text-[14px] font-semibold">{me.tenant.name}</p>
              <a href={`http://${me.tenant.slug}.${location.hostname}${location.port ? `:${location.port}` : ''}`} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-ink">View website ↗</a>
            </div>
            {nav}
            <div className="border-t border-line px-4 py-3">
              <p className="truncate text-[13px]">{me.user.name}</p>
              <div className="mt-1 flex items-center justify-between">
                <button className="text-xs text-muted hover:text-ink" onClick={async () => { await signOut('staff'); router.replace('/admin/login'); }}>Sign out</button>
                <InstallPwa compact />
              </div>
            </div>
          </aside>
          {menu && <div className="fixed inset-0 z-30 bg-ink/20 lg:hidden" onClick={() => setMenu(false)} />}
          <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
            <div className="sticky top-0 z-20 flex h-11 items-center gap-3 border-b border-line bg-panel px-4 lg:hidden">
              <button className="btn btn-sm" onClick={() => setMenu(true)} aria-label="Open navigation">Menu</button>
              <span className="truncate text-[13px] font-medium">{me.tenant.name}</span>
            </div>
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
