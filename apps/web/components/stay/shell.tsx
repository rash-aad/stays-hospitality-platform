'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { guestApi, onAuthChange, refreshSession, setAccessToken, signOut } from '@/lib/api';
import { useGuest, useHydrated } from '@/lib/hooks';
import { InstallPwa, useServiceWorker } from '../pwa';

export type Home = {
  guest: { id: string; firstName: string; lastName: string; email: string; phone: string | null; verified: boolean; notificationPrefs: Record<string, boolean> };
  property: { name: string; phone: string | null; email: string | null; checkInTime: string; checkOutTime: string; images: { url: string; alt: string }[] } | null;
  stay: null | { id: string; bookingId: string; reference: string; status: string; checkIn: string; checkOut: string; inHouse: boolean; roomNumber: string | null; roomType: string; adults: number; children: number; room: { number: string; floor: string | null; housekeepingStatus: string } | null; paymentStatus: string; total: number; amountPaid: number };
  openRequests: { id: string; title: string; status: string; createdAt: string }[];
  activeOrders: { id: string; reference: string; status: string; estimatedReadyAt: string | null; total: number }[];
  upcomingTables: { id: string; startsAt: string; partySize: number; status: string; restaurant: string }[];
  unreadNotifications: number;
  offers: { id: string; title: string; summary: string | null; image: { url: string; alt: string } | null }[];
  modules: string[];
};

const Ctx = createContext<{ home: Home; reload: () => void } | null>(null);
export const useStay = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStay outside the guest shell');
  return c;
};

const TABS = [
  { href: '/stay', label: 'Stay' },
  { href: '/stay/dining', label: 'Dining', mod: 'restaurant' },
  { href: '/stay/requests', label: 'Requests' },
  { href: '/stay/bill', label: 'Bill' },
  { href: '/stay/more', label: 'More' },
];

export function GuestShell({ name, children }: { name: string; children: ReactNode }) {
  useServiceWorker();
  const path = usePathname();
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');
  useEffect(() => {
    // The shell persists across /stay/access → /stay, so it must react when a link is redeemed later.
    const off = onAuthChange((aud, signedIn) => { if (aud === 'guest') setState(signedIn ? 'in' : 'out'); });
    refreshSession('guest').then((ok) => setState((s) => (s === 'in' ? s : ok ? 'in' : 'out')));
    return () => { off(); };
  }, []);
  const { data, mutate, error } = useGuest<{ data: Home }>(state === 'in' ? '/portal/home' : null, { refreshInterval: 30_000 });
  const reload = useCallback(() => void mutate(), [mutate]);
  if (path.startsWith('/stay/access') || path.startsWith('/stay/verify')) return <Frame name={name}>{children}</Frame>;
  if (state === 'checking' || (state === 'in' && !data && !error)) return <Frame name={name}><p className="t-muted py-20 text-center">Opening your stay…</p></Frame>;
  if (state === 'out' || error) return <Frame name={name}><SignIn onIn={() => setState('in')} /></Frame>;
  const home = data!.data;
  const tabs = TABS.filter((t) => !t.mod || home.modules.includes(t.mod));
  return (
    <Ctx.Provider value={{ home, reload }}>
      <div className="mx-auto min-h-dvh max-w-xl pb-24">
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <a href="/" className="display text-xl">{name}</a>
          <a href="/stay/notifications" className="relative text-sm" aria-label="Notifications">Updates{home.unreadNotifications > 0 && <span className="t-accent ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] tabular-nums">{home.unreadNotifications}</span>}</a>
        </header>
        {!home.guest.verified && <p className="mx-5 mb-4 border-l-2 pl-3 text-sm" style={{ borderColor: 'var(--t-accent)' }}>Please confirm your email — we sent a link to {home.guest.email}. Your bookings appear once it’s confirmed.</p>}
        <main className="px-5">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t t-line pb-[env(safe-area-inset-bottom)]" style={{ background: 'var(--t-bg)' }}>
          <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            {tabs.map((t) => {
              const active = t.href === '/stay' ? path === '/stay' : path.startsWith(t.href);
              return <li key={t.href}><a href={t.href} className="flex h-14 flex-col items-center justify-center text-[13px]" style={{ color: active ? 'var(--t-ink)' : 'var(--t-muted)', fontWeight: active ? 600 : 400 }}>{t.label}{active && <span className="mt-1 h-0.5 w-5" style={{ background: 'var(--t-ink)' }} />}</a></li>;
            })}
          </ul>
        </nav>
      </div>
    </Ctx.Provider>
  );
}

