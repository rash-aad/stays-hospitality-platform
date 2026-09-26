'use client';

import { useState } from 'react';
import { setAccessToken, signOut, staffApi } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useStaff } from '@/lib/hooks';
import { Field, Modal, Section, useAction } from './ui';
import { Logo } from './brand';

type Status = { enabled: boolean; enabledAt: string | null; required: boolean; recoveryCodesLeft: number };
type Sess = { id: string; userAgent: string | null; ip: string | null; lastActiveAt: string; sharedDevice: boolean; current: boolean };

/** Friendly device name from a user-agent string. */
export function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

function CodeInput({ value, onChange, label = 'Code from your authenticator app' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint="6 digits — or one of your recovery codes">
      <input className="input h-10 font-mono tracking-widest" inputMode="text" autoComplete="one-time-code" maxLength={20} value={value} onChange={(e) => onChange(e.target.value.trim())} autoFocus />
    </Field>
  );
}

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <div className="space-y-3" data-testid="recovery-codes">
      <p className="text-[13px]">Save these recovery codes somewhere safe (a password manager, or printed and locked away). Each works once if you lose your phone. <b>They won’t be shown again.</b></p>
      <pre className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-sm bg-sunk p-3 font-mono text-[13px]">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <a className="btn btn-sm" download="bookez-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>Download</a>
        <button type="button" className="btn btn-sm btn-primary ml-auto" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

/** Enrolment: QR → first code → recovery codes. Swaps in the new (second-factor) session on success. */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const { busy, run } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-[13px]">Two-step sign-in asks for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) whenever you sign in on a new device — so a stolen password alone can’t get in.</p>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { const r = await run(() => staffApi<{ data: { secret: string; qr: string } }>('/auth/mfa/setup', { body: {} })); if (r) setSetup(r.data); }}>Set up two-step sign-in</button>
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => staffApi<{ accessToken: string; recoveryCodes: string[] }>('/auth/mfa/enable', { body: { code } }), 'Two-step sign-in is on');
      if (r) { setAccessToken('staff', r.accessToken); setCodes(r.recoveryCodes); }
    }}>
      <p className="text-[13px]">1. Scan this with your authenticator app.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} className="border border-line" />
      <p className="text-xs text-muted">Can’t scan? Enter this key: <span className="select-all font-mono" data-testid="mfa-secret">{setup.secret}</span></p>
      <p className="text-[13px]">2. Enter the 6-digit code it shows.</p>
      <CodeInput value={code} onChange={setCode} label="6-digit code" />
      <button className="btn btn-primary" disabled={busy || code.length < 6}>Turn on</button>
    </form>
  );
}

/** Full-screen gate for sessions that must set up (or present) a second factor before doing anything else. */
export function MfaGate({ enrolled, onDone, loginPath }: { enrolled: boolean; onDone: () => void; loginPath: string }) {
  const { busy, run } = useAction();
  const [code, setCode] = useState('');
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[420px] space-y-4" data-testid="mfa-gate">
        <p><Logo /></p>
        <h1 className="text-lg font-semibold">{enrolled ? 'Confirm it’s you' : 'Set up two-step sign-in'}</h1>
        <p className="text-[13px] text-muted">{enrolled ? 'Your organisation now requires a second step. Enter a code from your authenticator app.' : 'Your organisation requires two-step sign-in for this account. It takes a minute.'}</p>
        {enrolled ? (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => staffApi<{ accessToken: string }>('/auth/mfa/verify', { body: { code } }));
            if (r) { setAccessToken('staff', r.accessToken); onDone(); }
          }}>
            <CodeInput value={code} onChange={setCode} />
            <button className="btn btn-primary w-full" disabled={busy || code.length < 6}>Continue</button>
          </form>
        ) : <MfaSetup onDone={onDone} />}
        <button className="text-[13px] text-muted underline" onClick={async () => { await signOut('staff'); location.href = loginPath; }}>Sign out</button>
      </div>
    </main>
  );
}

