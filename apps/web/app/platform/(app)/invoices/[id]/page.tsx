'use client';

import { use } from 'react';
import { TaxInvoice, type TaxInvoiceData } from '@/components/tax-invoice';
import { ErrorNote, Loading } from '@/components/ui';
import { useStaff } from '@/lib/hooks';

export default function PlatformInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useStaff<{ data: TaxInvoiceData }>(`/platform/invoices/${id}`);
  if (!data) return <div className="p-6"><ErrorNote error={error} /><Loading /></div>;
  return (
    <div className="bg-sunk py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] justify-end px-4 print:hidden"><button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print / PDF</button></div>
      <TaxInvoice inv={data.data} />
    </div>
  );
}
