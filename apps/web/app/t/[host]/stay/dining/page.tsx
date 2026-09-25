'use client';

import { Notice, Row, Title } from '@/components/stay/bits';
import { useStay } from '@/components/stay/shell';
import { useGuest } from '@/lib/hooks';

type Outlet = { id: string; name: string; kind: string; description: string | null; cuisine: string | null; location: string | null; images: { url: string; alt: string }[]; canReserve: boolean; orderTypes: { id: string; name: string; description: string | null; available: boolean; unavailableReason: string | null }[] };

export default function Dining() {
  const { home } = useStay();
  const { data, error } = useGuest<{ data: Outlet[] }>('/portal/dining');
  return (
    <>
      <Title>Dining</Title>
      {error && <Notice tone="error">{error.message}</Notice>}
      {data?.data.map((o) => (
        <section key={o.id} className="mb-10">
          {o.images[0] && <img src={o.images[0].url} alt={o.images[0].alt} className="mb-4 aspect-[16/9] w-full object-cover" />}
          <h2 className="display text-2xl">{o.name}</h2>
          <p className="text-sm t-muted">{[o.cuisine, o.location].filter(Boolean).join(' · ')}</p>
          <div className="mt-3">
            {o.orderTypes.map((t) => t.available
              ? <Row key={t.id} href={`/stay/order/${o.id}?type=${t.id}`} title={t.name} sub={t.description} />
              : <Row key={t.id} title={<span className="t-muted">{t.name}</span>} sub={t.unavailableReason} right=" " />)}
            {o.canReserve && home.modules.includes('restaurant.reservations') && <Row href={`/stay/reserve?r=${o.id}`} title="Book a table" />}
          </div>
        </section>
      ))}
    </>
  );
}
