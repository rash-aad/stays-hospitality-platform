'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { DayFigures, type DaySummary } from '@/components/day-figures';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date as fmt, dateTime, money } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Item = { id: string; reference: string; guestName: string; checkIn?: string; checkOut?: string };
type State = {
  date: string; today: string; lastClosed: string | null; canClose: boolean; preview: DaySummary | null;
  checks: { arrivalsPending: Item[]; departuresPending: Item[]; paymentsToVerify: number; openOrders: number; openShifts: { id: string; user: string; openedAt: string }[] };
};
type Day = { id: string; date: string; closedAt: string; closedBy: string | null; summary: DaySummary; notes: string | null };

export default function NightAudit() {
  const { data, error, mutate } = useStaff<{ data: State }>('/admin/night-audit');
  const can = useCan();
  const { data: days, mutate: reloadDays } = useStaff<{ data: Day[] }>(can.perm('reports.read') ? '/admin/night-audit/days' : null);
  const { busy, run } = useAction();
  const [noShows, setNoShows] = useState<'mark' | 'keep' | ''>('');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState<Day | null>(null);
  if (!data) return <><PageHeader title="Night audit" /><ErrorNote error={error} /><Loading /></>;
  const s = data.data;
  const c = s.checks;
  const blocking = c.departuresPending.length > 0 || (c.arrivalsPending.length > 0 && !noShows);
  return (
    <>
      <PageHeader title="Night audit" sub={s.canClose ? `Close ${fmt(s.date, 'long')} once today’s work is done. The day’s figures are saved and emailed to the owner.` : `${fmt(s.lastClosed!, 'long')} is closed. The next audit is for ${fmt(s.date, 'long')}.`} />
      <div className="max-w-4xl bg-panel">
        {s.canClose && (
          <>
            <Section title="Before you close">
              <ul className="space-y-3 text-[13px]" data-testid="audit-checks">
                <li>
                  <p className={c.departuresPending.length ? 'font-medium text-bad' : ''}>{c.departuresPending.length ? `${c.departuresPending.length} guest(s) due to leave are still checked in` : '✓ Every departure is checked out'}</p>
                  {c.departuresPending.map((d) => <p key={d.id} className="text-muted">{d.guestName} · <span className="font-mono">{d.reference}</span> · due {fmt(d.checkOut!, 'short')} — check out or extend in <Link className="underline" href="/admin/reservations?view=departures">Reservations</Link></p>)}
                </li>
                <li>
                  <p className={c.arrivalsPending.length ? 'font-medium' : ''}>{c.arrivalsPending.length ? `${c.arrivalsPending.length} expected guest(s) haven’t arrived` : '✓ Every arrival is checked in'}</p>
                  {c.arrivalsPending.map((a) => <p key={a.id} className="text-muted">{a.guestName} · <span className="font-mono">{a.reference}</span> · due {fmt(a.checkIn!, 'short')}</p>)}
                  {c.arrivalsPending.length > 0 && (
                    <div className="mt-1 flex gap-4">
                      <label className="flex items-center gap-2"><input type="radio" name="ns" checked={noShows === 'mark'} onChange={() => setNoShows('mark')} /> Mark as no-shows (rooms released)</label>
                      <label className="flex items-center gap-2"><input type="radio" name="ns" checked={noShows === 'keep'} onChange={() => setNoShows('keep')} /> Keep — arriving late</label>
                    </div>
                  )}
                </li>
                <li className={c.paymentsToVerify ? 'text-warn' : ''}>{c.paymentsToVerify ? <>{c.paymentsToVerify} UPI payment(s) waiting for verification — <Link className="underline" href="/admin/payments">verify</Link></> : '✓ No payments waiting'}</li>
                <li className={c.openOrders ? 'text-warn' : ''}>{c.openOrders ? `${c.openOrders} kitchen order(s) still open` : '✓ No open kitchen orders'}</li>
                <li className={c.openShifts.length ? 'text-warn' : ''}>{c.openShifts.length ? `Open cash drawers: ${c.openShifts.map((x) => x.user).join(', ')}` : '✓ All cash drawers closed'}</li>
              </ul>
            </Section>
            {s.preview && <Section title={`${fmt(s.date, 'long')} so far`}><DayFigures s={s.preview} /></Section>}
            <Section>
              <Field label="Notes for the day (optional)"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Water outage 2–4 pm; group from Infosys arrives tomorrow" /></Field>
              <button className="btn btn-primary mt-3" disabled={busy || blocking} onClick={() => run(() => staffApi('/admin/night-audit/close', { body: { date: s.date, noShows: noShows || undefined, notes: notes || undefined } }), `${fmt(s.date, 'short')} closed — report sent`).then((r) => { if (r) { setNotes(''); setNoShows(''); mutate(); reloadDays(); } })}>Close {fmt(s.date, 'short')}</button>
              {blocking && <p className="mt-2 text-xs text-muted">Resolve the items above first.</p>}
            </Section>
          </>
        )}
        {days && (
          <Section title="Closed days">
            {days.data.length === 0 ? <p className="text-[13px] text-muted">No days closed yet.</p> : (
              <table className="tbl"><thead><tr><th>Date</th><th className="text-right">Occupancy</th><th className="text-right">ADR</th><th className="text-right">Revenue</th><th>Closed by</th></tr></thead>
                <tbody>{days.data.map((d) => (
                  <tr key={d.id} className="is-link" onClick={() => setOpen(d)}>
                    <td>{fmt(d.date)}</td><td className="num text-right">{Math.round(d.summary.rooms.occupancy * 100)}%</td><td className="num text-right">{money(d.summary.rooms.adr)}</td><td className="num text-right">{money(d.summary.revenue.total)}</td><td className="text-muted">{d.closedBy} · {dateTime(d.closedAt)}</td>
                  </tr>
                ))}</tbody></table>
            )}
          </Section>
        )}
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? fmt(open.date, 'long') : ''} sub={open && `Closed by ${open.closedBy} · ${dateTime(open.closedAt)}`} width={640}>
        {open && <div className="p-5">{open.notes && <p className="mb-4 border-l-2 border-line pl-3 text-[13px]">{open.notes}</p>}<DayFigures s={open.summary} /></div>}
      </Drawer>
    </>
  );
}
