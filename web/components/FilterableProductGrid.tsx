'use client';

import { useMemo, useState } from 'react';
import type { CatalogProduct } from '@/lib/catalog';
import { ProductGrid } from './ProductCard';

type SortKey = 'featured' | 'price_asc' | 'price_desc' | 'discount' | 'bv_desc';

const rupees = (paise: number) => paise / 100;
const bvOf = (p: CatalogProduct) => p.businessVolume.centi / 100;

/** An empty box means "no limit"; anything that is not a number is treated the same. */
const parseBound = (v: string): number | null => {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
};

/**
 * Category, brand, price and business-volume filters plus a sort, over a
 * product grid that is already on the page — no fetch, no URL, no query string.
 *
 * This is the client-side half of the filtering the shop/category/brand pages
 * deliberately don't do server-side: a filter in the URL would multiply into an
 * unbounded set of crawlable permutations (category × brand × price × BV), each
 * a near-duplicate of the page. Nothing here touches the URL, so there is
 * nothing for a crawler to index — only something for a visitor who already
 * landed on a real page to narrow down with.
 *
 * The category and brand groups are built from the products passed in, so on a
 * category or brand page, where every product shares one value, that group
 * simply does not appear.
 */
export function FilterableProductGrid({ products }: { products: CatalogProduct[] }) {
  const categories = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.categorySlug, p.category);
    return [...m].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const brands = useMemo(() => {
    const s = new Set<string>();
    for (const p of products) if (p.brand) s.add(p.brand);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const priceRange = useMemo(() => {
    const v = products.map((p) => rupees(p.price.paise));
    return v.length ? { min: Math.floor(Math.min(...v)), max: Math.ceil(Math.max(...v)) } : { min: 0, max: 0 };
  }, [products]);
  const bvRange = useMemo(() => {
    const v = products.map(bvOf);
    return v.length ? { min: Math.floor(Math.min(...v)), max: Math.ceil(Math.max(...v)) } : { min: 0, max: 0 };
  }, [products]);

  const [sort, setSort] = useState<SortKey>('featured');
  const [selCategories, setSelCategories] = useState<string[]>([]);
  const [selBrands, setSelBrands] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [bvMin, setBvMin] = useState('');
  const [bvMax, setBvMax] = useState('');
  const [open, setOpen] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const activeCount =
    (selCategories.length ? 1 : 0) + (selBrands.length ? 1 : 0) +
    (priceMin || priceMax ? 1 : 0) + (bvMin || bvMax ? 1 : 0);

  const clear = () => {
    setSelCategories([]);
    setSelBrands([]);
    setPriceMin('');
    setPriceMax('');
    setBvMin('');
    setBvMax('');
  };

  const filtered = useMemo(() => {
    const pMin = parseBound(priceMin);
    const pMax = parseBound(priceMax);
    const vMin = parseBound(bvMin);
    const vMax = parseBound(bvMax);

    const kept = products.filter((p) => {
      const price = rupees(p.price.paise);
      const bv = bvOf(p);
      if (selCategories.length && !selCategories.includes(p.categorySlug)) return false;
      if (selBrands.length && !(p.brand && selBrands.includes(p.brand))) return false;
      if (pMin !== null && price < pMin) return false;
      if (pMax !== null && price > pMax) return false;
      if (vMin !== null && bv < vMin) return false;
      if (vMax !== null && bv > vMax) return false;
      return true;
    });

    const discount = (p: CatalogProduct) => (p.mrp.paise > 0 ? (p.mrp.paise - p.price.paise) / p.mrp.paise : 0);
    switch (sort) {
      case 'price_asc': return [...kept].sort((a, b) => a.price.paise - b.price.paise);
      case 'price_desc': return [...kept].sort((a, b) => b.price.paise - a.price.paise);
      case 'discount': return [...kept].sort((a, b) => discount(b) - discount(a));
      case 'bv_desc': return [...kept].sort((a, b) => b.businessVolume.centi - a.businessVolume.centi);
      default: return kept;
    }
  }, [products, sort, selCategories, selBrands, priceMin, priceMax, bvMin, bvMax]);

  if (products.length === 0) return <ProductGrid products={products} />;

  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition ${
      on
        ? 'border-[var(--ink)] bg-[var(--ink)] font-semibold text-[var(--gold-pale)]'
        : 'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--body)] hover:bg-[var(--surface-tint)]'
    }`;
  const input =
    'w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none';
  const legend = 'mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]';

  return (
    <div>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="product-filters"
            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 font-semibold text-[var(--ink)] md:hidden"
          >
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>

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
              <option value="bv_desc">Highest BV</option>
              <option value="discount">Biggest discount</option>
            </select>
          </label>

          <span className="ml-auto text-xs text-[var(--faint)]">
            {filtered.length} of {products.length} shown
          </span>
        </div>

        <div id="product-filters" className={`${open ? 'block' : 'hidden'} md:block`}>
          <div className="mt-4 grid gap-5 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
            {categories.length > 1 && (
              <fieldset>
                <legend className={legend}>Category</legend>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => {
                    const on = selCategories.includes(c.slug);
                    return (
                      <button key={c.slug} type="button" aria-pressed={on} onClick={() => toggle(selCategories, setSelCategories, c.slug)} className={chip(on)}>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {brands.length > 1 && (
              <fieldset>
                <legend className={legend}>Brand</legend>
                <div className="flex flex-wrap gap-2">
                  {brands.map((b) => {
                    const on = selBrands.includes(b);
                    return (
                      <button key={b} type="button" aria-pressed={on} onClick={() => toggle(selBrands, setSelBrands, b)} className={chip(on)}>
                        {b}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {priceRange.max > priceRange.min && (
              <fieldset>
                <legend className={legend}>Price range (₹)</legend>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder={`Min ${priceRange.min.toLocaleString('en-IN')}`} aria-label="Minimum price in rupees" className={input} />
                  <span aria-hidden="true" className="text-[var(--faint)]">–</span>
                  <input type="number" inputMode="numeric" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder={`Max ${priceRange.max.toLocaleString('en-IN')}`} aria-label="Maximum price in rupees" className={input} />
                </div>
              </fieldset>
            )}

            {bvRange.max > bvRange.min && (
              <fieldset>
                <legend className={legend}>Business volume (BV)</legend>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" min={0} value={bvMin} onChange={(e) => setBvMin(e.target.value)} placeholder={`Min ${bvRange.min.toLocaleString('en-IN')}`} aria-label="Minimum business volume" className={input} />
                  <span aria-hidden="true" className="text-[var(--faint)]">–</span>
                  <input type="number" inputMode="numeric" min={0} value={bvMax} onChange={(e) => setBvMax(e.target.value)} placeholder={`Max ${bvRange.max.toLocaleString('en-IN')}`} aria-label="Maximum business volume" className={input} />
                </div>
              </fieldset>
            )}
          </div>

          {activeCount > 0 && (
            <button type="button" onClick={clear} className="mt-4 text-sm font-semibold text-[var(--accent)] hover:underline">
              Clear all filters
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {filtered.length > 0 ? (
          <ProductGrid products={filtered} />
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
            <p className="font-serif text-lg text-[var(--ink)]">No products match these filters</p>
            <button type="button" onClick={clear} className="mt-3 text-sm font-semibold text-[var(--accent)] hover:underline">
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
