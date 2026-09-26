'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, refreshSession, signOut } from '@/lib/api';
import { useStaff } from '@/lib/hooks';
import { MeCtx, type Me } from './admin-context';
import { cx, ToastProvider } from './ui';
import { InstallPwa } from './pwa';
import { MfaGate } from './mfa';

type Item = { href: string; label: string; perm?: string; mod?: string; anyMod?: string[]; badge?: 'payments' | 'requests' | 'orders' | 'messages' };
const NAV: { group: string; items: Item[] }[] = [
  { group: '', items: [{ href: '/admin', label: 'Today' }] },
  { group: 'Front office', items: [
    { href: '/admin/reservations', label: 'Reservations', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/tape-chart', label: 'Tape chart', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/calendar', label: 'Rates & availability', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/guests', label: 'Guests', perm: 'guests.read' },
    { href: '/admin/payments', label: 'Payments', perm: 'payments.read', badge: 'payments' },
    { href: '/admin/cash-drawer', label: 'Cash drawer', perm: 'cash.handle' },
    { href: '/admin/night-audit', label: 'Night audit', perm: 'frontoffice.audit' },
    { href: '/admin/messages', label: 'Messages', perm: 'messages.manage', badge: 'messages' },
    { href: '/admin/feedback', label: 'Feedback', perm: 'guests.read' },
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
  { group: 'Insights', items: [{ href: '/admin/revenue', label: 'Revenue', perm: 'bookings.read', mod: 'room_booking' }, { href: '/admin/reports', label: 'Reports', perm: 'reports.read', mod: 'reports' }] },
  { group: 'Settings', items: [
    { href: '/admin/settings/property', label: 'Property & rooms', perm: 'property.manage' },
    { href: '/admin/settings/rates', label: 'Rates, taxes & offers', perm: 'property.manage' },
    { href: '/admin/settings/payments', label: 'Payment methods', perm: 'payments.read' },
    { href: '/admin/settings/subscription', label: 'Subscription', perm: 'tenant.settings' },
    { href: '/admin/settings/billing', label: 'Billing & GST', perm: 'tenant.settings' },
    { href: '/admin/settings/channels', label: 'Channels (iCal)', perm: 'bookings.read', mod: 'room_booking' },
    { href: '/admin/settings/modules', label: 'Modules', perm: 'tenant.settings' },
    { href: '/admin/settings/staff', label: 'Staff & roles', perm: 'staff.manage' },
    { href: '/admin/settings/requests', label: 'Request types', perm: 'requests.configure' },
    { href: '/admin/settings/notifications', label: 'Notifications', perm: 'tenant.settings', mod: 'notifications' },
    { href: '/admin/settings/integrations', label: 'Integrations', perm: 'integrations.manage', mod: 'integrations' },
    { href: '/admin/settings/security', label: 'Security', perm: 'tenant.settings' },
    { href: '/admin/settings/audit', label: 'Audit log', perm: 'audit.read' },
  ] },
];

type SubBanner = { state: string; daysLeft: number; graceLeft: number; coveredUntil: string; pendingVerification: boolean; trial: boolean };

/** One slim line across the admin when the subscription needs attention. */
function SubscriptionBanner({ s, locked, canPay }: { s?: SubBanner; locked: boolean; canPay: boolean }) {
  if (!s) return null;
  let text: string | null = null;
  let tone = 'bg-warn-soft text-warn';
  if (locked || s.state === 'suspended') { text = 'Your workspace is suspended for non-payment — your website is offline. Pay now and we’ll reactivate as soon as it’s verified.'; tone = 'bg-bad text-white'; }
  else if (s.pendingVerification) { text = 'Payment under verification — we’ll confirm within 12 hours. Everything stays on meanwhile.'; tone = 'bg-accent-soft text-accent'; }
  else if (s.state === 'overdue' || s.state === 'lapsed') { text = `bookEZ payment overdue — your workspace will be suspended in ${Math.max(0, s.graceLeft)} day${s.graceLeft === 1 ? '' : 's'}.`; tone = 'bg-bad-soft text-bad'; }
  else if (s.state === 'due') text = `Your bookEZ subscription renews in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}.`;
  else if (s.state === 'trial' && s.daysLeft <= 7) text = `Your free trial ends in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}.`;
  if (!text) return null;
  return (
    <div className={cx('flex items-center justify-between gap-3 px-4 py-1.5 text-[13px]', tone)} role="status" data-testid="subscription-banner">
      <span>{text}</span>
      {canPay ? !s.pendingVerification && <Link href="/admin/settings/subscription" className="shrink-0 font-medium underline">Pay now</Link> : <span className="shrink-0">Ask the owner to renew.</span>}
    </div>
  );
}

type Dash = { paymentsToVerify: number; openRequests: number; liveOrders: number; unreadMessages: number };

/** Where to send someone who isn't signed in: the PIN pad on a shared device, else the password page; back here afterwards. */
async function signInPath() {
  const next = `?next=${encodeURIComponent(location.pathname)}`;
  const shared = await fetch('/api/v1/auth/device').then((r) => r.ok).catch(() => false);
  return `${shared ? '/admin/pin' : '/admin/login'}${location.pathname !== '/admin' ? next : ''}`;
}

export function AdminShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    (async () => {
      if (!(await refreshSession('staff'))) return router.replace(await signInPath());
      const m = await api<Me | { kind: string }>('/auth/me');
      if (m.kind === 'platform') return router.replace('/platform');
      setMe(m as Me);
    })().catch(async () => router.replace(await signInPath()));
  }, [router]);
  useEffect(() => setMenu(false), [path]);

  const { data: dash } = useStaff<{ data: Dash }>(me && me.user.mfa !== 'pending' && !me.tenant.billingLocked ? '/admin/dashboard' : null, { refreshInterval: 30_000 });
  const { data: sub } = useStaff<{ data: SubBanner }>(me && me.user.mfa !== 'pending' ? '/admin/subscription/status' : null, { refreshInterval: 5 * 60_000 });
  // A workspace suspended for non-payment only offers the Subscription page (so the owner can pay).
  const locked = !!me?.tenant.billingLocked;
  useEffect(() => { if (locked && !path.startsWith('/admin/settings/subscription') && !path.startsWith('/admin/subscription-invoice')) router.replace('/admin/settings/subscription'); }, [locked, path, router]);

  if (!me) return <div className="grid min-h-dvh place-items-center text-[13px] text-muted">Loading workspace…</div>;
  if (me.user.mfa === 'pending') return <ToastProvider><MfaGate enrolled={me.user.mfaEnabled} loginPath="/admin/login" onDone={() => location.reload()} /></ToastProvider>;
  if (bare) return <MeCtx.Provider value={me}><ToastProvider>{children}</ToastProvider></MeCtx.Provider>;
  const can = (it: Item) =>
    (!locked || it.href === '/admin/settings/subscription') &&
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
              <Link href="/admin/account" className="block truncate text-[13px] hover:underline">{me.user.name}</Link>
              <div className="mt-1 flex items-center justify-between">
                <button className="text-xs text-muted hover:text-ink" onClick={async () => { await signOut('staff'); const shared = await fetch('/api/v1/auth/device').then((r) => r.ok).catch(() => false); router.replace(shared ? '/admin/pin' : '/admin/login'); }}>{me.sharedDevice ? 'Switch user' : 'Sign out'}</button>
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
            <SubscriptionBanner s={sub?.data} locked={locked} canPay={me.isOwner || me.permissions.includes('tenant.settings')} />
            <main className="min-w-0 flex-1">{locked && !(me.isOwner || me.permissions.includes('tenant.settings')) ? <p className="p-6 text-[13px]">This workspace is paused because the bookEZ subscription is unpaid. Please ask the owner to renew it.</p> : children}</main>
          </div>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