function Frame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-md px-5 py-6">
      <a href="/" className="display text-xl">{name}</a>
      <div className="mt-10">{children}</div>
    </div>
  );
}

function SignIn({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<'link' | 'password' | 'register'>('link');
  const ready = useHydrated();
  const [f, setF] = useState({ email: '', reference: '', password: '', firstName: '', lastName: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    const url = mode === 'link' ? '/api/v1/guest-auth/access-link' : mode === 'password' ? '/api/v1/guest-auth/login' : '/api/v1/guest-auth/register';
    const body = mode === 'link' ? { email: f.email, reference: f.reference } : mode === 'password' ? { email: f.email, password: f.password } : { email: f.email, password: f.password, firstName: f.firstName, lastName: f.lastName };
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error?.message ?? 'Something went wrong');
    if (mode === 'link') return setMsg(`If ${f.reference.toUpperCase()} matches that email, a private link to your stay is on its way. It works for 24 hours.`);
    setAccessToken('guest', j.accessToken);
    onIn();
  }
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="guest-signin">
      <h1 className="display text-4xl">Your stay</h1>
      <p className="t-muted">Order food to your room, ask for anything, book a table and see your bill — all in one place.</p>
      <div className="flex gap-5 border-b t-line text-sm">
        {([['link', 'Booking reference'], ['password', 'Password'], ['register', 'Create account']] as const).map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className="-mb-px border-b-2 pb-2" style={{ borderColor: mode === k ? 'var(--t-ink)' : 'transparent', opacity: mode === k ? 1 : 0.6 }}>{l}</button>)}
      </div>
      {mode === 'register' && <div className="grid grid-cols-2 gap-3"><label><span className="t-label">First name</span><input className="t-input" required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></label><label><span className="t-label">Last name</span><input className="t-input" required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label></div>}
      <label className="block"><span className="t-label">Email used for your booking</span><input className="t-input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      {mode === 'link' && <label className="block"><span className="t-label">Booking reference</span><input className="t-input uppercase" required placeholder="BK-7K3Q9M" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>}
      {mode !== 'link' && <label className="block"><span className="t-label">Password</span><input className="t-input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : 1} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>}
      {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
      {msg && <p className="t-surface p-4 text-sm">{msg}</p>}
      <button className="t-btn w-full" disabled={busy || !ready}>{busy ? 'Please wait…' : mode === 'link' ? 'Email me a link' : mode === 'password' ? 'Sign in' : 'Create account'}</button>
    </form>
  );
}

export function RedeemAccess() {
  const sp = useSearchParams();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const token = sp.get('token');
    if (!token) return setErr('This link is incomplete.');
    fetch('/api/v1/guest-auth/access-link/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error?.message); setAccessToken('guest', j.accessToken); const next = sp.get('next'); router.replace(next && /^\/stay(\/[\w/-]*)?$/.test(next) ? next : '/stay'); })
      .catch((e) => setErr(e.message || 'This link has expired.'));
  }, [sp, router]);
  return err ? <div><p className="display text-3xl">This link has expired</p><p className="t-muted mt-2">{err} Ask for a new one from the sign-in page.</p><a className="t-btn mt-6" href="/stay">Sign in</a></div> : <p className="t-muted">Opening your stay…</p>;
}

export function VerifyEmail() {
  const sp = useSearchParams();
  const [state, setState] = useState<'busy' | 'ok' | 'bad'>('busy');
  useEffect(() => {
    fetch('/api/v1/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: sp.get('token') }) }).then((r) => setState(r.ok ? 'ok' : 'bad'));
  }, [sp]);
  return state === 'busy' ? <p className="t-muted">Confirming…</p> : state === 'ok' ? <div><p className="display text-3xl">Email confirmed</p><a className="t-btn mt-6" href="/stay">Open your stay</a></div> : <p className="display text-3xl">This link has expired.</p>;
}

export function SignOutButton() {
  return <button className="t-btn t-btn-outline w-full" onClick={async () => { await signOut('guest'); location.href = '/stay'; }}>Sign out</button>;
}
export { InstallPwa, guestApi };
