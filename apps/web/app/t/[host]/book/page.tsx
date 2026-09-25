import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/site/booking-flow';
import { MinimalChrome } from '@/components/site/minimal-chrome';
import { decodeHost, getSite } from '@/lib/server';

export const metadata = { title: 'Book your stay' };

export default async function Book({ params }: { params: Promise<{ host: string }> }) {
  const site = await getSite(decodeHost((await params).host));
  if (!site) notFound();
  if (!site.tenant.modules.includes('room_booking')) return <MinimalChrome name={site.tenant.name}><p className="display text-3xl">Online booking isn’t available.</p><p className="t-muted mt-3">Please call us on {site.property?.phone} to reserve.</p></MinimalChrome>;
  return <MinimalChrome name={site.tenant.name} right={<a href="/stay" className="text-sm t-muted">Your stay</a>}><Suspense><BookingFlow propertyName={site.tenant.name} /></Suspense></MinimalChrome>;
}
