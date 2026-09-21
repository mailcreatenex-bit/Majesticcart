'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, showVolume, type MoneyView, type VolumeView } from '@/lib/money';
import { MemberShell, EmptyState, StatusPill } from './MemberShell';

/**
 * Order history.
 *
 * The status is the point of this screen. On a wallet-funded site the member
 * has already paid, so "where is it" is the only question left — and the
 * answer has to be visible without opening anything.
 *
 * The invoice link appears only once an order is delivered, because that is
 * when the invoice number is assigned. Supply is what triggers a GST invoice,
 * not payment, so an order that is paid for but not yet delivered genuinely has
 * no invoice to download.
 */

interface OrderSummary {
  id: string;
  orderNo: string;
  status: string;
  total: MoneyView;
  businessVolume: VolumeView;
  invoiceNo: string | null;
  placedAt: string;
  deliveredAt: string | null;
  summary: string[];
  itemCount: number;
}

export function OrdersView() {
  return (
    <MemberShell title="Orders">
      {() => <OrderList />}
    </MemberShell>
  );
}

function OrderList() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after: string | null) => {
    const qs = after ? `?cursor=${encodeURIComponent(after)}` : '';
    const page = await api<{ orders: OrderSummary[]; nextCursor: string | null }>(`/me/orders${qs}`);
    setOrders((prev) => (after ? [...prev, ...page.orders] : page.orders));
    setCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your orders.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />)}
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>;
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        body="Everything you order will appear here, with its status and invoice."
        action={
          <Link href="/shop" className="rounded-xl bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--gold-pale)]">
            Shop the range
          </Link>
        }
      />
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/orders/${o.id}`}
              className="block rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 transition hover:border-[var(--line-strong)] hover:shadow-lg hover:shadow-rose-900/5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-[var(--ink)]">{o.orderNo}</span>
                    <StatusPill status={o.status} />
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--body)]">
                    {o.summary.join(', ')}
                    {/* The list shows three; this says how many more there are
                        rather than silently truncating. */}
                    {o.itemCount > o.summary.length && (
                      <span className="text-[var(--muted)]"> +{o.itemCount - o.summary.length} more</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--faint)]">
                    Placed {formatDate(o.placedAt)}
                    {o.deliveredAt && ` · Delivered ${formatDate(o.deliveredAt)}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-semibold text-[var(--ink)]">{showMoney(o.total)}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{showVolume(o.businessVolume)}</p>
                  {o.invoiceNo && (
                    <p className="mt-1 text-[11px] text-[var(--faint)]">Invoice {o.invoiceNo}</p>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          onClick={async () => {
            setLoadingMore(true);
            try { await load(cursor); } catch { setError('Could not load more orders.'); }
            finally { setLoadingMore(false); }
          }}
          disabled={loadingMore}
          className="mt-4 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:text-[var(--faint)]"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
