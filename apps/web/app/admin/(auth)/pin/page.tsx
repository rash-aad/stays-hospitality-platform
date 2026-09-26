'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { setAccessToken } from '@/lib/api';
import { useHydrated } from '@/lib/hooks';

type Device = { device: string; property: string; people: { id: string; name: string }[] };
const safeNext = (n: string | null) => (n && /^\/admin(\/[\w/-]*)?$/.test(n) ? n : '/admin');

function PinSignIn() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const ready = useHydrated();
  const [d, setD] = useState<Device | null | 'none'>(null);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/v1/auth/device').then(async (r) => setD(r.ok ? (await r.json()).data : 'none')).catch(() => setD('none'));
  }, []);

  async function submit(p = pin) {
    if (!who || p.length < 4) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/v1/auth/pin-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: who.id, pin: p }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? 'Sign-in failed');
      setAccessToken('staff', j.accessToken);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message); setPin('');
    } finally { setBusy(false); }
  }

  if (!d) return <p className="text-[13px] text-muted">Checking this device…</p>;
  if (d === 'none') {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">PIN sign-in</h1>
        <p className="text-[13px] text-muted">This device isn’t set up as a shared device. A manager can set it up in Settings → Staff &amp; roles → Shared devices, after signing in here.</p>
        <a className="btn btn-primary w-full" href="/admin/login">Sign in with password</a>
      </div>
    );
  }
  if (!who) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-lg font-semibold">Who’s starting a shift?</h1><p className="mt-1 text-[13px] text-muted">{d.property} · {d.device}</p></div>
        {d.people.length === 0 ? <p className="text-[13px] text-muted">No one has set a shift PIN yet. Set one in Your account after signing in with your password.</p> : (
          <ul className="grid grid-cols-2 gap-2">
            {d.people.map((p) => <li key={p.id}><button className="btn btn-lg h-14 w-full justify-center" disabled={!ready} onClick={() => { setWho(p); setPin(''); setError(null); }}>{p.name}</button></li>)}
          </ul>
        )}
        <a className="block text-[13px] text-muted underline" href="/admin/login">Sign in with password instead</a>
      </div>
    );
  }
  const press = (k: string) => {
    if (busy) return;
    if (k === '⌫') return setPin((x) => x.slice(0, -1));
    if (k === 'OK') return void submit();
    const np = (pin + k).slice(0, 6);
    setPin(np);
  };
  return (
    <div className="space-y-4" data-testid="pin-pad">
      <div><h1 className="text-lg font-semibold">Hi {who.name.split(' ')[0]}</h1><p className="mt-1 text-[13px] text-muted">Enter your shift PIN</p></div>
      <p className="h-8 text-center font-mono text-2xl tracking-[0.5em]" aria-label={`${pin.length} digits entered`}>{'•'.repeat(pin.length) || ' '}</p>
      {error && <p className="text-center text-[13px] text-bad" role="alert">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
          <button key={k} type="button" aria-label={k === '⌫' ? 'Delete' : k === 'OK' ? 'Sign in' : k} className={`btn btn-lg h-14 justify-center text-lg ${k === 'OK' ? 'btn-primary' : ''}`} disabled={!ready || busy || (k === 'OK' && pin.length < 4)} onClick={() => press(k)}>{k}</button>
        ))}
      </div>
      <button className="text-[13px] text-muted underline" onClick={() => setWho(null)}>Not {who.name.split(' ')[0]}?</button>
    </div>
  );
}

export default function PinPage() {
  return <Suspense><PinSignIn /></Suspense>;
}