/** "Your account → Security": two-step status and signed-in devices. Used by the hotel admin and the platform console. */
export function AccountSecurity() {
  const { data, mutate } = useStaff<{ data: Status }>('/auth/mfa');
  const { data: sessions, mutate: reloadSessions } = useStaff<{ data: Sess[] }>('/auth/sessions');
  const { busy, run } = useAction();
  const [setting, setSetting] = useState(false);
  const [dialog, setDialog] = useState<null | 'disable' | 'codes'>(null);
  const [form, setForm] = useState({ code: '', password: '' });
  const [codes, setCodes] = useState<string[] | null>(null);
  const s = data?.data;
  return (
    <div className="max-w-3xl bg-panel">
      <Section title="Two-step sign-in">
        {!s ? <p className="text-[13px] text-muted">Loading…</p> : s.enabled ? (
          <div className="space-y-3 text-[13px]" data-testid="mfa-status">
            <p><span className="chip chip-ok mr-2">On</span>since {dateTime(s.enabledAt)} · {s.recoveryCodesLeft} recovery codes left{s.required && ' · required by your organisation'}</p>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => { setForm({ code: '', password: '' }); setCodes(null); setDialog('codes'); }}>New recovery codes</button>
              {!s.required && <button className="btn btn-sm btn-danger" onClick={() => { setForm({ code: '', password: '' }); setDialog('disable'); }}>Turn off</button>}
            </div>
          </div>
        ) : setting ? <MfaSetup onDone={() => { setSetting(false); mutate(); reloadSessions(); }} /> : (
          <div className="space-y-3 text-[13px]">
            <p><span className="chip chip-neutral mr-2">Off</span>Protect your account with a code from your phone at each new sign-in.</p>
            <button className="btn btn-primary" onClick={() => setSetting(true)}>Set up</button>
          </div>
        )}
      </Section>
      <Section title="Where you’re signed in" actions={<button className="btn btn-sm" disabled={busy} onClick={() => run(() => staffApi('/auth/sessions/sign-out-others', { body: {} }), 'Signed out of other devices').then(() => reloadSessions())}>Sign out everywhere else</button>}>
        <ul className="divide-y divide-line text-[13px]" data-testid="sessions">
          {sessions?.data.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2">
              <span>{deviceName(x.userAgent)}{x.sharedDevice && ' · shared device (PIN)'}{x.current && <span className="chip chip-accent ml-2">This device</span>}
                <span className="block text-xs text-muted">Active {dateTime(x.lastActiveAt)}{x.ip && ` · ${x.ip}`}</span></span>
              {!x.current && <button className="btn btn-sm" onClick={() => run(() => staffApi(`/auth/sessions/${x.id}`, { method: 'DELETE' }), 'Signed out').then(() => reloadSessions())}>Sign out</button>}
            </li>
          ))}
        </ul>
      </Section>
      <Modal open={dialog === 'disable'} onClose={() => setDialog(null)} title="Turn off two-step sign-in?"
        footer={<><button className="btn" onClick={() => setDialog(null)}>Keep it on</button><button className="btn btn-danger" disabled={busy} onClick={() => run(() => staffApi('/auth/mfa/disable', { body: form }), 'Two-step sign-in is off').then((r) => { if (r) { setDialog(null); mutate(); } })}>Turn off</button></>}>
        <div className="space-y-3">
          <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <CodeInput value={form.code} onChange={(code) => setForm({ ...form, code })} />
        </div>
      </Modal>
      <Modal open={dialog === 'codes'} onClose={() => setDialog(null)} title="New recovery codes"
        footer={!codes && <button className="btn btn-primary" disabled={busy || form.code.length < 6} onClick={() => run(() => staffApi<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { body: { code: form.code } })).then((r) => { if (r) { setCodes(r.recoveryCodes); mutate(); } })}>Replace codes</button>}>
        {codes ? <RecoveryCodes codes={codes} onDone={() => setDialog(null)} /> : <><p className="mb-3 text-[13px] text-muted">Your old recovery codes stop working.</p><CodeInput value={form.code} onChange={(code) => setForm({ ...form, code })} /></>}
      </Modal>
    </div>
  );
}
