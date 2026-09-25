import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { MinimalChrome } from '@/components/site/minimal-chrome';
import { PayView } from '@/components/site/pay-view';
import { decodeHost, getSite } from '@/lib/server';

export const metadata = { title: 'Your booking', robots: { index: false } };

export default async function Pay({ params }: { params: Promise<{ host: string; id: string }> }) {
  const { host, id } = await params;
  const site = await getSite(decodeHost(host));
  if (!site) notFound();
  return <MinimalChrome name={site.tenant.name}><Suspense><PayView id={id} phone={site.property?.phone ?? null} portal={site.tenant.modules.includes('guest_portal')} /></Suspense></MinimalChrome>;
}
