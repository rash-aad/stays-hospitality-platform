'use client';

/** GST tax invoice, laid out for A4 printing. Shared by the admin and the guest portal. */
export type TaxInvoiceData = {
  id: string; number: string; status: string; currency: string; subtotal: number; taxTotal: number; total: number; amountPaid: number; issuedAt: string | null; createdAt: string;
  lines: { description: string; date?: string; quantity: number; amount: number; taxAmount: number; sac?: string; rateBps?: number }[];
  supplier: { legalName: string; tradeName: string; gstin: string | null; address: string; stateCode: string | null; stateName: string | null; phone: string | null; email: string | null };
  billTo: { name: string; company?: string | null; gstin?: string | null; address?: string | null; email?: string | null } | null;
  taxSummary: { rateBps: number; taxable: number; cgst: number; sgst: number; igst?: number }[];
  booking: { reference: string; checkIn: string; checkOut: string } | null;
  footerNote: string | null;
};

const amt = (m: number, c = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, minimumFractionDigits: 2 }).format(m / 100);
const d = (s: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : 'Asia/Kolkata' }).format(new Date(s.length === 10 ? `${s}T00:00:00Z` : s));
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

export function TaxInvoice({ inv }: { inv: TaxInvoiceData }) {
  const s = inv.supplier;
  const draft = !inv.issuedAt;
  const c = inv.currency;
  const igst = inv.taxSummary.reduce((a, t) => a + (t.igst ?? 0), 0);
  return (
    <article className="tax-invoice mx-auto max-w-[800px] bg-white p-8 text-[13px] leading-relaxed text-neutral-900 print:p-0" data-testid="tax-invoice">
      <header className="flex items-start justify-between gap-6 border-b border-neutral-300 pb-5">
        <div>
          <p className="text-lg font-semibold">{s.tradeName || s.legalName}</p>
          {s.tradeName && s.legalName !== s.tradeName && <p>{s.legalName}</p>}
          <p className="max-w-xs text-neutral-600">{s.address}</p>
          {s.gstin && <p>GSTIN <span className="font-mono">{s.gstin}</span></p>}
          {s.stateName && <p className="text-neutral-600">State: {s.stateName}{s.stateCode ? ` (${s.stateCode})` : ''}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl tracking-wide uppercase">{draft ? 'Proforma' : s.gstin ? 'Tax invoice' : 'Invoice'}</p>
          <p className="font-mono">{inv.number}</p>
          <p className="text-neutral-600">{d(inv.issuedAt ?? inv.createdAt)}</p>
          {draft && <p className="mt-1 text-xs text-amber-700">Not yet issued — final at check-out</p>}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-4">
        <div>
          <p className="text-xs tracking-wider text-neutral-500 uppercase">Billed to</p>
          {inv.billTo ? (<>
            <p className="font-medium">{inv.billTo.company || inv.billTo.name}</p>
            {inv.billTo.company && <p>{inv.billTo.name}</p>}
            {inv.billTo.address && <p className="text-neutral-600">{inv.billTo.address}</p>}
            {inv.billTo.gstin && <p>GSTIN <span className="font-mono">{inv.billTo.gstin}</span></p>}
          </>) : <p className="text-neutral-500">Guest</p>}
        </div>
        {inv.booking && (
          <div className="text-right">
            <p className="text-xs tracking-wider text-neutral-500 uppercase">Stay</p>
            <p>{d(inv.booking.checkIn)} – {d(inv.booking.checkOut)}</p>
            <p className="font-mono text-neutral-600">{inv.booking.reference}</p>
          </div>
        )}
      </section>
      <table className="mt-4 w-full">
        <thead><tr className="border-b border-neutral-300 text-left text-xs text-neutral-500"><th className="py-2 font-normal">Description</th><th className="py-2 font-normal">SAC</th><th className="py-2 text-right font-normal">Qty</th><th className="py-2 text-right font-normal">Taxable</th><th className="py-2 text-right font-normal">GST</th><th className="py-2 text-right font-normal">Tax</th></tr></thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-2">{l.description}{l.date && <span className="block text-xs text-neutral-500">{d(l.date)}</span>}</td>
              <td className="py-2 font-mono text-xs">{l.sac ?? '—'}</td>
              <td className="py-2 text-right tabular-nums">{l.quantity}</td>
              <td className="py-2 text-right tabular-nums">{amt(l.amount, c)}</td>
              <td className="py-2 text-right tabular-nums">{l.rateBps != null ? pct(l.rateBps) : '—'}</td>
              <td className="py-2 text-right tabular-nums">{amt(l.taxAmount, c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-5 grid grid-cols-2 gap-8">
        <table className="self-start text-xs">
          <thead><tr className="text-left text-neutral-500"><th className="pb-1 font-normal">Rate</th><th className="pb-1 text-right font-normal">Taxable</th>{igst ? <th className="pb-1 text-right font-normal">IGST</th> : <><th className="pb-1 text-right font-normal">CGST</th><th className="pb-1 text-right font-normal">SGST</th></>}</tr></thead>
          <tbody>{inv.taxSummary.filter((t) => t.rateBps > 0).map((t) => (
            <tr key={t.rateBps}><td>{pct(t.rateBps)}</td><td className="text-right tabular-nums">{amt(t.taxable, c)}</td>{igst ? <td className="text-right tabular-nums">{amt(t.igst ?? 0, c)}</td> : <><td className="text-right tabular-nums">{amt(t.cgst, c)}</td><td className="text-right tabular-nums">{amt(t.sgst, c)}</td></>}</tr>
          ))}</tbody>
        </table>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt>Taxable value</dt><dd className="tabular-nums">{amt(inv.subtotal, c)}</dd></div>
          {igst ? <div className="flex justify-between"><dt>IGST</dt><dd className="tabular-nums">{amt(igst, c)}</dd></div> : <>
            <div className="flex justify-between"><dt>CGST</dt><dd className="tabular-nums">{amt(inv.taxSummary.reduce((a, t) => a + t.cgst, 0), c)}</dd></div>
            <div className="flex justify-between"><dt>SGST</dt><dd className="tabular-nums">{amt(inv.taxSummary.reduce((a, t) => a + t.sgst, 0), c)}</dd></div>
          </>}
          <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="tax-invoice-total">{amt(inv.total, c)}</dd></div>
          <div className="flex justify-between text-neutral-600"><dt>Paid</dt><dd className="tabular-nums">{amt(inv.amountPaid, c)}</dd></div>
          <div className="flex justify-between font-medium"><dt>Balance</dt><dd className="tabular-nums">{amt(Math.max(0, inv.total - inv.amountPaid), c)}</dd></div>
        </dl>
      </div>
      <footer className="mt-8 border-t border-neutral-300 pt-3 text-xs text-neutral-500">
        {inv.footerNote && <p className="mb-1">{inv.footerNote}</p>}
        <p>{[s.phone, s.email].filter(Boolean).join(' · ')}{s.gstin ? ' · Tax on this supply is not payable under reverse charge.' : ''}</p>
      </footer>
    </article>
  );
}

/** Billing-details form for B2B guests (company name and GSTIN on the invoice). */
export function BillToForm({ initial, onSave, busy }: { initial: TaxInvoiceData['billTo']; onSave: (v: { name: string; company: string | null; gstin: string | null; address: string | null }) => void; busy?: boolean }) {
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const v = (k: string) => (String(f.get(k) ?? '').trim() || null);
      onSave({ name: v('name') ?? '', company: v('company'), gstin: v('gstin')?.toUpperCase() ?? null, address: v('address') });
    }}>
      <label className="block"><span className="mb-1 block text-xs text-neutral-500">Name</span><input name="name" required minLength={2} className="w-full rounded-sm border border-neutral-300 px-2.5 py-2" defaultValue={initial?.name ?? ''} /></label>
      <label className="block"><span className="mb-1 block text-xs text-neutral-500">Company</span><input name="company" className="w-full rounded-sm border border-neutral-300 px-2.5 py-2" defaultValue={initial?.company ?? ''} /></label>
      <label className="block"><span className="mb-1 block text-xs text-neutral-500">GSTIN</span><input name="gstin" maxLength={15} className="w-full rounded-sm border border-neutral-300 px-2.5 py-2 font-mono uppercase" defaultValue={initial?.gstin ?? ''} placeholder="15 characters" /></label>
      <label className="block"><span className="mb-1 block text-xs text-neutral-500">Billing address</span><input name="address" className="w-full rounded-sm border border-neutral-300 px-2.5 py-2" defaultValue={initial?.address ?? ''} /></label>
      <button className="rounded-sm bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 sm:col-span-2" disabled={busy}>Save billing details</button>
    </form>
  );
}
