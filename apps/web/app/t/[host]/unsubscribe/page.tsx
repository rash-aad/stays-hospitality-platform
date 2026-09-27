'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function Unsubscribe() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'bad'>('ask');
  const [property, setProperty] = useState('');
  async function go() {
    setState('busy');
    const r = await fetch('/api/v1/public/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!r.ok) return setState('bad');
    setProperty((await r.json()).property ?? '');
    setState('done');
  }
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
      <div data-testid="unsubscribe">
        {state === 'done' ? <><p className="display text-3xl">You’re unsubscribed</p><p className="mt-2 t-muted">{property ? `${property} won’t` : 'We won’t'} send you offers or news any more. Booking confirmations and messages about your stays still arrive.</p></>
          : state === 'bad' ? <><p className="display text-3xl">This link isn’t valid</p><p className="mt-2 t-muted">Reply to the email and we’ll take you off the list.</p></>
          : <><p className="display text-3xl">Stop offers and news?</p><p className="mt-2 t-muted">You’ll still receive messages about your bookings.</p><button className="t-btn mt-6" disabled={state === 'busy' || !token} onClick={go}>Unsubscribe</button></>}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><Unsubscribe /></Suspense>;
}
