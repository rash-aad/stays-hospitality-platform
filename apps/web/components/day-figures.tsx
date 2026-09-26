'use client';

import { money } from '@/lib/format';

export type DaySummary = {
  date: string;
  rooms: { available: number; sold: number; outOfService: number; revenue: number; occupancy: number; adr: number; revpar: number };
  movements: { arrivals: number; departures: number; noShows: number; cancellations: number; newBookings: number; newBookingValue: number; inHouse: number };
  revenue: { rooms: number; food: number; experiences: number; other: number; total: number; foodOrders: number };
  payments: { byMethod: { method: string; tender: string | null; count: number; amount: number }[]; received: number; refunds: { count: number; amount: number } };
  outstanding: { inHouseBalance: number };
  feedback: { responses: number; average: number | null; low: number };
};

const label = (m: string, t: string | null) => ({ upi_manual: 'UPI (own ID)', upi_gateway: 'UPI gateway', room_charge: 'Room charge', pay_at_property: 'At the desk' }[m] ?? m) + (t ? ` · ${t.replace('_', ' ')}` : '');

/** The day's key figures, used by the night audit and its history. */
export function DayFigures({ s }: { s: DaySummary }) {
  const kpi = (k: string, v: string, sub?: string) => <div><dt className="text-xs text-muted">{k}</dt><dd className="num text-xl">{v}</dd>{sub && <dd className="text-xs text-muted">{sub}</dd>}</div>;
  return (
    <div className="space-y-5 text-[13px]" data-testid="day-figures">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpi('Occupancy', `${Math.round(s.rooms.occupancy * 100)}%`, `${s.rooms.sold} of ${s.rooms.available} rooms`)}
        {kpi('ADR', money(s.rooms.adr), 'average room rate')}
        {kpi('RevPAR', money(s.rooms.revpar), 'per available room')}
        {kpi('Revenue', money(s.revenue.total), 'all departments')}
      </dl>
      <div className="grid gap-6 sm:grid-cols-2">
        <table className="w-full"><tbody>
          <tr><td className="py-0.5 text-muted">Rooms</td><td className="num text-right">{money(s.revenue.rooms)}</td></tr>
          <tr><td className="py-0.5 text-muted">Food &amp; drink ({s.revenue.foodOrders} orders)</td><td className="num text-right">{money(s.revenue.food)}</td></tr>
          <tr><td className="py-0.5 text-muted">Experiences</td><td className="num text-right">{money(s.revenue.experiences)}</td></tr>
          <tr><td className="py-0.5 text-muted">Other charges</td><td className="num text-right">{money(s.revenue.other)}</td></tr>
          <tr className="border-t border-line"><td className="pt-1 text-muted">Arrivals · departures · no-shows</td><td className="num pt-1 text-right">{s.movements.arrivals} · {s.movements.departures} · {s.movements.noShows}</td></tr>
          <tr><td className="py-0.5 text-muted">New bookings</td><td className="num text-right">{s.movements.newBookings} · {money(s.movements.newBookingValue)}</td></tr>
          <tr><td className="py-0.5 text-muted">Cancellations</td><td className="num text-right">{s.movements.cancellations}</td></tr>
        </tbody></table>
        <table className="w-full"><tbody>
          {s.payments.byMethod.length === 0 ? <tr><td className="text-muted">No payments</td></tr> : s.payments.byMethod.map((p, i) => <tr key={i}><td className="py-0.5 text-muted">{label(p.method, p.tender)} × {p.count}</td><td className="num text-right">{money(p.amount)}</td></tr>)}
          <tr className="border-t border-line font-medium"><td className="pt-1">Money received</td><td className="num pt-1 text-right">{money(s.payments.received)}</td></tr>
          {s.payments.refunds.amount > 0 && <tr><td className="py-0.5 text-muted">Refunds</td><td className="num text-right">−{money(s.payments.refunds.amount)}</td></tr>}
          <tr><td className="py-0.5 text-muted">Owed by in-house guests</td><td className="num text-right">{money(s.outstanding.inHouseBalance)}</td></tr>
          {s.feedback.responses > 0 && <tr><td className="py-0.5 text-muted">Feedback ({s.feedback.responses})</td><td className={`num text-right ${s.feedback.low ? 'text-bad' : ''}`}>{s.feedback.average}★{s.feedback.low ? ` · ${s.feedback.low} unhappy` : ''}</td></tr>}
        </tbody></table>
      </div>
    </div>
  );
}
