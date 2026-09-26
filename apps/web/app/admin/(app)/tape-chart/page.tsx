'use client';

import { useMemo, useRef, useState } from 'react';
import { useCan } from '@/components/admin-context';
import { BookingDrawer } from '@/components/booking-drawer';
import { ErrorNote, Field, Loading, Modal, PageHeader, Segmented, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { date as fmtDate, isoToday, money } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Room = { id: string; number: string; floor: string | null; roomTypeId: string; status: string; housekeepingStatus: string };
type RT = { id: string; name: string; rooms: Room[]; availability: Record<string, { left: number; closed: boolean }> };
type Bar = { bookingId: string; reference: string; status: string; paymentStatus: string; checkIn: string; checkOut: string; adults: number; children: number; source: string; total: number; amountPaid: number; guestName: string; roomTypeId: string; roomId: string | null };
type Block = { id: string; roomTypeId: string; startDate: string; endDate: string; summary: string | null; status: string };
type Chart = { from: string; to: string; today: string; days: string[]; roomTypes: RT[]; bars: Bar[]; blocks: Block[] };
type Move = { bar: Bar; roomId: string | null; checkIn: string; checkOut: string; pricing: 'reprice' | 'keep' };

const W = 44; // px per night
const LABEL = 132;
const ROW = 34;
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const TONE: Record<string, string> = {
  pending_payment: 'bg-warn-soft text-warn border-warn/40', confirmed: 'bg-accent-soft text-accent border-accent/40',
  checked_in: 'bg-ok-soft text-ok border-ok/50', checked_out: 'bg-sunk text-muted border-line-strong',
};

/** Pack unassigned bars of one room type into as few lanes as possible. */
function lanes<T extends { start: string; end: string }>(items: T[]) {
  const out: T[][] = [];
  for (const it of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    const lane = out.find((l) => l[l.length - 1]!.end <= it.start);
    if (lane) lane.push(it); else out.push([it]);
  }
  return out;
}

export default function TapeChart() {
  const [from, setFrom] = useState(() => addDays(isoToday(), -1));
  const [days, setDays] = useState<'7' | '14' | '28'>('14');
  const { data, error, mutate } = useStaff<{ data: Chart }>(`/admin/tape-chart?from=${from}&days=${days}`);
  const can = useCan();
  const write = can.perm('bookings.write');
  const [open, setOpen] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [drag, setDrag] = useState<null | { bar: Bar; mode: 'move' | 'resize'; x0: number; dx: number; roomId: string | null }>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { busy, run } = useAction();
  const c = data?.data;

  const allRooms = useMemo(() => c?.roomTypes.flatMap((t) => t.rooms.map((r) => ({ ...r, typeName: t.name }))) ?? [], [c]);

  function startDrag(e: React.PointerEvent, bar: Bar, mode: 'move' | 'resize') {
    if (!write || bar.status === 'checked_out' || e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ bar, mode, x0: e.clientX, dx: 0, roomId: bar.roomId });
  }
  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset.roomRow) as HTMLElement | undefined;
    setDrag({ ...drag, dx: e.clientX - drag.x0, roomId: drag.mode === 'move' && hit ? hit.dataset.roomRow! : drag.roomId });
  }
  function endDrag() {
    if (!drag) return;
    const shift = Math.round(drag.dx / W);
    const { bar } = drag;
    setDrag(null);
    const inHouse = bar.status === 'checked_in';
    let checkIn = bar.checkIn, checkOut = bar.checkOut;
    if (drag.mode === 'resize') checkOut = addDays(bar.checkOut, shift);
    else if (!inHouse) { checkIn = addDays(bar.checkIn, shift); checkOut = addDays(bar.checkOut, shift); }
    if (checkOut <= checkIn) checkOut = addDays(checkIn, 1);
    const roomId = drag.roomId === 'unassigned' ? null : drag.roomId;
    if (roomId === bar.roomId && checkIn === bar.checkIn && checkOut === bar.checkOut) { if (Math.abs(drag.dx) < 4) setOpen(bar.bookingId); return; }
    setMove({ bar, roomId, checkIn, checkOut, pricing: 'reprice' });
  }

  const submitMove = (m: Move) => {
    const body: Record<string, unknown> = { pricing: m.pricing };
    if (m.roomId !== m.bar.roomId && m.roomId) body.roomId = m.roomId;
    if (m.checkIn !== m.bar.checkIn) body.checkIn = m.checkIn;
    if (m.checkOut !== m.bar.checkOut) body.checkOut = m.checkOut;
    return run(() => staffApi(`/admin/bookings/${m.bar.bookingId}/move`, { body }), 'Booking moved').then((r) => { if (r) { setMove(null); mutate(); } });
  };

  /** Stays run from mid-day on arrival to mid-day on departure (hotel convention), clipped to the window. */
  const barStyle = (b: { checkIn: string; checkOut: string }) => {
    const n = c!.days.length;
    const s0 = diff(c!.from, b.checkIn), e0 = diff(c!.from, b.checkOut);
    const left = s0 < 0 ? 0 : s0 * W + W / 2;
    const right = e0 >= n ? n * W : e0 * W + W / 2;
    return { left, width: Math.max(W / 2, right - left - 2) };
  };

  function renderBar(b: Bar) {
    const dragging = drag?.bar.bookingId === b.bookingId;
    const style = barStyle(b);
    const shift = dragging ? drag!.dx : 0;
    return (
      <div key={b.bookingId} role="button" tabIndex={0} aria-label={`${b.guestName}, ${b.reference}, ${fmtDate(b.checkIn, 'short')} to ${fmtDate(b.checkOut, 'short')}`}
        data-testid={`bar-${b.reference}`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(b.bookingId); } }}
        onClick={() => { if (!write || b.status === 'checked_out') setOpen(b.bookingId); }}
        onPointerDown={(e) => startDrag(e, b, 'move')} onPointerMove={onMove} onPointerUp={endDrag}
        className={cx('absolute top-1 flex h-[26px] touch-none items-center overflow-hidden rounded-[3px] border px-1.5 text-[12px] whitespace-nowrap select-none', TONE[b.status], write && b.status !== 'checked_out' ? 'cursor-grab' : 'cursor-pointer', dragging && 'z-20 opacity-80 shadow-md')}
        style={{ left: style.left + (dragging && drag!.mode === 'move' && b.status !== 'checked_in' ? shift : 0), width: style.width + (dragging && drag!.mode === 'resize' ? shift : 0) }}>
        <span className="truncate">{b.guestName}</span>
        {b.paymentStatus !== 'paid' && b.status !== 'checked_out' && <span className="ml-1 text-[10px] opacity-70">₹</span>}
        {write && b.status !== 'checked_out' && <span aria-hidden onPointerDown={(e) => startDrag(e, b, 'resize')} className="absolute top-0 right-0 h-full w-2 cursor-ew-resize" />}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Tape chart" sub="Drag a stay to another room or other dates, drag its end to extend. Click it for details."
        actions={<>
          <button className="btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier">←</button>
          <button className="btn" onClick={() => setFrom(addDays(isoToday(), -1))}>Today</button>
          <button className="btn" onClick={() => setFrom(addDays(from, 7))} aria-label="Later">→</button>
          <Segmented value={days} onChange={setDays} items={[{ value: '7', label: 'Week' }, { value: '14', label: '2 weeks' }, { value: '28', label: '4 weeks' }]} />
        </>} />
      <ErrorNote error={error} />
      {!c ? <Loading /> : (
        <div className="overflow-x-auto bg-panel" ref={grid} data-testid="tape-chart">
          <div style={{ width: LABEL + c.days.length * W }} className="relative">
            {/* Day header */}
            <div className="sticky top-0 z-10 flex border-b border-line bg-panel">
              <div style={{ width: LABEL }} className="sticky left-0 z-10 shrink-0 bg-panel" />
              {c.days.map((d) => {
                const dt = new Date(`${d}T00:00:00Z`);
                const wk = dt.getUTCDay() === 5 || dt.getUTCDay() === 6;
                return <div key={d} style={{ width: W }} className={cx('shrink-0 border-l border-line py-1 text-center text-[11px] leading-tight', d === c.today && 'bg-accent-soft font-semibold text-accent', wk && d !== c.today && 'bg-sunk/60')}>
                  <span className="block text-muted">{dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2)}</span>{dt.getUTCDate()}
                </div>;
              })}
            </div>
            {c.roomTypes.map((t) => {
              const unassigned = c.bars.filter((b) => b.roomTypeId === t.id && !b.roomId);
              const chan = c.blocks.filter((b) => b.roomTypeId === t.id);
              const laneItems = lanes([...unassigned.map((b) => ({ start: b.checkIn, end: b.checkOut, bar: b })), ...chan.map((b) => ({ start: b.startDate, end: b.endDate, block: b }))]);
              return (
                <section key={t.id}>
                  <div className="flex border-b border-line bg-sunk/70">
                    <div style={{ width: LABEL }} className="sticky left-0 z-10 shrink-0 truncate bg-sunk px-3 py-1 text-[12px] font-semibold">{t.name}</div>
                    {c.days.map((d) => { const a = t.availability[d]; return <div key={d} style={{ width: W }} className={cx('shrink-0 border-l border-line py-1 text-center text-[11px] num', a?.closed ? 'text-bad' : a && a.left <= 0 ? 'font-semibold text-bad' : 'text-muted')}>{a ? (a.closed ? '×' : a.left) : t.rooms.length}</div>; })}
                  </div>
                  {t.rooms.map((r) => (
                    <div key={r.id} className={cx('relative flex border-b border-line', drag?.mode === 'move' && drag.roomId === r.id && 'bg-accent-soft/60')} style={{ height: ROW }} data-room-row={r.id}>
                      <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-panel px-3 text-[13px]">
                        <span className="font-medium">{r.number}</span>
                        <span className={cx('h-2 w-2 rounded-full', { clean: 'bg-ok', inspected: 'bg-accent', dirty: 'bg-warn', out_of_service: 'bg-bad' }[r.housekeepingStatus])} title={r.housekeepingStatus.replace('_', ' ')} />
                        {r.status !== 'active' && <span className="text-[11px] text-bad">OOS</span>}
                      </div>
                      <div className="relative flex-1">
                        {c.days.map((d, i) => <div key={d} className={cx('absolute top-0 bottom-0 border-l border-line', d === c.today && 'bg-accent-soft/40')} style={{ left: i * W, width: W }} />)}
                        {c.bars.filter((b) => b.roomId === r.id).map(renderBar)}
                      </div>
                    </div>
                  ))}
                  {laneItems.map((lane, li) => (
                    <div key={`u${li}`} className={cx('relative flex border-b border-line bg-canvas/60', drag?.mode === 'move' && drag.roomId === 'unassigned' && 'bg-accent-soft/60')} style={{ height: ROW }} data-room-row="unassigned">
                      <div style={{ width: LABEL }} className="sticky left-0 z-10 flex shrink-0 items-center bg-canvas px-3 text-[12px] text-muted">{li === 0 ? 'Unassigned' : ''}</div>
                      <div className="relative flex-1">
                        {lane.map((it) => 'bar' in it ? renderBar(it.bar!) : (
                          <div key={it.block!.id} className={cx('absolute top-1 flex h-[26px] items-center overflow-hidden rounded-[3px] border px-1.5 text-[12px] whitespace-nowrap', it.block!.status === 'conflict' ? 'border-bad/50 bg-bad-soft text-bad' : 'border-line-strong bg-[repeating-linear-gradient(45deg,var(--color-sunk),var(--color-sunk)_4px,var(--color-panel)_4px,var(--color-panel)_8px)] text-muted')}
                            style={barStyle({ checkIn: it.block!.startDate, checkOut: it.block!.endDate })} title={it.block!.summary ?? 'Channel booking'}>
                            {it.block!.status === 'conflict' ? 'Clash · ' : ''}{it.block!.summary ?? 'Channel'}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
      <p className="px-6 py-3 text-xs text-muted">Numbers under each room type are rooms left to sell that night. Striped bars are nights sold on other channels. ₹ marks a balance due.</p>

      <BookingDrawer id={open} onClose={() => setOpen(null)} onChanged={() => mutate()}
        onMove={write ? () => { const bar = c?.bars.find((b) => b.bookingId === open); if (bar) { setOpen(null); setMove({ bar, roomId: bar.roomId, checkIn: bar.checkIn, checkOut: bar.checkOut, pricing: 'reprice' }); } } : undefined} />

      <Modal open={!!move} onClose={() => setMove(null)} title={move ? `Move ${move.bar.guestName}` : ''}
        footer={move && <><button className="btn" onClick={() => setMove(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => submitMove(move)}>Move booking</button></>}>
        {move && (() => {
          const target = allRooms.find((r) => r.id === move.roomId);
          const typeChanges = !!target && target.roomTypeId !== move.bar.roomTypeId;
          const inHouse = move.bar.status === 'checked_in';
          return (
            <div className="space-y-3 text-[13px]" data-testid="move-dialog">
              <p className="text-muted"><span className="font-mono">{move.bar.reference}</span> · now {fmtDate(move.bar.checkIn, 'short')} – {fmtDate(move.bar.checkOut, 'short')} · {money(move.bar.total)}</p>
              <Field label="Room">
                <select className="input" value={move.roomId ?? ''} onChange={(e) => setMove({ ...move, roomId: e.target.value || null })}>
                  <option value="">Not assigned</option>
                  {c?.roomTypes.map((t) => <optgroup key={t.id} label={t.name}>{t.rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}</optgroup>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Arrival"><input className="input" type="date" disabled={inHouse} value={move.checkIn} onChange={(e) => setMove({ ...move, checkIn: e.target.value })} /></Field>
                <Field label="Departure"><input className="input" type="date" min={addDays(move.checkIn, 1)} value={move.checkOut} onChange={(e) => setMove({ ...move, checkOut: e.target.value })} /></Field>
              </div>
              {typeChanges && !inHouse && (
                <fieldset className="space-y-1">
                  <legend className="label">Different room type ({target!.typeName})</legend>
                  <label className="flex items-center gap-2"><input type="radio" checked={move.pricing === 'reprice'} onChange={() => setMove({ ...move, pricing: 'reprice' })} /> Charge the {target!.typeName} rate</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={move.pricing === 'keep'} onChange={() => setMove({ ...move, pricing: 'keep' })} /> Free upgrade — keep the current price</label>
                </fieldset>
              )}
              {inHouse && <p className="text-muted">The guest is in house: a room move keeps their rate and sends the old room for cleaning; a later departure charges the extra nights.</p>}
              {!inHouse && !typeChanges && (move.checkIn !== move.bar.checkIn || move.checkOut !== move.bar.checkOut) && <p className="text-muted">New dates are re-priced at today’s rates.</p>}
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
