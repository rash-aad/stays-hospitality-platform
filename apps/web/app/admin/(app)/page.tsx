'use client';

import Link from 'next/link';
import { useCan, useMe } from '@/components/admin-context';
import { ErrorNote, Loading, PageHeader } from '@/components/ui';
import { date } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Dash = {
  today: string; arrivalsPending: number; arrivalsDone: number; departuresPending: number; departuresDone: number; inHouse: number; rooms: number;
  dirtyRooms: number; outOfService: number; paymentsToVerify: number; openRequests: number; overdueRequests: number; liveOrders: number;
  tablesToday: number; coversToday: number; openTickets: number; unreadMessages: number; pendingPaymentBookings: number;
  next7: { date: string; occupied: number; arrivals: number }[];
};

function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: 'warn' | 'bad' }) {
  const body = (
    <div className="h-full border-b border-r border-line px-5 py-4 hover:bg-[#faf9f7]">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num mt-1 text-[26px] leading-none font-medium tracking-tight ${tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : ''}`}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Today() {
  const me = useMe();
  const { data, error } = useStaff<{ data: Dash }>('/admin/dashboard', { refreshInterval: 30_000 });
  const d = data?.data;
  const mods = me.tenant.modules;
  const { perm } = useCan();
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader title={`${greeting}, ${me.user.name.split(' ')[0]}`} sub={d ? date(d.today, 'long') : ' '} />
      <ErrorNote error={error} />
      {!d ? <Loading /> : (
        <div className="bg-panel">
          {((perm('payments.verify') && d.paymentsToVerify > 0) || (perm('requests.manage') && d.overdueRequests > 0) || (perm('messages.manage') && d.unreadMessages > 0)) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line bg-warn-soft/60 px-6 py-2.5 text-[13px]">
              {perm('payments.verify') && d.paymentsToVerify > 0 && <Link className="font-medium text-warn underline-offset-2 hover:underline" href="/admin/payments">{d.paymentsToVerify} UPI payment{d.paymentsToVerify > 1 ? 's' : ''} waiting for verification →</Link>}
              {perm('requests.manage') && d.overdueRequests > 0 && <Link className="text-warn underline-offset-2 hover:underline" href="/admin/requests?view=overdue">{d.overdueRequests} request{d.overdueRequests > 1 ? 's' : ''} past target time →</Link>}
              {perm('messages.manage') && d.unreadMessages > 0 && <Link className="text-ink-2 underline-offset-2 hover:underline" href="/admin/messages">{d.unreadMessages} unread guest message{d.unreadMessages > 1 ? 's' : ''} →</Link>}
            </div>
          )}
          <div className="grid grid-cols-2 border-l border-line md:grid-cols-4">
            {mods.includes('room_booking') && perm('bookings.read') && <>
              <Stat label="Arrivals" value={<>{d.arrivalsDone}<span className="text-muted"> / {d.arrivalsDone + d.arrivalsPending}</span></>} sub={d.arrivalsPending ? `${d.arrivalsPending} still to arrive` : 'All checked in'} href="/admin/reservations?view=arrivals" />
              <Stat label="Departures" value={<>{d.departuresDone}<span className="text-muted"> / {d.departuresDone + d.departuresPending}</span></>} sub={d.departuresPending ? `${d.departuresPending} still to check out` : 'All checked out'} href="/admin/reservations?view=departures" />
              <Stat label="In house" value={d.inHouse} sub={`${d.rooms ? Math.round((d.inHouse / d.rooms) * 100) : 0}% of ${d.rooms} rooms`} href="/admin/reservations?view=in_house" />
              <Stat label="Awaiting payment" value={d.pendingPaymentBookings} sub="Held bookings" href="/admin/reservations?view=pending_payment" tone={d.pendingPaymentBookings ? 'warn' : undefined} />
            </>}
            {mods.includes('housekeeping') && perm('housekeeping.manage') && <Stat label="Rooms to clean" value={d.dirtyRooms} sub={d.outOfService ? `${d.outOfService} out of service` : 'None out of service'} href="/admin/housekeeping" />}
            {perm('requests.manage') && <Stat label="Open requests" value={d.openRequests} sub={d.overdueRequests ? `${d.overdueRequests} overdue` : 'None overdue'} href="/admin/requests" tone={d.overdueRequests ? 'bad' : undefined} />}
            {mods.includes('restaurant.ordering') && perm('orders.manage') && <Stat label="Live orders" value={d.liveOrders} sub="In the kitchen now" href="/admin/dining/kitchen" />}
            {mods.includes('restaurant.reservations') && perm('restaurant.reservations') && <Stat label="Tables today" value={d.tablesToday} sub={`${d.coversToday} covers`} href="/admin/dining/reservations" />}
            {mods.includes('maintenance') && perm('maintenance.manage') && <Stat label="Open tickets" value={d.openTickets} sub="Maintenance" href="/admin/maintenance" />}
          </div>
          {mods.includes('room_booking') && perm('bookings.read') && (
            <section className="px-6 py-6">
              <h2 className="eyebrow mb-3">Next seven days</h2>
              <div className="grid grid-cols-7 gap-px border border-line bg-line">
                {d.next7.map((x) => {
                  const pct = d.rooms ? x.occupied / d.rooms : 0;
                  return (
                    <div key={x.date} className="bg-panel px-3 py-3">
                      <p className="text-xs text-muted">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${x.date}T00:00:00Z`))}</p>
                      <div className="mt-3 h-16 bg-sunk"><div className="h-full bg-accent/80" style={{ width: '100%', transform: `scaleY(${pct})`, transformOrigin: 'bottom' }} /></div>
                      <p className="num mt-2 text-[13px] font-medium">{Math.round(pct * 100)}%</p>
                      <p className="text-2xs text-muted">{x.arrivals} arriving</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
