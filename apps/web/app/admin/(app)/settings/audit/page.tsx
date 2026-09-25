'use client';

import { Fragment, useState } from 'react';
import { Empty, ErrorNote, Loading, PageHeader, Pager } from '@/components/ui';
import { dateTime, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Log = { id: string; action: string; entityType: string | null; entityId: string | null; changes: Record<string, unknown> | null; actorName: string | null; actorType: string; ip: string | null; createdAt: string };

export default function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, error } = useStaff<{ data: Log[]; meta: { page: number; pages: number; total: number } }>(`/admin/audit?page=${page}&pageSize=50${action ? `&action=${action}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Audit log" sub="Every sensitive action — who, what and when."
        actions={<select className="input w-52" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All actions</option>{['payment', 'booking', 'module', 'staff', 'role', 'page', 'site', 'auth', 'tenant', 'domain', 'payment_settings'].map((a) => <option key={a} value={a}>{human(a)}</option>)}</select>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="Nothing recorded yet" /> : (
        <div className="bg-panel">
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>IP</th></tr></thead>
            <tbody>{data.data.map((l) => (
              <Fragment key={l.id}>
                <tr className="is-link" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="whitespace-nowrap text-muted">{dateTime(l.createdAt)}</td>
                  <td>{l.actorName ?? human(l.actorType)}</td>
                  <td className="font-mono text-xs">{l.action}</td>
                  <td className="text-xs text-muted">{l.entityType && human(l.entityType)} <span className="font-mono">{l.entityId?.slice(0, 8)}</span></td>
                  <td className="font-mono text-xs text-muted">{l.ip}</td>
                </tr>
                {open === l.id && l.changes && <tr><td colSpan={5}><pre className="overflow-x-auto rounded-sm bg-canvas p-3 text-xs">{JSON.stringify(l.changes, null, 2)}</pre></td></tr>}
              </Fragment>
            ))}</tbody>
          </table>
          <Pager meta={data.meta} onPage={setPage} />
        </div>
      )}
    </>
  );
}
