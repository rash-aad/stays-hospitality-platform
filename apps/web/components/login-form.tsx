'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, setAccessToken } from '@/lib/api';
import { useHydrated } from '@/lib/hooks';
import { PLATFORM_URL } from '@/lib/surface';

/** Sign-in for staff (surface "admin") and platform administrators (surface "platform"). */
export function LoginForm({ surface }: { surface: 'admin' | 'platform' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaces, setWorkspaces] = useState<{ slug: string; name: string }[] | null>(null);
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = useHydrated();
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (forgot) {
        await fetch('/api/v1/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
        setSent(true);
        return;
      }
      const r = challenge
        ? await fetch('/api/v1/auth/staff/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge, code }) })
        : await fetch('/api/v1/auth/staff/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, workspace: workspace || undefined }) });
      const j = await r.json();
      if (r.status === 409 && j.error?.code === 'choose_workspace') {
        setWorkspaces(j.error.details.workspaces);
        return;
      }
      if (!r.ok) {
        if (challenge && r.status === 401 && /too long/.test(j.error?.message ?? '')) { setChallenge(null); setCode(''); }
        throw new ApiError(r.status, j.error?.code, j.error?.message ?? 'Sign-in failed');
      }
      if (j.mfaRequired) {
        setChallenge(j.challenge);
        return;
      }
      // Each console only accepts its own accounts; the wrong kind is signed straight back out.
      const wrong = surface === 'platform' ? j.kind !== 'platform' : j.kind === 'platform' && !!PLATFORM_URL;
      if (wrong) {
        await fetch(`/api/v1/auth/logout?aud=${j.kind === 'platform' ? 'platform' : 'staff'}`, { method: 'POST', headers: { 'x-csrf': '1' } }).catch(() => {});
        throw new Error(surface === 'platform' ? 'This console is for platform administrators. Hotel staff sign in at /admin/login.' : `Platform administrators sign in at ${PLATFORM_URL}`);
      }
      setAccessToken('staff', j.accessToken);
      router.replace(j.kind === 'platform' ? '/platform' : '/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{challenge ? 'Two-step sign-in' : forgot ? 'Reset your password' : 'Sign in'}</h1>
        <p className="mt-1 text-[13px] text-muted">{forgot ? 'We’ll email you a link to choose a new password.' : surface === 'platform' ? 'Platform administrators only.' : PLATFORM_URL ? 'Hotel staff accounts.' : 'Staff and platform accounts.'}</p>
      </div>
      {challenge ? (
        <>
          <p className="text-[13px] text-muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
          <label className="block"><span className="label">Verification code</span><input className="input h-10 font-mono tracking-widest" autoComplete="one-time-code" inputMode="text" maxLength={20} required autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} /></label>
          {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg w-full" disabled={busy || !ready || code.length < 6}>{busy ? 'Please wait…' : 'Verify'}</button>
        </>
      ) : sent ? (
        <p className="rounded-sm border border-line bg-panel px-3 py-2.5 text-[13px]">If that email belongs to an account, a reset link is on its way.</p>
      ) : (
        <>
          <label className="block"><span className="label">Email</span><input className="input h-10" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {!forgot && <label className="block"><span className="label">Password</span><input className="input h-10" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
          {workspaces && (
            <label className="block">
              <span className="label">Workspace</span>
              <select className="input h-10" required value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
                <option value="">Choose a property…</option>
                {workspaces.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="text-[13px] text-bad" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg w-full" disabled={busy || !ready}>{busy ? 'Please wait…' : forgot ? 'Send reset link' : 'Sign in'}</button>
        </>
      )}
      {challenge ? (
        <button type="button" className="text-[13px] text-muted underline underline-offset-2" onClick={() => { setChallenge(null); setCode(''); setError(null); }}>Back</button>
      ) : (
        <button type="button" className="text-[13px] text-muted underline underline-offset-2" onClick={() => { setForgot(!forgot); setSent(false); setError(null); }}>
          {forgot ? 'Back to sign in' : 'Forgot your password?'}
        </button>
      )}
    </form>
  );
}
