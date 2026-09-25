'use client';

import { useEffect, useState } from 'react';
import { api, type Audience } from '@/lib/api';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
    if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'production' && localStorage.getItem('sw-dev') === '1') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
}

/** "Install app" affordance; only shown when the browser offers installation. */
export function InstallPwa({ compact, label = 'Install app', className }: { compact?: boolean; label?: string; className?: string }) {
  useServiceWorker();
  const [evt, setEvt] = useState<BIP | null>(null);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  return (
    <button className={className ?? (compact ? 'text-xs text-muted hover:text-ink' : 'btn')} onClick={async () => { await evt.prompt(); setEvt(null); }}>
      {label}
    </button>
  );
}

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush(aud: Audience): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const reg = await navigator.serviceWorker.register('/sw.js');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const { data } = await api<{ data: { publicKey: string | null } }>('/public/push/key', { aud });
  if (!data.publicKey) return 'unsupported';
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.publicKey) });
  const j = sub.toJSON();
  await api('/push/subscribe', { aud, body: { endpoint: j.endpoint, keys: j.keys } });
  return 'enabled';
}
