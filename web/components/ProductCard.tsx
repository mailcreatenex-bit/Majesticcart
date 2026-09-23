import Link from 'next/link';
import Image from 'next/image';
import type { CatalogProduct } from '@/lib/catalog';
import { discountPercent, showMoney, showVolume } from '@/lib/money';
import { CardAddToBag } from './CardAddToBag';

/**
 * A product in a grid.
 *
 * The card itself is a server component, so the image, name and price are plain
 * HTML a crawler reads without running anything. Only the quantity stepper and
 * "Add to cart" underneath are a client island (CardAddToBag), kept outside the
 * link so a tap on them never navigates away.
 *
 * `priority` on the first row only — those are the LCP candidates, and marking
 * every image priority preloads the whole grid and makes LCP worse, not better.
 */
export function ProductCard({ product, priority = false }: { product: CatalogProduct; priority?: boolean }) {
  const off = discountPercent(product.mrp.paise, product.price.paise);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] transition hover:shadow-lg hover:shadow-rose-900/5">
      <Link href={`/product/${product.slug}`} className="block flex-1">
      <div className="relative aspect-[4/5] overflow-hidden bg-[var(--page)]">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            priority={priority}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#C9B8C2]">
            {product.name}
          </div>
        )}

        {off !== null && (
          <span className="absolute left-3 top-3 rounded-full bg-[var(--ink)] px-2.5 py-1 text-[11px] font-semibold text-[var(--gold-pale)]">
            {off}% off
          </span>
        )}
        {!product.inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-[var(--ink)]/85 py-2 text-center text-xs font-semibold text-[var(--gold-pale)]">
            Out of stock
          </span>
        )}
      </div>

      <div className="p-4 pb-3">
        <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">
          {product.brand ? `${product.brand} · ${product.category}` : product.category}
        </p>
        {/* line-clamp keeps a long name from pushing the price out of alignment
            across the row. */}
        <h3 className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-[var(--ink)]">
          {product.name}
        </h3>

        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="font-semibold text-[var(--ink)]">{showMoney(product.price)}</span>
          {product.mrp.paise > product.price.paise && (
            <span className="text-xs text-[var(--faint)] line-through">{showMoney(product.mrp)}</span>
          )}
        </div>

        {/* BV is shown; what it pays is not. Earnings figures stay behind the
            login — see the income-claim lint in lib/seo.ts. */}
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">{showVolume(product.businessVolume)} per unit</p>
      </div>
      </Link>

      <div className="px-4 pb-3">
        <CardAddToBag product={product} />
      </div>
    </div>
  );
}

export function ProductGrid({ products, withSidebar = false }: { products: CatalogProduct[]; withSidebar?: boolean }) {
  if (products.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
        Nothing here just yet. New pieces are added every week.
      </p>
    );
  }

  return (
    // With a filter sidebar beside it the grid has a quarter less width, so it
    // stays at three columns on desktop to keep the cards the same size.
    <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${withSidebar ? '' : 'lg:grid-cols-4'}`}>
      {products.map((p, i) => (
        <ProductCard key={p.slug} product={p} priority={i < 4} />
      ))}
    </div>
  );
}
