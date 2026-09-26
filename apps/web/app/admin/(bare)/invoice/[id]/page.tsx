'use client';

import { use, useState } from 'react';
import { BillToForm, TaxInvoice, type TaxInvoiceData } from '@/components/tax-invoice';
import { ErrorNote, Loading, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { useStaff } from '@/lib/hooks';

export default function AdminInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useStaff<{ data: TaxInvoiceData & { bookingId: string | null } }>(`/admin/invoices/${id}`);
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  if (!data) return <div className="p-6"><ErrorNote error={error} /><Loading /></div>;
  const inv = data.data;
  return (
    <div className="min-h-dvh bg-sunk py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between gap-3 px-4 print:hidden">
        <a className="btn btn-sm" href="/admin/reservations">← Back</a>
        <span className="flex gap-2">
          {!inv.issuedAt && inv.bookingId && <button className="btn btn-sm" onClick={() => setEditing((e) => !e)}>Billing details</button>}
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print / PDF</button>
        </span>
      </div>
      {editing && inv.bookingId && (
        <div className="mx-auto mb-4 max-w-[800px] bg-panel p-4 print:hidden">
          <BillToForm initial={inv.billTo} busy={busy} onSave={async (v) => {
            const ok = await run(() => staffApi(`/admin/bookings/${inv.bookingId}/bill-to`, { method: 'PUT', body: v }), 'Billing details saved');
            if (ok) { await run(() => staffApi(`/admin/bookings/${inv.bookingId}/invoice`, { body: { issue: false } })); setEditing(false); mutate(); }
          }} />
        </div>
      )}
      <TaxInvoice inv={inv} />
    </div>
  );
}
