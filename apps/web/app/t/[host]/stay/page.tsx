'use client';

import { day, dayTime, hm, inr, ORDER_LABEL, Row } from '@/components/stay/bits';
import { InstallPwa, useStay } from '@/components/stay/shell';

export default function StayHome() {
  const { home } = useStay();
  const s = home.stay;
  const m = home.modules;
  return (
    <div data-testid="stay-home">
      <p className="t-muted">Hello, {home.guest.firstName}</p>
      {s ? (
        <section className="mt-2">
          <h1 className="display text-[2.4rem] leading-tight">{s.inHouse ? (s.room ? `Room ${s.room.number}` : 'Welcome') : `See you ${day(s.checkIn)}`}</h1>
          <p className="mt-1 t-muted">{s.roomType.split(' — ')[0]} · {day(s.checkIn)} – {day(s.checkOut)}</p>
          <dl className="mt-5 grid grid-cols-3 border-y t-line py-3 text-sm">
            <div><dt className="t-muted text-xs">Check-in</dt><dd>from {home.property?.checkInTime.slice(0, 5)}</dd></div>
            <div><dt className="t-muted text-xs">Check-out</dt><dd>by {home.property?.checkOutTime.slice(0, 5)}</dd></div>
            <div><dt className="t-muted text-xs">Booking</dt><dd className="font-mono text-xs leading-5">{s.reference}</dd></div>
          </dl>
          {!s.inHouse && <a href={`/stay/checkin/${s.bookingId}`} className="t-btn t-btn-outline mt-5 w-full" data-testid="precheckin-link">Check in online</a>}
          {!s.inHouse && <p className="mt-4 text-sm t-muted">Room service and housekeeping open up here once you’ve checked in. You can already book tables, experiences and your airport transfer.</p>}
        </section>
      ) : (
        <section className="mt-2"><h1 className="display text-[2.4rem] leading-tight">Welcome</h1><p className="mt-1 t-muted">{home.guest.verified ? 'We don’t see an upcoming stay on this account.' : 'Confirm your email to see your stay.'}</p>{m.includes('room_booking') && <a href="/book" className="t-btn mt-5">Book a stay</a>}</section>
      )}

      {(home.activeOrders.length > 0 || home.openRequests.length > 0 || home.upcomingTables.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">Happening now</h2>
          {home.activeOrders.map((o) => <Row key={o.id} href={`/stay/orders/${o.id}`} title={ORDER_LABEL[o.status] ?? o.status} sub={`Order ${o.reference}${o.estimatedReadyAt && !['ready', 'delivered'].includes(o.status) ? ` · about ${hm(o.estimatedReadyAt)}` : ''}`} />)}
          {home.openRequests.map((r) => <Row key={r.id} href={`/stay/requests/${r.id}`} title={r.title} sub="We’re on it" />)}
          {home.upcomingTables.map((t) => <Row key={t.id} href="/stay/reserve" title={`${t.restaurant}, ${hm(t.startsAt)}`} sub={`${dayTime(t.startsAt)} · table for ${t.partySize}${t.status === 'waitlisted' ? ' · waitlist' : ''}`} />)}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">What can we do for you?</h2>
        {m.includes('restaurant.ordering') && <Row href="/stay/dining" title="Order food & drinks" sub={s?.inHouse ? 'To your room, the pool or the beach' : 'Takeaway and pre-orders'} />}
        {m.includes('restaurant.reservations') && <Row href="/stay/reserve" title="Book a table" />}
        {m.includes('housekeeping') && <Row href="/stay/requests?cat=housekeeping" title="Housekeeping" sub="Cleaning, towels, pillows, laundry" />}
        {m.includes('maintenance') && <Row href="/stay/requests?cat=maintenance" title="Something isn’t working" sub="We’ll send someone right away" />}
        {m.some((x) => ['experiences', 'spa', 'transport'].includes(x)) && <Row href="/stay/experiences" title="Experiences & spa" />}
        {(m.includes('concierge') || m.includes('transport')) && <Row href="/stay/requests?cat=front_desk,concierge,transport" title="Concierge & transfers" sub="Late check-out, wake-up calls, airport pickups" />}
        <Row href="/stay/guide" title="Property guide" sub="Wi-Fi, hours, house rules, emergency" />
        <Row href="/stay/messages" title="Message the front desk" />
      </section>

      {home.offers.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[12px] tracking-[0.16em] uppercase t-muted">For you</h2>
          {home.offers.map((o) => (
            <article key={o.id} className="mb-4 grid grid-cols-[96px_1fr] gap-4">
              {o.image ? <img src={o.image.url} alt={o.image.alt} className="aspect-square w-24 object-cover" /> : <div className="t-surface aspect-square" />}
              <div><p className="display text-lg leading-tight">{o.title}</p>{o.summary && <p className="mt-1 text-sm t-muted">{o.summary}</p>}</div>
            </article>
          ))}
        </section>
      )}
      {s && s.total - s.amountPaid > 0 && <p className="mt-6 text-sm t-muted">Balance on your stay: {inr(s.total - s.amountPaid)} · <a className="t-link" href="/stay/bill">View bill</a></p>}
      <div className="mt-8"><InstallPwa label={`Add ${home.property?.name ?? 'this app'} to your home screen`} className="t-btn t-btn-outline w-full" /></div>
    </div>
  );
}
