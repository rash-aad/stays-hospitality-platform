'use client';

import { useState } from 'react';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type I = { kind: string; provider: string; name: string; fields: string[]; connected: boolean; status: string | null; publicConfig: Record<string, string>; hasSecrets: boolean };
const SECRET = new Set(['apiKey', 'authKey', 'secret']);

export default function Integrations() {
  const { data, error, mutate } = useStaff<{ data: I[] }>('/admin/integrations');
  const [e, setE] = useState<{ i: I; v: Record<string, string> } | null>(null);
  const { busy, run } = useAction();
  return (
    <>
      <PageHeader title="Integrations" sub="Connect the systems you already use. Keys are stored encrypted and never shown again." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <ul className="divide-y divide-line bg-panel">
          {data.data.map((i) => (
            <li key={`${i.kind}:${i.provider}`} className="flex items-center justify-between gap-4 px-6 py-3.5">
              <div><p className="text-[13px] font-medium">{i.name}</p><p className="text-xs text-muted">{human(i.kind)}</p></div>
              <div className="flex items-center gap-3">{i.connected && <Status value={i.status ?? 'active'} label={i.status === 'active' ? 'Connected' : human(i.status)} />}<button className="btn btn-sm" onClick={() => setE({ i, v: { ...i.publicConfig } })}>{i.connected ? 'Manage' : 'Connect'}</button></div>
            </li>
          ))}
        </ul>
      )}
      <Drawer open={!!e} onClose={() => setE(null)} title={e?.i.name ?? ''}
        footer={e && <>{e.i.connected && <button className="btn btn-danger mr-auto" onClick={() => run(() => staffApi(`/admin/integrations/${e.i.kind}/${e.i.provider}`, { method: 'DELETE' }), 'Disconnected').then(() => { setE(null); mutate(); })}>Disconnect</button>}<button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi(`/admin/integrations/${e.i.kind}/${e.i.provider}`, { method: 'PUT', body: { config: Object.fromEntries(Object.entries(e.v).filter(([, x]) => x)), status: 'active' } }), 'Saved').then(() => { setE(null); mutate(); })}>Save</button></>}>
        {e && <Section>{e.i.fields.map((f) => <Field key={f} label={human(f.replace(/([A-Z])/g, '_$1').toLowerCase())} hint={SECRET.has(f) && e.i.hasSecrets ? 'Saved — leave blank to keep' : undefined} className="mb-3"><input className="input font-mono" type={SECRET.has(f) ? 'password' : 'text'} autoComplete="off" value={e.v[f] ?? ''} onChange={(x) => setE({ ...e, v: { ...e.v, [f]: x.target.value } })} /></Field>)}</Section>}
      </Drawer>
    </>
  );
}
