'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCart } from './CartProvider';
import { MAX_QUANTITY } from '@/lib/cart';
import { formatRupees } from '@/lib/money';

/**
 * The bag.
 *
 * Every price shown here is the snapshot taken when the item was added, and the
 * page says so. The server prices the order again at checkout, so a price that
 * changed in between is corrected there rather than silently carried through —
 * and the member sees the correction before they pay, not after.
 */
export function CartView() {
  const { cart, totals, ready, setQty, remove } = useCart();

  // `ready` guards this: without it the empty-bag message flashes on every load
  // for someone who has a full bag, which reads as the bag having been lost.
  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[var(--surface-tint)]" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
          ))}
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[var(--ink)]">Your bag is empty</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Nothing here yet. Have a look at what is in stock.
        </p>
        <Link
          href="/shop"
          className="mt-8 inline-block rounded-xl gold-foil px-7 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20"
        >
          Shop the range
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-serif text-3xl text-[var(--ink)]">Your bag</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        {/* ------------------------------------------------------- lines */}
        <ul className="space-y-3">
          {cart.lines.map((l) => (
            <li
              key={l.productId}
              className="flex gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <Link href={`/product/${l.slug}`} className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--page)]">
                {l.snapshot.imageUrl ? (
                  <Image src={l.snapshot.imageUrl} alt="" fill sizes="80px" className="object-cover" />
                ) : null}
              </Link>

              <div className="min-w-0 flex-1">
                <Link href={`/product/${l.slug}`} className="font-medium leading-snug text-[var(--ink)] hover:underline">
                  {l.snapshot.name}
                </Link>
                {l.snapshot.category && (
                  <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--faint)]">
                    {l.snapshot.category}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex items-center rounded-lg border border-[var(--line-strong)]">
                    <button
                      type="button"
                      onClick={() => setQty(l.productId, l.quantity - 1)}
                      aria-label={`Decrease quantity of ${l.snapshot.name}`}
                      className="px-3 py-1.5 text-[var(--body)]"
                    >
                      −
                    </button>
                    <span className="min-w-6 text-center text-sm font-semibold">{l.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQty(l.productId, l.quantity + 1)}
                      disabled={l.quantity >= MAX_QUANTITY}
                      aria-label={`Increase quantity of ${l.snapshot.name}`}
                      className="px-3 py-1.5 text-[var(--body)] disabled:text-[#D8C9D1]"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(l.productId)}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="text-right">
                <p className="font-semibold text-[var(--ink)]">
                  {formatRupees(l.snapshot.pricePaise * l.quantity)}
                </p>
                {l.quantity > 1 && (
                  <p className="mt-0.5 text-xs text-[var(--faint)]">
                    {formatRupees(l.snapshot.pricePaise)} each
                  </p>
                )}
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {((l.snapshot.bvCenti * l.quantity) / 100).toLocaleString('en-IN')} BV
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* ------------------------------------------------------ summary */}
        <aside className="h-fit rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 lg:sticky lg:top-24">
          <h2 className="font-serif text-lg text-[var(--ink)]">Summary</h2>

          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Subtotal</dt>
              <dd className="font-medium text-[var(--ink)]">{formatRupees(totals.subtotalPaise)}</dd>
            </div>
            {totals.savingsPaise > 0 && (
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">You save</dt>
                <dd className="font-medium text-[#3D8168]">−{formatRupees(totals.savingsPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Business volume</dt>
              <dd className="font-medium text-[var(--ink)]">
                {(totals.bvCenti / 100).toLocaleString('en-IN')} BV
              </dd>
            </div>
          </dl>

          {/* GST depends on the delivery state — CGST+SGST within it, IGST
              across it — which this page does not know. Promising a total
              before the address is chosen would mean showing the wrong one. */}
          <p className="mt-4 border-t border-[var(--line)] pt-4 text-xs leading-relaxed text-[var(--muted)]">
            GST and delivery are calculated at checkout, once the delivery address is chosen.
            Prices shown are from when each item was added and are confirmed again before you pay.
          </p>

          <Link
            href="/checkout"
            className="mt-5 block rounded-xl gold-foil px-6 py-3.5 text-center font-semibold text-white shadow-lg shadow-amber-900/20"
          >
            Checkout
          </Link>

          {/* Said here rather than discovered at checkout. */}
          <p className="mt-3 text-center text-xs text-[var(--muted)]">
            Paid from your shopping wallet
          </p>

          <Link
            href="/shop"
            className="mt-4 block text-center text-sm font-semibold text-[var(--accent)] hover:underline"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
