'use client';

import { useState } from 'react';
import { useCan } from '@/components/admin-context';
import { ErrorNote, Field, Loading, Modal, PageHeader, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { isoToday, money } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Day = { date: string; total: number; booked: number; closed: boolean; closedToArrival: boolean; minStay: number | null; price: number | null };
type Resp = { data: { dates: string[]; roomTypes: { id: string; name: string; days: Day[] }[] } };
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function Calendar() {
  const [from, setFrom] = useState(isoToday());
  const { data, error, mutate } = useStaff<Resp>(`/admin/availability?from=${from}&days=21`);
  const can = useCan();
  const [edit, setEdit] = useState<{ roomTypeId: string; name: string; from: string; to: string } | null>(null);
  const [form, setForm] = useState<{ action: string; minStay: string; total: string }>({ action: 'close', minStay: '', total: '' });
  const { busy, run } = useAction();
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`);

  return (
    <>
      <PageHeader title="Rates & availability" sub="Rooms left per night, with the lowest public rate. Click a cell to close sales or set restrictions."
        actions={<><button className="btn" onClick={() => setFrom(addDays(from, -7))}>← Week</button><input className="input w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><button className="btn" onClick={() => setFrom(addDays(from, 7))}>Week →</button></>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : (
        <div className="overflow-x-auto bg-panel">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-44 border-r border-b border-line bg-panel px-3 py-2 text-left font-medium text-muted">Room type</th>
                {data.data.dates.map((d) => {
                  const wd = fmt(d).getUTCDay();
                  return <th key={d} className={cx('min-w-[64px] border-b border-r border-line px-1 py-1.5 text-center font-normal', (wd === 5 || wd === 6) && 'bg-sunk')}>
                    <span className="block text-2xs text-muted">{fmt(d).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
                    <span className="num block font-medium">{fmt(d).getUTCDate()}</span>
                  </th>;
                })}
              </tr>
            </thead>
            <tbody>
              {data.data.roomTypes.map((rt) => (
                <tr key={rt.id}>
                  <td className="sticky left-0 z-10 border-r border-b border-line bg-panel px-3 py-2 text-[13px] font-medium">{rt.name}</td>
                  {rt.days.map((d) => {
                    const left = d.total - d.booked;
                    return (
                      <td key={d.date} className="border-r border-b border-line p-0">
                        <button disabled={!can.perm('property.manage')} onClick={() => { setEdit({ roomTypeId: rt.id, name: rt.name, from: d.date, to: d.date }); setForm({ action: d.closed ? 'open' : 'close', minStay: String(d.minStay ?? ''), total: String(d.total) }); }}
                          className={cx('block h-14 w-full px-1 text-center hover:outline hover:outline-1 hover:outline-ink', d.closed ? 'bg-bad-soft text-bad' : left === 0 ? 'bg-sunk text-muted' : left <= 1 ? 'bg-warn-soft' : '')}>
                          <span className="num block text-[13px] font-medium">{d.closed ? 'Closed' : left}</span>
                          <span className="num block text-2xs text-muted">{d.price ? money(d.price).replace('₹', '₹ ') : ''}</span>
                          {(d.minStay || d.closedToArrival) && <span className="block text-2xs">{d.minStay ? `min ${d.minStay}` : ''}{d.closedToArrival ? ' CTA' : ''}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">Numbers show rooms left to sell. Tinted: one room left. CTA = closed to arrival.</p>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.name}` : ''}
        footer={<><button className="btn" onClick={() => setEdit(null)}>Close</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => staffApi('/admin/availability', { method: 'PATCH', body: {
          roomTypeId: edit!.roomTypeId, from: edit!.from, to: edit!.to,
          ...(form.action === 'close' ? { closed: true } : form.action === 'open' ? { closed: false, closedToArrival: false } : form.action === 'cta' ? { closedToArrival: true } : {}),
          ...(form.minStay ? { minStay: Number(form.minStay) } : { minStay: null }),
          ...(form.total ? { total: Number(form.total) } : {}),
        } }), 'Availability updated').then((r) => { if (r) { mutate(); setEdit(null); } })}>Apply</button></>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input className="input" type="date" value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value })} /></Field>
              <Field label="To (inclusive)"><input className="input" type="date" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} /></Field>
            </div>
            <Field label="Sales"><select className="input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}><option value="close">Close to sale</option><option value="open">Open for sale</option><option value="cta">Closed to arrival</option><option value="keep">No change</option></select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum stay" hint="Leave blank for none"><input className="input" type="number" min={1} value={form.minStay} onChange={(e) => setForm({ ...form, minStay: e.target.value })} /></Field>
              <Field label="Rooms to sell" hint="Never below rooms already sold"><input className="input" type="number" min={0} value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
