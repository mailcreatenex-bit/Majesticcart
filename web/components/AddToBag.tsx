'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from './CartProvider';
import { useT } from './LocaleProvider';
import { MAX_QUANTITY } from '@/lib/cart';
import type { CatalogProduct } from '@/lib/catalog';

/**
 * Add to bag, on the product page.
 *
 * The only interactive island on an otherwise static page: everything else on
 * the product page is server-rendered HTML a crawler can read without running
 * anything.
 *
 * It does not check the wallet balance. A member with an empty wallet can fill
 * their bag; the wall is at checkout, where it can explain itself and offer the
 * recharge with the right amount already filled in. Refusing to add to the bag
 * would be a dead end with nothing to do next.
 */
export function AddToBag({ product }: { product: CatalogProduct }) {
  const t = useT();
  const { add, cart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const inBag = cart.lines.find((l) => l.productId === product.id);

  if (!product.inStock) {
    return (
      <div className="mt-6 rounded-xl border border-[var(--line-strong)] bg-[var(--page)] px-5 py-4 text-sm text-[var(--muted)]">
        Out of stock. This product will be back — check the shop for what is available now.
      </div>
    );
  }

  const onAdd = () => {
    add({
      productId: product.id,
      slug: product.slug,
      quantity,
      snapshot: {
        name: product.name,
        pricePaise: product.price.paise,
        mrpPaise: product.mrp.paise,
        bvCenti: product.businessVolume.centi,
        imageUrl: product.imageUrl,
        category: product.category,
      },
    });
    setAdded(true);
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="px-4 py-3 text-lg text-[var(--body)] disabled:text-[#D8C9D1]"
          >
            −
          </button>
          <span aria-live="polite" className="min-w-8 text-center font-semibold text-[var(--ink)]">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
            disabled={quantity >= MAX_QUANTITY}
            aria-label="Increase quantity"
            className="px-4 py-3 text-lg text-[var(--body)] disabled:text-[#D8C9D1]"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="flex-1 rounded-xl gold-foil px-7 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20"
        >
          {t('shop.addToBag')}
        </button>
      </div>

      {/* Confirmation with somewhere to go. "Added to bag" on its own leaves the
          member wondering whether it worked and where it went. */}
      {(added || inBag) && (
        <p aria-live="polite" className="mt-3 text-sm text-[var(--body)]">
          {inBag ? `${inBag.quantity} in your bag.` : 'Added to your bag.'}{' '}
          <Link href="/cart" className="font-semibold text-[var(--accent)] hover:underline">
            View bag →
          </Link>
        </p>
      )}
    </div>
  );
}
