'use client';

import { ErrorNote, Loading } from '@/components/ui';
import { useStaff } from '@/lib/hooks';

type Q = { id: string; number: string; floor: string | null; type: string; url: string; qr: string };

/** Print and stick one on each room’s door frame (inside the service side). Scanning opens that room’s cleaning page. */
export default function RoomQrSheet() {
  const { data, error } = useStaff<{ data: Q[] }>('/admin/housekeeping/qr-codes');
  if (!data) return <div className="p-6"><ErrorNote error={error} /><Loading /></div>;
  return (
    <div className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-[13px] text-muted">Housekeeping scans the code on the room to start, finish and inspect cleaning, or report a fault.</p>
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="grid grid-cols-3 gap-4" data-testid="qr-sheet">
        {data.data.map((r) => (
          <figure key={r.id} data-url={r.url} className="break-inside-avoid border border-dashed border-neutral-300 p-3 text-center">
            <div className="mx-auto w-36" dangerouslySetInnerHTML={{ __html: r.qr }} />
            <figcaption className="mt-2"><span className="block text-2xl font-semibold">Room {r.number}</span><span className="text-xs text-neutral-500">{r.type}{r.floor ? ` · Floor ${r.floor}` : ''}</span></figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
