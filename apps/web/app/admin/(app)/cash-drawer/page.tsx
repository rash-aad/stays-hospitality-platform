'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { ErrorNote, Field, Loading, Modal, PageHeader, Section, Status, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { dateTime, money, toMinor } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Totals = { openingFloat: number; cashTaken: number; cashPayments: number; cashRefunds: number; paidIn: number; paidOut: number; drops: number; otherTenders: number; expected: number };
type Shift = { id: string; status: string; openingFloat: number; openedAt: string; closedAt: string | null; expectedCash: number | null; countedCash: number | null; variance: number | null; notes: string | null; user?: string; totals: Totals | null; movements?: { id: string; kind: string; amount: number; reason: string; createdAt: string }[] };
const KIND = { paid_out: 'Paid out', paid_in: 'Paid in', drop: 'Safe drop' } as const;

export default function CashDrawer() {
  const { data, error, mutate } = useStaff<{ data: Shift | null }>('/admin/shifts/current');
  const can = useCan();
  const { data: history, mutate: reloadHistory } = useStaff<{ data: Shift[] }>(can.perm('payments.read') ? '/admin/shifts' : null);
  const { busy, run } = useAction();
  const [float, setFloat] = useState('');
  const [move, setMove] = useState<null | { kind: keyof typeof KIND; amount: string; reason: string }>(null);
  const [count, setCount] = useState({ counted: '', notes: '' });
  if (!data) return <><PageHeader title="Cash drawer" /><ErrorNote error={error} /><Loading /></>;
  const s = data.data;
  const refresh = () => { mutate(); reloadHistory(); };
  const variance = s?.totals && count.counted !== '' ? toMinor(count.counted) - s.totals.expected : null;
  return (
    <>
      <PageHeader title="Cash drawer" sub="Open your drawer with its float at the start of a shift. Cash you record against bookings is counted here; count up and close at the end." />
      <div className="max-w-3xl bg-panel">
        {!s ? (
          <Section title="Open your drawer">
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/shifts', { body: { openingFloat: toMinor(float || '0') } }), 'Drawer open').then((r) => { if (r) { setFloat(''); refresh(); } }); }}>
              <Field label="Opening float (₹)" hint="The change in the drawer now"><input className="input num w-40" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} /></Field>
              <button className="btn btn-primary" disabled={busy}>Open drawer</button>
            </form>
          </Section>
        ) : (
          <>
            <Section title={`Drawer open since ${dateTime(s.openedAt)}`} actions={<span className="flex gap-2">{(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => <button key={k} className="btn btn-sm" onClick={() => setMove({ kind: k, amount: '', reason: '' })}>{KIND[k]}</button>)}</span>}>
              {s.totals && (
                <table className="w-full max-w-md text-[13px]" data-testid="drawer-totals"><tbody>
                  <tr><td className="py-0.5 text-muted">Opening float</td><td className="num text-right">{money(s.totals.openingFloat)}</td></tr>
                  <tr><td className="py-0.5 text-muted">Cash taken ({s.totals.cashPayments})</td><td className="num text-right">+{money(s.totals.cashTaken)}</td></tr>
                  {s.totals.paidIn > 0 && <tr><td className="py-0.5 text-muted">Paid in</td><td className="num text-right">+{money(s.totals.paidIn)}</td></tr>}
                  {s.totals.cashRefunds > 0 && <tr><td className="py-0.5 text-muted">Cash refunds</td><td className="num text-right">−{money(s.totals.cashRefunds)}</td></tr>}
                  {s.totals.paidOut > 0 && <tr><td className="py-0.5 text-muted">Paid out</td><td className="num text-right">−{money(s.totals.paidOut)}</td></tr>}
                  {s.totals.drops > 0 && <tr><td className="py-0.5 text-muted">Safe drops</td><td className="num text-right">−{money(s.totals.drops)}</td></tr>}
                  <tr className="border-t border-line font-medium"><td className="pt-1">Should be in the drawer</td><td className="num pt-1 text-right" data-testid="expected-cash">{money(s.totals.expected)}</td></tr>
                  <tr><td className="py-0.5 text-muted">Card / UPI / transfer taken (not in drawer)</td><td className="num text-right">{money(s.totals.otherTenders)}</td></tr>
                </tbody></table>
              )}
              {s.movements && s.movements.length > 0 && <ul className="mt-3 space-y-0.5 text-xs text-muted">{s.movements.map((m) => <li key={m.id}>{dateTime(m.createdAt)} · {KIND[m.kind as keyof typeof KIND]} {money(m.amount)} — {m.reason}</li>)}</ul>}
            </Section>
            <Section title="Count up and close">
              <form className="grid max-w-md grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); run(() => staffApi('/admin/shifts/current/close', { body: { countedCash: toMinor(count.counted), notes: count.notes || undefined } }), 'Drawer closed').then((r) => { if (r) { setCount({ counted: '', notes: '' }); refresh(); } }); }}>
                <Field label="Cash counted (₹)"><input className="input num" inputMode="decimal" value={count.counted} onChange={(e) => setCount({ ...count, counted: e.target.value })} /></Field>
                <div className="self-end pb-2 text-[13px]">{variance !== null && (variance === 0 ? <span className="text-ok">Balanced</span> : <span className={variance < 0 ? 'text-bad' : 'text-warn'}>{variance < 0 ? 'Short' : 'Over'} {money(Math.abs(variance))}</span>)}</div>
                {variance !== null && variance !== 0 && <Field label="Why doesn’t it match?" className="col-span-2"><input className="input" value={count.notes} onChange={(e) => setCount({ ...count, notes: e.target.value })} /></Field>}
                <button className="btn btn-primary col-span-2 justify-self-start" disabled={busy || count.counted === '' || (variance !== 0 && !count.notes.trim())}>Close drawer</button>
              </form>
            </Section>
          </>
        )}
        {history && history.data.length > 0 && (
          <Section title="Recent shifts">
            <table className="tbl"><thead><tr><th>Cashier</th><th>Opened</th><th>Status</th><th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Over / short</th></tr></thead>
              <tbody>{history.data.map((h) => (
                <tr key={h.id}><td>{h.user}</td><td className="text-muted">{dateTime(h.openedAt)}</td><td><Status value={h.status === 'open' ? 'open' : 'closed'} /></td>
                  <td className="num text-right">{money(h.expectedCash ?? h.totals?.expected ?? 0)}</td><td className="num text-right">{h.countedCash != null ? money(h.countedCash) : '—'}</td>
                  <td className={`num text-right ${h.variance ? (h.variance < 0 ? 'text-bad' : 'text-warn') : ''}`} title={h.notes ?? ''}>{h.variance != null ? (h.variance === 0 ? '—' : `${h.variance < 0 ? '−' : '+'}${money(Math.abs(h.variance))}`) : ''}</td></tr>
              ))}</tbody></table>
          </Section>
        )}
      </div>
      <Modal open={!!move} onClose={() => setMove(null)} title={move ? KIND[move.kind] : ''}
        footer={move && <button className="btn btn-primary" disabled={busy || !move.amount || move.reason.trim().length < 2} onClick={() => run(() => staffApi('/admin/shifts/current/movements', { body: { kind: move.kind, amount: toMinor(move.amount), reason: move.reason } }), 'Recorded').then((r) => { if (r) { setMove(null); refresh(); } })}>Record</button>}>
        {move && <div className="space-y-3"><Field label="Amount (₹)"><input className="input num" inputMode="decimal" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} /></Field><Field label="Reason"><input className="input" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder={move.kind === 'drop' ? 'Safe drop' : move.kind === 'paid_out' ? 'Flowers for the lobby' : 'Change from the office'} /></Field></div>}
      </Modal>
    </>
  );
}
