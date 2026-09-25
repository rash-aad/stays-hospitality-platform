'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function SetPasswordForm({ endpoint, title, done }: { endpoint: string; title: string; done: string }) {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setError('Passwords don’t match');
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
    if (!r.ok) return setError((await r.json()).error?.message ?? 'Something went wrong');
    setOk(true);
    setTimeout(() => router.replace('/admin/login'), 1500);
  }
  if (!token) return <p className="text-[13px] text-bad">This link is incomplete.</p>;
  return ok ? <p className="text-[13px]">{done}</p> : (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <label className="block"><span className="label">New password</span><input className="input h-10" type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} /><span className="hint block">At least 10 characters, with letters and numbers.</span></label>
      <label className="block"><span className="label">Repeat password</span><input className="input h-10" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <button className="btn btn-primary btn-lg w-full">Save password</button>
    </form>
  );
}
