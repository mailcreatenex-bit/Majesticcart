'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, showVolume, type MoneyView, type VolumeView } from '@/lib/money';
import { MemberShell, StatusPill } from './MemberShell';

/**
 * One order.
 *
 * Reached straight after checkout with `?placed=1`, so the top of this page is
 * also the order confirmation. That is deliberate: a separate "thank you" page
 * tells the member nothing they cannot see here, and they would have to
 * navigate again to find the order they just placed.
 */

interface OrderDetail {
  id: string;
  orderNo: string;
  status: string;
  totals: { subtotal: MoneyView; gst: MoneyView; total: MoneyView; businessVolume: VolumeView };
  shipping: { name: string; phone: string; line: string; city: string; state: string; pincode: string };
  items: {
    name: string; slug: string | null; imageUrl: string | null;
    price: MoneyView; mrp: MoneyView; businessVolume: VolumeView;
    gstPercent: number; quantity: number; lineTotal: MoneyView;
  }[];
  timeline: { status: string; note: string | null; at: string }[];
  invoice: { number: string; at: string } | null;
  placedAt: string;
  deliveredAt: string | null;
}

/** Statuses from which a member may still cancel themselves. */
const CANCELLABLE = new Set(['PLACED', 'PACKED']);

export function OrderDetailView({ orderId }: { orderId: string }) {
  return (
    <MemberShell title="Order">
      {(_, reload) => <Detail orderId={orderId} onChange={reload} />}
    </MemberShell>
  );
}

function Detail({ orderId, onChange }: { orderId: string; onChange: () => void }) {
  const params = useSearchParams();
  const justPlaced = params.get('placed') === '1';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const o = await api<OrderDetail>(`/me/orders/${orderId}`);
        if (!cancelled) { setOrder(o); setError(null); }
      } catch (err) {
        // The API answers 404 the same way for "not yours" and "does not
        // exist", so this message covers both without confirming which.
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this order.');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, nonce]);

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[#C0392B]">{error}</p>
        <Link href="/orders" className="mt-3 inline-block text-sm font-semibold text-[var(--accent)] hover:underline">
          ← All orders
        </Link>
      </div>
    );
  }

  if (!order) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />;
  }

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api(`/orders/${orderId}/cancel`, { method: 'POST', body: {} });
      setNonce((n) => n + 1);
      // The refund lands in the shopping wallet, so the balance in the header
      // is now stale.
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the order.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      {justPlaced && (
        <div role="status" className="rounded-2xl border border-[#9DC5B0] bg-[#E9F5EF] p-5">
          <h2 className="font-serif text-lg text-[#2C6B52]">Order placed</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[#2C6B52]">
            Paid from your shopping wallet. We will let you know when it ships.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-lg font-semibold text-[var(--ink)]">{order.orderNo}</p>
            <p className="mt-1 text-xs text-[var(--faint)]">Placed {formatDate(order.placedAt, { time: true })}</p>
          </div>
          <StatusPill status={order.status} />
        </div>

        {/* An invoice number is assigned at delivery, not at payment: supply is
            what triggers a GST invoice. So an order that is paid for but not
            yet delivered genuinely has none to offer. */}
        {order.invoice ? (
          <a
            href={`/api/invoices/order/${order.id}/html`}
            target="_blank"
            rel="noopener"
            className="mt-4 inline-block rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
          >
            Download invoice {order.invoice.number}
          </a>
        ) : (
          <p className="mt-4 text-xs text-[var(--muted)]">
            The GST invoice is issued when the order is delivered.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------- timeline */}
      {order.timeline.length > 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">Progress</h2>
          <ol className="mt-4 space-y-4">
            {order.timeline.map((e, i) => (
              <li key={`${e.status}-${e.at}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${i === order.timeline.length - 1 ? 'bg-[var(--accent)]' : 'bg-[#D8C9D1]'}`} />
                  {i < order.timeline.length - 1 && <span className="mt-1 w-px flex-1 bg-[#EEE3E8]" />}
                </div>
                <div className="pb-1">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {e.status.charAt(0) + e.status.slice(1).toLowerCase()}
                  </p>
                  <p className="text-xs text-[var(--faint)]">{formatDate(e.at, { time: true })}</p>
                  {e.note && <p className="mt-1 text-xs text-[var(--body)]">{e.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---------------------------------------------------------- items */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-serif text-lg text-[var(--ink)]">Items</h2>

        <ul className="mt-4 divide-y divide-[var(--line)]">
          {order.items.map((item, i) => (
            <li key={`${item.name}-${i}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--page)]">
                {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                {/* The name is a snapshot taken when the order was placed, so
                    a later rename does not rewrite history. It links to the
                    product only if that product still exists. */}
                {item.slug ? (
                  <Link href={`/product/${item.slug}`} className="text-sm font-medium text-[var(--ink)] hover:underline">
                    {item.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-[var(--ink)]">{item.name}</span>
                )}
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {showMoney(item.price)} × {item.quantity} · {showVolume(item.businessVolume)} each
                </p>
              </div>
              <p className="shrink-0 font-semibold text-[var(--ink)]">{showMoney(item.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
          <div className="flex justify-between text-base font-semibold text-[var(--ink)]">
            <dt>Paid from wallet</dt>
            <dd>{showMoney(order.totals.total)}</dd>
          </div>
          {/* Indented, because GST is inside the total rather than added to it
              — Indian prices are quoted GST-inclusive. */}
          <div className="flex justify-between pl-3 text-xs">
            <dt className="text-[var(--muted)]">of which GST</dt>
            <dd className="text-[var(--muted)]">{showMoney(order.totals.gst)}</dd>
          </div>
          <div className="flex justify-between pt-1">
            <dt className="text-[var(--muted)]">Business volume</dt>
            <dd className="text-[var(--ink)]">{showVolume(order.totals.businessVolume)}</dd>
          </div>
        </dl>
      </section>

      {/* ------------------------------------------------------- delivery */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-serif text-lg text-[var(--ink)]">Delivery address</h2>
        <address className="mt-3 text-sm not-italic leading-relaxed text-[var(--body)]">
          {order.shipping.name}<br />
          {order.shipping.line}<br />
          {order.shipping.city}, {order.shipping.state} {order.shipping.pincode}<br />
          {order.shipping.phone}
        </address>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/orders" className="text-sm font-semibold text-[var(--accent)] hover:underline">
          ← All orders
        </Link>

        {CANCELLABLE.has(order.status) && (
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling}
            className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[#A5342A] hover:bg-[#FDECEA] disabled:text-[var(--faint)]"
          >
            {cancelling ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
        {CANCELLABLE.has(order.status) && (
          <span className="text-xs text-[var(--muted)]">
            The amount goes back to your shopping wallet.
          </span>
        )}
      </div>
    </div>
  );
}
