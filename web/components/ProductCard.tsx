import Link from 'next/link';
import Image from 'next/image';
import type { CatalogProduct } from '@/lib/catalog';
import { discountPercent, showMoney, showVolume } from '@/lib/money';
import { playChipClass } from '@/lib/playColors';
import { CardAddToBag } from './CardAddToBag';
import { WishButton } from './WishButton';

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
    <div className="group relative flex flex-col overflow-hidden bg-[var(--surface)] transition sm:rounded-2xl sm:border sm:border-[var(--line)] sm:hover:shadow-lg sm:hover:shadow-rose-900/5">
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

        {off !== null && off >= 20 && (
          <span className="absolute left-0 top-3 bg-[var(--play-violet)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            Hot deal
          </span>
        )}
        {!product.inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-[var(--ink)]/85 py-2 text-center text-xs font-semibold text-[var(--gold-pale)]">
            Out of stock
          </span>
        )}
      </div>

      <div className="p-3 pb-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${playChipClass(product.category)}`}>
            {product.category}
          </span>
          {product.brand && (
            <span className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{product.brand}</span>
          )}
        </div>
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
          {off !== null && <span className="text-xs font-bold text-emerald-700">{off}% off</span>}
        </div>

        {/* BV is shown; what it pays is not. Earnings figures stay behind the
            login — see the income-claim lint in lib/seo.ts. */}
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">{showVolume(product.businessVolume)} per unit</p>
      </div>
      </Link>

      {/* Outside the link, so tapping the heart saves rather than navigates. */}
      <WishButton slug={product.slug} name={product.name} className="absolute right-2 top-2" />

      <div className="px-3 pb-3 sm:px-4">
        <CardAddToBag product={product} />
      </div>
    </div>
  );
}

/**
 * `row` turns the phone layout into a single horizontally swiping row (the
 * "Handpicked for you" shelf pattern of shopping apps) instead of a two-column
 * grid; from sm up it is the same grid either way, so one set of cards
 * serves both rather than rendering the products twice.
 */
export function ProductGrid({ products, withSidebar = false, row = false }: { products: CatalogProduct[]; withSidebar?: boolean; row?: boolean }) {
  if (products.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
        Nothing here just yet. New pieces are added every week.
      </p>
    );
  }

  const grid = `sm:mx-0 sm:grid sm:gap-4 sm:bg-transparent sm:grid-cols-3 ${withSidebar ? '' : 'lg:grid-cols-4'}`;
  return (
    // With a filter sidebar beside it the grid has a quarter less width, so it
    // stays at three columns on desktop to keep the cards the same size.
    <div
      className={
        row
          ? `no-scrollbar -mx-4 flex snap-x snap-mandatory gap-px overflow-x-auto bg-[var(--line)] ${grid}`
          : `-mx-4 grid grid-cols-2 gap-px bg-[var(--line)] ${grid}`
      }
    >
      {products.map((p, i) =>
        row ? (
          <div key={p.slug} className="w-[46vw] shrink-0 snap-start sm:w-auto">
            <ProductCard product={p} priority={i < 4} />
          </div>
        ) : (
          <ProductCard key={p.slug} product={p} priority={i < 4} />
        ),
      )}
    </div>
  );
}
