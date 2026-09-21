'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, showVolume, type MoneyView, type VolumeView } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton, useAdmin } from './AdminShell';

/**
 * The fulfilment queue.
 *
 * Opens on what needs doing — placed and packed — rather than on everything.
 * The address is on the card because that is what gets copied onto a parcel,
 * and having to open each order to read it is the difference between packing
 * twenty and packing five.
 *
 * `Delivered` is the consequential one and it is styled as such: delivery is
 * what runs the commission and what assigns the GST invoice number. It cannot
 * be undone by moving the status back — a delivered order is returned, which is
 * a separate action restricted to ADMIN because it reverses commission that may
 * already have been withdrawn.
 */

interface AdminOrder {
  id: string;
  orderNo: string;
  status: string;
  total: MoneyView;
  businessVolume: VolumeView;
  member: { memberCode: string; name: string; phone: string };
  shipping: { name: string; phone: string; line: string; city: string; state: string; pincode: string };
  items: string[];
  invoiceNo: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

/** What each status may become, mirroring the server's transition table. */
const NEXT: Record<string, { status: string; label: string; consequential?: boolean }[]> = {
  PLACED: [
    { status: 'PACKED', label: 'Mark packed' },
    { status: 'CANCELLED', label: 'Cancel' },
  ],
  PACKED: [
    { status: 'SHIPPED', label: 'Mark shipped' },
    { status: 'CANCELLED', label: 'Cancel' },
  ],
  SHIPPED: [
    { status: 'DELIVERED', label: 'Mark delivered', consequential: true },
  ],
};

export function OrderQueueView() {
  return (
    <AdminShell
      title="Orders"
      subtitle="Pack, ship, and mark delivered. Delivery is what pays commission."
      roles={['ADMIN', 'SUPPORT']}
    >
      <Queue />
    </AdminShell>
  );
}

function Queue() {
  const [filter, setFilter] = useState('OPEN');
  const [rows, setRows] = useState<AdminOrder[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: string, after: string | null) => {
    const qs = new URLSearchParams({ status });
    if (after) qs.set('cursor', after);
    const page = await api<{ items: AdminOrder[]; nextCursor: string | null }>(`/admin/orders?${qs}`);
    setRows((prev) => (after ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    (async () => {
      try {
        await load(filter, null);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load orders.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter, load]);

  /** Replace the row in place rather than reloading, to keep the operator's place. */
  const update = (id: string, next: Partial<AdminOrder>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {[
          ['OPEN', 'To do'],
          ['PLACED', 'Placed'],
          ['PACKED', 'Packed'],
          ['SHIPPED', 'Shipped'],
          ['DELIVERED', 'Delivered'],
          ['CANCELLED', 'Cancelled'],
          ['ALL', 'All'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filter === value ? 'bg-neutral-900 text-white' : 'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <AdminError message={error} />}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <AdminEmpty>
          {filter === 'OPEN' ? 'Nothing to pack or ship. Every order is on its way.' : 'No orders here.'}
        </AdminEmpty>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => <OrderCard key={o.id} order={o} onUpdate={(n) => update(o.id, n)} />)}
        </ul>
      )}

      {cursor && !loading && (
        <button
          type="button"
          onClick={() => void load(filter, cursor)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function OrderCard({ order, onUpdate }: { order: AdminOrder; onUpdate: (n: Partial<AdminOrder>) => void }) {
  const admin = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [copied, setCopied] = useState(false);

  const transitions = NEXT[order.status] ?? [];

  const move = async (status: string) => {
    if (busy) return;
    setBusy(status);
    setError(null);
    try {
      await api(`/admin/orders/${order.id}/status`, { method: 'POST', body: { status } });
      onUpdate({ status });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this order.');
    } finally {
      setBusy(null);
    }
  };

  const doReturn = async () => {
    if (!reason.trim() || busy) return;
    setBusy('return');
    setError(null);
    try {
      await api(`/admin/orders/${order.id}/return`, {
        method: 'POST',
        body: { reason: reason.trim(), restock },
      });
      onUpdate({ status: 'RETURNED' });
      setReturning(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not return this order.');
    } finally {
      setBusy(null);
    }
  };

  const addressText = [
    order.shipping.name,
    order.shipping.line,
    `${order.shipping.city}, ${order.shipping.state} ${order.shipping.pincode}`,
    order.shipping.phone,
  ].join('\n');

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-neutral-900">
            {order.orderNo}
            <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-sans font-semibold text-neutral-700">
              {order.status.charAt(0) + order.status.slice(1).toLowerCase()}
            </span>
          </p>
          <p className="mt-1 text-sm text-neutral-700">{order.items.join(', ')}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {order.member.name} · {order.member.memberCode} · placed {formatDate(order.createdAt, { time: true })}
          </p>
        </div>

        <div className="text-right">
          <p className="font-semibold tabular-nums text-neutral-900">{showMoney(order.total)}</p>
          <p className="text-xs text-neutral-500">{showVolume(order.businessVolume)}</p>
          {order.invoiceNo && <p className="mt-0.5 text-[11px] text-neutral-400">Invoice {order.invoiceNo}</p>}
        </div>
      </div>

      {/* The address is on the card, not one click away: it is what gets copied
          onto the parcel, and opening each order to read it is the difference
          between packing twenty and packing five. */}
      <div className="mt-3 flex items-start gap-3 rounded-lg bg-neutral-50 p-3">
        <address className="flex-1 whitespace-pre-line text-xs not-italic leading-relaxed text-neutral-700">
          {addressText}
        </address>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(addressText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch { setCopied(false); }
          }}
          className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {returning ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs leading-relaxed text-red-800">
            Returning a delivered order reverses the commission it paid — which may already have
            been withdrawn, leaving a negative income wallet until it is earned back. The reason is
            recorded in the audit log.
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            placeholder="Why is this being returned?"
            className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <label className="mt-2 flex items-center gap-2 text-xs text-red-800">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            Put the stock back
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={doReturn}
              disabled={reason.trim().length < 4 || !!busy}
              className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:bg-neutral-300"
            >
              {busy === 'return' ? 'Returning…' : 'Confirm return'}
            </button>
            <button
              type="button"
              onClick={() => { setReturning(false); setReason(''); }}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button
              key={t.status}
              type="button"
              onClick={() => move(t.status)}
              disabled={!!busy}
              className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:bg-neutral-300 disabled:text-neutral-500 ${
                t.consequential
                  ? 'bg-neutral-900 text-white'
                  : 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {busy === t.status ? 'Working…' : t.label}
            </button>
          ))}

          {/* Only after delivery, and only for ADMIN — the server enforces the
              role too, so this is about not offering a button that 403s. */}
          {order.status === 'DELIVERED' && admin.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => setReturning(true)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              Return
            </button>
          )}

          {transitions.length === 0 && order.status !== 'DELIVERED' && (
            <p className="text-xs text-neutral-500">
              No further action — {order.status.toLowerCase()} is a final state.
            </p>
          )}
        </div>
      )}

      {order.status === 'SHIPPED' && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          Marking this delivered runs the commission and issues the GST invoice. It cannot be moved
          back afterwards — a delivered order is returned instead.
        </p>
      )}
    </li>
  );
}
