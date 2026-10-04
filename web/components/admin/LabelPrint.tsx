'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AdminShell, AdminError, TableSkeleton } from './AdminShell';

/**
 * Shipping labels and packing slips, one 100 mm x 150 mm page per order, ready for a
 * thermal or any ordinary printer. Opened from the Orders screen with the order ids in the
 * address. Each page carries the address to ship to, what is in the parcel, the courier and
 * tracking number if known, the order number as a QR code (to scan when packing), and where
 * it is from.
 */

interface Label {
  id: string; orderNo: string; memberCode: string; placedAt: string;
  shipping: { name: string; phone: string; line: string; city: string; state: string; pincode: string };
  items: { name: string; quantity: number }[];
  courier: string | null; trackingNo: string | null;
}
interface Company { legalName?: string; registeredAddress?: string; supportPhone?: string }

export function LabelPrintView() {
  return (
    <AdminShell title="Shipping labels" subtitle="Check them, then print. Each order is its own page." permission="orders.manage">
      <Labels />
    </AdminShell>
  );
}

function Labels() {
  const params = useSearchParams();
  const ids = params.get('ids') ?? '';
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [company, setCompany] = useState<Company>({});
  const [qr, setQr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, c] = await Promise.all([
          api<{ items: Label[] }>(`/admin/orders/labels?ids=${encodeURIComponent(ids)}`),
          fetch('/api/company').then((x) => (x.ok ? (x.json() as Promise<Company>) : {})).catch(() => ({})),
        ]);
        if (cancelled) return;
        setLabels(r.items);
        setCompany(c);
        const QR = await import('qrcode');
        const entries = await Promise.all(r.items.map(async (l) => [l.id, await QR.toString(l.orderNo, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })] as const));
        if (!cancelled) setQr(Object.fromEntries(entries));
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the labels.');
      }
    })();
    return () => { cancelled = true; };
  }, [ids]);

  if (error) return <AdminError message={error} />;
  if (!labels) return <TableSkeleton rows={3} />;
  if (labels.length === 0) return <p className="text-sm text-neutral-600">No orders to print. Go back to Orders and pick some.</p>;

  return (
    <div>
      {/* Print only the labels: hide the console around them, one label per page. */}
      <style>{`
        @page { size: 100mm 150mm; margin: 0; }
        @media print {
          body * { visibility: hidden; }
          .label-sheet, .label-sheet * { visibility: visible; }
          .label-sheet { position: absolute; left: 0; top: 0; width: 100mm; }
          .label { page-break-after: always; break-after: page; border: none !important; box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      <div className="mb-4 flex items-center gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
          Print {labels.length} label{labels.length === 1 ? '' : 's'}
        </button>
        <p className="text-xs text-neutral-500">Set the paper size to 100 x 150 mm (4 x 6 in) in the print window, or use any size, it scales.</p>
      </div>

      <div className="label-sheet space-y-4">
        {labels.map((l) => (
          <article key={l.id} className="label mx-auto flex h-[150mm] w-[100mm] flex-col border border-neutral-400 bg-white p-[5mm] text-black">
            <div className="flex items-start justify-between gap-3 border-b border-black pb-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider">Ship to</p>
                <p className="text-lg font-bold leading-tight">{l.shipping.name}</p>
              </div>
              <div className="h-[22mm] w-[22mm] shrink-0" dangerouslySetInnerHTML={{ __html: qr[l.id] ?? '' }} />
            </div>

            <address className="mt-2 text-[15px] not-italic leading-snug">
              {l.shipping.line}<br />
              {l.shipping.city}, {l.shipping.state}<br />
              <span className="text-2xl font-bold tracking-wider">{l.shipping.pincode}</span><br />
              Phone: {l.shipping.phone}
            </address>

            <div className="mt-3 border-t border-black pt-2 text-[12px]">
              <p><strong>Order {l.orderNo}</strong> · {new Date(l.placedAt).toLocaleDateString('en-IN')}</p>
              {l.courier && l.trackingNo && <p>{l.courier} · AWB <span className="font-mono font-semibold">{l.trackingNo}</span></p>}
            </div>

            <div className="mt-2 flex-1 overflow-hidden border-t border-black pt-2 text-[12px]">
              <p className="text-[10px] uppercase tracking-wider">Contents</p>
              <ul className="mt-1 space-y-0.5">
                {l.items.map((i, n) => <li key={n}>{i.quantity} × {i.name}</li>)}
              </ul>
            </div>

            <div className="border-t border-black pt-2 text-[10px] leading-snug">
              <p className="font-semibold">From: {company.legalName ?? 'Majestic Cart'}</p>
              {company.registeredAddress && <p>{company.registeredAddress}</p>}
              {company.supportPhone && <p>Customer care: {company.supportPhone}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
