'use client';

import { useMemo, useState } from 'react';
import type { CatalogProduct } from '@/lib/catalog';
import { ProductGrid } from './ProductCard';

type SortKey = 'featured' | 'price_asc' | 'price_desc' | 'discount';

/**
 * Sort and price-range controls over a product grid that's already on the
 * page — no fetch, no URL, no query string.
 *
 * This is the client-side half of the filtering the shop/category/brand
 * pages deliberately don't do server-side: see the comment in
 * app/(shop)/shop/page.tsx on why a price-range query string is a page a
 * crawler shouldn't be able to reach. Sliding this range never changes the
 * URL, so there is nothing here for a crawler to index — only something for
 * a visitor who already landed on a real page to narrow down with.
 */
export function FilterableProductGrid({ products }: { products: CatalogProduct[] }) {
  const rupees = (paise: number) => paise / 100;
  const prices = products.map((p) => rupees(p.price.paise));
  const floor = products.length ? Math.floor(Math.min(...prices)) : 0;
  const ceil = products.length ? Math.ceil(Math.max(...prices)) : 0;

  const [sort, setSort] = useState<SortKey>('featured');
  const [maxPrice, setMaxPrice] = useState(ceil);

  const filtered = useMemo(() => {
    const inRange = products.filter((p) => rupees(p.price.paise) <= maxPrice);
    switch (sort) {
      case 'price_asc':
        return [...inRange].sort((a, b) => a.price.paise - b.price.paise);
      case 'price_desc':
        return [...inRange].sort((a, b) => b.price.paise - a.price.paise);
      case 'discount':
        return [...inRange].sort((a, b) => {
          const discA = a.mrp.paise > 0 ? (a.mrp.paise - a.price.paise) / a.mrp.paise : 0;
          const discB = b.mrp.paise > 0 ? (b.mrp.paise - b.price.paise) / b.mrp.paise : 0;
          return discB - discA;
        });
      default:
        return inRange;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sort, maxPrice]);

  if (products.length === 0) return <ProductGrid products={products} />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
        <label className="flex items-center gap-2 text-[var(--body)]">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1.5 text-sm focus:border-[var(--ink)] focus:outline-none"
          >
            <option value="featured">Featured</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="discount">Biggest discount</option>
          </select>
        </label>

        {ceil > floor && (
          <label className="flex flex-1 items-center gap-3 text-[var(--body)] sm:min-w-[220px]">
            <span className="whitespace-nowrap">Up to ₹{maxPrice.toLocaleString('en-IN')}</span>
            <input
              type="range"
              min={floor}
              max={ceil}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="w-full accent-[var(--ink)]"
            />
          </label>
        )}

        <span className="ml-auto text-xs text-[var(--faint)]">
          {filtered.length} of {products.length} shown
        </span>
      </div>

      <div className="mt-4">
        <ProductGrid products={filtered} />
      </div>
    </div>
  );
}
