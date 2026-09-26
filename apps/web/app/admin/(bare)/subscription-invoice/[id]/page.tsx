'use client';

import { use } from 'react';
import { TaxInvoice, type TaxInvoiceData } from '@/components/tax-invoice';
import { ErrorNote, Loading } from '@/components/ui';
import { useStaff } from '@/lib/hooks';

export default function SubscriptionInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useStaff<{ data: TaxInvoiceData }>(`/admin/subscription/invoices/${id}`);
  if (!data) return <div className="p-6"><ErrorNote error={error} /><Loading /></div>;
  return (
    <div className="min-h-dvh bg-sunk py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between px-4 print:hidden">
        <a className="btn btn-sm" href="/admin/settings/subscription">← Subscription</a>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Download / print</button>
      </div>
      <TaxInvoice inv={data.data} />
    </div>
  );
}
