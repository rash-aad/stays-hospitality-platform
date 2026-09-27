'use client';

import { day, dayTime, hm, inr, ORDER_LABEL, Row } from '@/components/stay/bits';
import { InstallPwa, useStay } from '@/components/stay/shell';
import { useT } from '@/lib/i18n';

export default function StayHome() {
  const { home } = useStay();
  const t = useT();
  const s = home.stay;
  const m = home.modules;
  return (
    <div data-testid="stay-home">
      <p className="t-muted">{t('Hello, {name}', { name: home.guest.firstName })}</p>
      {s ? (
        <section className="mt-2">
          <h1 className="display text-[2.4rem] leading-tight">{s.inHouse ? (s.room ? t('Room {n}', { n: s.room.number }) : t('Welcome')) : t('See you {date}', { date: day(s.checkIn) })}</h1>
          <p className="mt-1 t-muted">{s.roomType.split(' — ')[0]} · {day(s.checkIn)} – {day(s.checkOut)}</p>
          <dl className="mt-5 grid grid-cols-3 border-y t-line py-3 text-sm">
            <div><dt className="t-muted text-xs">{t('Check-in')}</dt><dd>{t('from {time}', { time: home.property?.checkInTime.slice(0, 5) ?? '' })}</dd></div>
            <div><dt className="t-muted text-xs">{t('Check-out')}</dt><dd>{t('by {time}', { time: home.property?.checkOutTime.slice(0, 5) ?? '' })}</dd></div>
            <div><dt className="t-muted text-xs">{t('Booking')}</dt><dd className="font-mono text-xs leading-5">{s.reference}</dd></div>
          </dl>
          {!s.inHouse && <a href={`/stay/checkin/${s.bookingId}`} className="t-btn t-btn-outline mt-5 w-full" data-testid="precheckin-link">{t('Check in online')}</a>}
          {!s.inHouse && <p className="mt-4 text-sm t-muted">{t('Room service and housekeeping open up here once you’ve checked in. You can already book tables, experiences and your airport transfer.')}</p>}
        </section>
      ) : (
        <section className="mt-2"><h1 className="display text-[2.4rem] leading-tight">{t('Welcome')}</h1><p className="mt-1 t-muted">{home.guest.verified ? t('We don’t see an upcoming stay on this account.') : t('Confirm your email to see your stay.')}</p>{m.includes('room_booking') && <a href="/book" className="t-btn mt-5">{t('Book a stay')}</a>}</section>
      )}

      {(home.activeOrders.length > 0 || home.openRequests.length > 0 || home.upcomingTables.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">{t('Happening now')}</h2>
          {home.activeOrders.map((o) => <Row key={o.id} href={`/stay/orders/${o.id}`} title={ORDER_LABEL[o.status] ?? o.status} sub={`Order ${o.reference}${o.estimatedReadyAt && !['ready', 'delivered'].includes(o.status) ? ` · about ${hm(o.estimatedReadyAt)}` : ''}`} />)}
          {home.openRequests.map((r) => <Row key={r.id} href={`/stay/requests/${r.id}`} title={r.title} sub={t('We’re on it')} />)}
          {home.upcomingTables.map((tb) => <Row key={tb.id} href="/stay/reserve" title={`${tb.restaurant}, ${hm(tb.startsAt)}`} sub={`${dayTime(tb.startsAt)} · ${t('table for {n}', { n: tb.partySize })}${tb.status === 'waitlisted' ? ` · ${t('waitlist')}` : ''}`} />)}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-1 text-[12px] tracking-[0.16em] uppercase t-muted">{t('What can we do for you?')}</h2>
        {m.includes('restaurant.ordering') && <Row href="/stay/dining" title={t('Order food & drinks')} sub={s?.inHouse ? t('To your room, the pool or the beach') : t('Takeaway and pre-orders')} />}
        {m.includes('restaurant.reservations') && <Row href="/stay/reserve" title={t('Book a table')} />}
        {m.includes('housekeeping') && <Row href="/stay/requests?cat=housekeeping" title={t('Housekeeping')} sub={t('Cleaning, towels, pillows, laundry')} />}
        {m.includes('maintenance') && <Row href="/stay/requests?cat=maintenance" title={t('Something isn’t working')} sub={t('We’ll send someone right away')} />}
        {m.some((x) => ['experiences', 'spa', 'transport'].includes(x)) && <Row href="/stay/experiences" title={t('Experiences & spa')} />}
        {(m.includes('concierge') || m.includes('transport')) && <Row href="/stay/requests?cat=front_desk,concierge,transport" title={t('Concierge & transfers')} sub={t('Late check-out, wake-up calls, airport pickups')} />}
        <Row href="/stay/guide" title={t('Property guide')} sub={t('Wi-Fi, hours, house rules, emergency')} />
        <Row href="/stay/messages" title={t('Message the front desk')} />
      </section>

      {home.offers.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[12px] tracking-[0.16em] uppercase t-muted">{t('For you')}</h2>
          {home.offers.map((o) => (
            <article key={o.id} className="mb-4 grid grid-cols-[96px_1fr] gap-4">
              {o.image ? <img src={o.image.url} alt={o.image.alt} className="aspect-square w-24 object-cover" /> : <div className="t-surface aspect-square" />}
              <div><p className="display text-lg leading-tight">{o.title}</p>{o.summary && <p className="mt-1 text-sm t-muted">{o.summary}</p>}</div>
            </article>
          ))}
        </section>
      )}
      {s && s.total - s.amountPaid > 0 && <p className="mt-6 text-sm t-muted">{t('Balance on your stay: {amount}', { amount: inr(s.total - s.amountPaid) })} · <a className="t-link" href="/stay/bill">{t('View bill')}</a></p>}
      <div className="mt-8"><InstallPwa label={`Add ${home.property?.name ?? 'this app'} to your home screen`} className="t-btn t-btn-outline w-full" /></div>
    </div>
  );
}
