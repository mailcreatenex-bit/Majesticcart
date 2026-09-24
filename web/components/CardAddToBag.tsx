'use client';

import { useEffect, useState } from 'react';
import { useCart } from './CartProvider';
import { useT } from './LocaleProvider';
import { MAX_QUANTITY } from '@/lib/cart';
import type { CatalogProduct } from '@/lib/catalog';

/**
 * Quantity stepper and "Add to cart" under a product card.
 *
 * Same behaviour as the product page's AddToBag, compact enough for a grid: pick
 * a quantity, add it, and the card says how many are now in the bag. It does
 * not check the wallet balance — that wall is at checkout, where it can explain
 * itself.
 *
 * It sits outside the card's link, so tapping a button never navigates away.
 */
export function CardAddToBag({ product }: { product: CatalogProduct }) {
  const t = useT();
  const { add, cart } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(false), 1600);
    return () => clearTimeout(t);
  }, [justAdded]);

  const inBag = cart.lines.find((l) => l.productId === product.id);

  if (!product.inStock) {
    return (
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded-xl border border-[var(--line-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--faint)]"
      >
        Out of stock
      </button>
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
    setJustAdded(true);
  };

  return (
    <div>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-xl border border-[var(--line-strong)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label={`Decrease quantity of ${product.name}`}
            className="px-4 py-2 text-lg leading-none text-[var(--body)] disabled:text-[var(--faint)]"
          >
            −
          </button>
          <span aria-live="polite" className="min-w-6 text-center text-sm font-semibold text-[var(--ink)]">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
            disabled={quantity >= MAX_QUANTITY}
            aria-label={`Increase quantity of ${product.name}`}
            className="px-4 py-2 text-lg leading-none text-[var(--body)] disabled:text-[var(--faint)]"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-xl gold-foil px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-900/20"
        >
          {justAdded ? t('shop.added') : t('shop.addToBag')}
        </button>
      </div>

      {/* Reserved height, so a card does not jump when the count appears. */}
      <p aria-live="polite" className="mt-1.5 h-4 text-[11px] text-[var(--muted)]">
        {inBag ? `${inBag.quantity} in your bag` : ''}
      </p>
    </div>
  );
}
