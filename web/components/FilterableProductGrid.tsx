'use client';

import { useMemo, useState } from 'react';
import { categoryTree, type CatalogCategory, type CatalogProduct } from '@/lib/catalog';
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
export function FilterableProductGrid({ products, allCategories }: { products: CatalogProduct[]; allCategories?: CatalogCategory[] }) {
  // The catalogue's own category tree (departments and their sub-categories) when the
  // page supplies it; otherwise the filter falls back to whatever the products carry.
  const tree = useMemo(() => categoryTree(allCategories ?? []).filter((d) => d.children.length > 0), [allCategories]);
  const parentOf = useMemo(() => {
    const byId = new Map((allCategories ?? []).map((c) => [c.id, c.slug]));
    return new Map((allCategories ?? []).filter((c) => c.parentId).map((c) => [c.slug, byId.get(c.parentId as string) ?? null]));
  }, [allCategories]);
  /** A product belongs to its own category and to that category's department. */
  const inCategory = (p: CatalogProduct, slug: string) => p.categorySlug === slug || parentOf.get(p.categorySlug) === slug;

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
      if (selCategories.length && !selCategories.some((s) => inCategory(p, s))) return false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, sort, selCategories, selBrands, priceMin, priceMax, bvMin, bvMax, parentOf]);

  if (products.length === 0) return <ProductGrid products={products} />;

  const countBy = (pick: (p: CatalogProduct) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const p of products) {
      const k = pick(p);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const categoryCounts = countBy((p) => p.categorySlug);
  const countIn = (slug: string) => products.filter((p) => inCategory(p, slug)).length;
  const brandCounts = countBy((p) => p.brand);

  const input =
    'w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none';
  const legend = 'mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]';

  const checkRow = (key: string, label: string, count: number | undefined, on: boolean, onToggle: () => void) => (
    <label key={key} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-[var(--body)] hover:text-[var(--ink)]">
      <input type="checkbox" checked={on} onChange={onToggle} className="h-4 w-4 shrink-0 rounded accent-[var(--ink)]" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-[var(--faint)]">{count}</span>}
    </label>
  );

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* Filters: a left sidebar from `lg` up, a collapsible panel below it. */}
      <aside className="mb-4 lg:sticky lg:top-28 lg:mb-0">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="product-filters"
              className="font-semibold text-[var(--ink)] lg:pointer-events-none"
            >
              Filters{activeCount > 0 ? ` (${activeCount})` : ''}
              <span aria-hidden="true" className="ml-2 text-[var(--muted)] lg:hidden">{open ? '−' : '+'}</span>
            </button>
            {activeCount > 0 && (
              <button type="button" onClick={clear} className="text-xs font-semibold text-[var(--accent)] hover:underline">
                Clear all
              </button>
            )}
          </div>

          <div id="product-filters" className={`${open ? 'block' : 'hidden'} lg:block`}>
            <div className="mt-4 space-y-6 border-t border-[var(--line)] pt-4">
              {tree.length > 0 ? (
                <fieldset>
                  <legend className={legend}>Category</legend>
                  <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                    {tree.map((d) => (
                      <div key={d.slug}>
                        {checkRow(d.slug, d.name, countIn(d.slug), selCategories.includes(d.slug), () => toggle(selCategories, setSelCategories, d.slug))}
                        <div className="ml-5 border-l border-[var(--line)] pl-2">
                          {d.children.map((c) =>
                            checkRow(c.slug, c.name, countIn(c.slug), selCategories.includes(c.slug), () => toggle(selCategories, setSelCategories, c.slug)),
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ) : categories.length > 1 && (
                <fieldset>
                  <legend className={legend}>Category</legend>
                  {categories.map((c) =>
                    checkRow(c.slug, c.name, categoryCounts.get(c.slug), selCategories.includes(c.slug), () => toggle(selCategories, setSelCategories, c.slug)),
                  )}
                </fieldset>
              )}

              {brands.length > 1 && (
                <fieldset>
                  <legend className={legend}>Brand</legend>
                  {brands.map((b) => checkRow(b, b, brandCounts.get(b), selBrands.includes(b), () => toggle(selBrands, setSelBrands, b)))}
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
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
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

        <div className="mt-4">
          {filtered.length > 0 ? (
            <ProductGrid products={filtered} withSidebar />
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
    </div>
  );
}
