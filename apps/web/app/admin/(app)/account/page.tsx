'use client';

import { useState } from 'react';
import { useMe } from '@/components/admin-context';
import { AccountSecurity } from '@/components/mfa';
import { Field, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';

export default function Account() {
  const me = useMe();
  const { busy, run } = useAction();
  const [pin, setPin] = useState({ pin: '', password: '' });
  const [hasPin, setHasPin] = useState(me.user.hasPin);
  const [daily, setDaily] = useState(me.user.dailyReport);
  const reports = me.isOwner || me.permissions.includes('reports.read');
  return (
    <>
      <PageHeader title="Your account" sub={`${me.user.name} · ${me.user.email}`} />
      <AccountSecurity />
      <div className="max-w-3xl bg-panel">
        {reports && (
          <Section title="Emails">
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={daily} onChange={(e) => { const v = e.target.checked; setDaily(v); run(() => staffApi('/auth/preferences', { method: 'PATCH', body: { dailyReport: v } }), v ? 'You’ll get the daily report' : 'Daily report turned off'); }} /> Email me the daily report each morning (occupancy, revenue, payments)</label>
          </Section>
        )}
        <Section title="Shift PIN">
          <p className="mb-3 text-[13px] text-muted">{me.isOwner ? 'Owners always sign in with their password, so a PIN isn’t used for your account.' : `Sign in on the property’s shared tablets and phones by tapping your name and entering this PIN. ${hasPin ? 'You have a PIN set.' : 'You don’t have one yet.'}`}</p>
          {!me.isOwner && (
            <form className="grid max-w-md grid-cols-2 gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(() => staffApi('/auth/pin', { method: 'PUT', body: pin }), 'PIN saved');
              if (r) { setHasPin(true); setPin({ pin: '', password: '' }); }
            }}>
              <Field label={hasPin ? 'New PIN' : 'PIN'} hint="4–6 digits"><input className="input font-mono" inputMode="numeric" autoComplete="off" maxLength={6} value={pin.pin} onChange={(e) => setPin({ ...pin, pin: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Your password"><input className="input" type="password" autoComplete="current-password" value={pin.password} onChange={(e) => setPin({ ...pin, password: e.target.value })} /></Field>
              <div className="col-span-2 flex gap-2">
                <button className="btn btn-primary" disabled={busy || pin.pin.length < 4 || !pin.password}>{hasPin ? 'Change PIN' : 'Set PIN'}</button>
                {hasPin && <button type="button" className="btn" disabled={busy} onClick={() => run(() => staffApi('/auth/pin', { method: 'DELETE' }), 'PIN removed').then((r) => { if (r) setHasPin(false); })}>Remove PIN</button>}
              </div>
            </form>
          )}
        </Section>
      </div>
    </>
  );
}
