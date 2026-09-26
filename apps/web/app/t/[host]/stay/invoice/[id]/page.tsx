'use client';

import { use, useState } from 'react';
import { Notice, Title } from '@/components/stay/bits';
import { BillToForm, TaxInvoice, type TaxInvoiceData } from '@/components/tax-invoice';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';

export default function GuestInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, mutate } = useGuest<{ data: TaxInvoiceData & { bookingId: string | null } }>(`/portal/invoices/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <p className="t-muted">Loading…</p>;
  const inv = data.data;
  return (
    <>
      <div className="print:hidden"><Title back="/stay/bill" sub={inv.issuedAt ? 'Your GST invoice.' : 'A preview — the final invoice is issued at check-out.'}>Invoice</Title></div>
      <div className="-mx-5 overflow-x-auto print:mx-0"><TaxInvoice inv={inv} /></div>
      <button className="t-btn t-btn-outline mt-6 w-full print:hidden" onClick={() => window.print()}>Print or save as PDF</button>
      {!inv.issuedAt && inv.bookingId && (
        <section className="mt-10 print:hidden">
          <h2 className="mb-3 text-[12px] tracking-[0.16em] uppercase t-muted">Need a company invoice?</h2>
          <p className="mb-3 text-sm t-muted">Add your company name and GSTIN before check-out to claim input tax credit.</p>
          <BillToForm initial={inv.billTo} busy={busy} onSave={async (v) => {
            setBusy(true);
            try { await guestApi(`/portal/bookings/${inv.bookingId}/bill-to`, { method: 'PUT', body: v }); setMsg('Saved — your invoice will carry these details.'); mutate(); }
            catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
          }} />
          {msg && <Notice>{msg}</Notice>}
        </section>
      )}
    </>
  );
}
