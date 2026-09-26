import Link from 'next/link';
import { Logo } from '@/components/brand';

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Logo size="lg" />
        <nav className="flex gap-2">
          <Link className="btn" href="/admin/login">Sign in</Link>
        </nav>
      </header>
      <section className="grid flex-1 content-center gap-10 py-16 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="eyebrow">Hospitality operating platform</p>
          <h1 className="mt-3 font-serif text-5xl leading-[1.02] tracking-tight md:text-6xl">Your website, your bookings, your guests — one house.</h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">Direct booking with UPI, a restaurant that runs itself, and one calm portal where guests order dinner, ask for towels and settle their bill. Every property gets its own workspace and its own branded site.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link className="btn btn-primary btn-lg" href="/admin/login">Open your workspace</Link>
            <a className="btn btn-lg" href="http://seabreeze.localhost:3000">See a live property site</a>
          </div>
        </div>
        <dl className="self-center border-t border-line text-[13px]">
          {[
            ['Direct booking', 'Rates, seasons, GST slabs, coupons — paid by UPI to your own ID or through a gateway.'],
            ['Dining', 'Table reservations, in-room and poolside ordering, a live kitchen queue.'],
            ['Guest services', 'Housekeeping, maintenance, concierge and transfers from one request engine.'],
            ['Your website', 'Ten designed templates, a visual editor, custom domains.'],
          ].map(([t, d]) => (
            <div key={t} className="grid grid-cols-[130px_1fr] gap-4 border-b border-line py-3.5">
              <dt className="font-medium">{t}</dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
