'use client';

import { useState } from 'react';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Tpl = { key: string; default: { subject: string; body: string; sms?: string }; variables: string[]; overrides: { channel: string; subject: string | null; body: string; active: boolean }[] };

export default function Notifications() {
  const { data, error, mutate } = useStaff<{ data: Tpl[] }>('/admin/notification-templates');
  const [e, setE] = useState<{ t: Tpl; channel: string; subject: string; body: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const open = (t: Tpl, channel: string) => { const o = t.overrides.find((x) => x.channel === channel); setPreview(null); setE({ t, channel, subject: o?.subject ?? t.default.subject, body: o?.body ?? (channel === 'email' ? t.default.body : t.default.sms ?? t.default.body) }); };
  return (
    <>
      <PageHeader title="Notifications" sub="The messages guests and staff receive. Edit the wording in your own voice; {{placeholders}} are filled in automatically." />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <div className="bg-panel">
          <table className="tbl">
            <thead><tr><th>Message</th><th>Email</th><th>SMS</th><th>WhatsApp</th></tr></thead>
            <tbody>{data.data.map((t) => (
              <tr key={t.key}>
                <td><p className="font-medium">{human(t.key.replace('.', ' — '))}</p><p className="max-w-lg truncate text-xs text-muted">{t.default.subject}</p></td>
                {['email', 'sms', 'whatsapp'].map((ch) => <td key={ch}><button className="btn btn-sm" onClick={() => open(t, ch)}>{t.overrides.some((o) => o.channel === ch) ? 'Customised' : 'Default'}</button></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!e} onClose={() => setE(null)} title={e ? `${human(e.t.key.replace('.', ' — '))} · ${e.channel}` : ''}
        footer={e && <>{e.t.overrides.some((o) => o.channel === e.channel) && <button className="btn mr-auto" onClick={() => run(() => staffApi(`/admin/notification-templates/${e.t.key}/${e.channel}`, { method: 'DELETE' }), 'Back to default').then(() => { setE(null); mutate(); })}>Use default</button>}<button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi<{ data: { preview: string } }>(`/admin/notification-templates/${e.t.key}/${e.channel}`, { method: 'PUT', body: { subject: e.channel === 'email' ? e.subject : null, body: e.body } }), 'Template saved').then((r) => { if (r) { setPreview(r.data.preview); mutate(); } })}>Save</button></>}>
        {e && (
          <Section>
            {e.channel === 'email' && <Field label="Subject"><input className="input" value={e.subject} onChange={(x) => setE({ ...e, subject: x.target.value })} /></Field>}
            <Field label="Message" className="mt-3"><textarea className="input font-mono text-xs" rows={10} value={e.body} onChange={(x) => setE({ ...e, body: x.target.value })} /></Field>
            <p className="hint mt-2">Available: {e.t.variables.map((v) => <code key={v} className="mr-1.5 rounded-sm bg-sunk px-1">{`{{${v}}}`}</code>)}</p>
            {preview && <><p className="eyebrow mt-4 mb-1">Preview</p><pre className="whitespace-pre-wrap rounded-sm border border-line bg-canvas p-3 text-[13px]">{preview}</pre></>}
          </Section>
        )}
      </Drawer>
    </>
  );
}
