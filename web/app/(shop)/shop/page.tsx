import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription, breadcrumbJsonLd } from '@/lib/seo';
import { listProducts, listCategories, listBrands } from '@/lib/catalog';
import { FilterableProductGrid } from '@/components/FilterableProductGrid';

/**
 * The full catalogue.
 *
 * Deliberately has no filter state in the URL. Filters would multiply into an
 * unbounded set of crawlable permutations — colour × price × category × sort —
 * each one a near-duplicate of this page, which is how a small catalogue ends
 * up with thousands of thin indexed URLs competing with each other.
 *
 * Category pages carry the segmentation instead. They are a fixed, small set,
 * they are in the sitemap, and each one has copy of its own.
 *
 * Next requires `revalidate` to be a literal it can read without executing the module,
 * so it cannot be the imported CATALOG_REVALIDATE. The two are held together by
 * a test in __tests__/seo.spec.ts rather than by whoever edits one of them next.
 */
export const revalidate = 3600;

const DESCRIPTION =
  'Makeup, skin care, body care and fragrance from leading beauty brands, all in one place.';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Shop all products'),
  description: metaDescription(DESCRIPTION),
  pathname: '/shop',
});

export default async function ShopPage() {
  const [products, categories, brands] = await Promise.all([listProducts(), listCategories(), listBrands()]);

  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Shop', path: '/shop' },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
          <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--body)]">Shop</span>
        </nav>

        <h1 className="mt-3 font-serif text-3xl text-[var(--ink)]">All products</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">{DESCRIPTION}</p>

        {/* Plain links, not a filter widget: each one is a real indexable page
            rather than a query-string variant of this one. */}
        <nav aria-label="Categories" className="mt-6 flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--gold-pale)]">
            All
          </span>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--body)] hover:bg-[var(--surface-tint)]"
            >
              {c.name}
            </Link>
          ))}
        </nav>

        {brands.length > 0 && (
          <nav aria-label="Brands" className="mt-3 flex flex-wrap gap-2">
            {brands.map((b) => (
              <Link
                key={b.slug}
                href={`/brand/${b.slug}`}
                className="rounded-full border border-[var(--line)] px-4 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-tint)]"
              >
                {b.name}
              </Link>
            ))}
          </nav>
        )}

        <p className="mt-6 text-xs text-[var(--faint)]">
          {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>

        <div className="mt-4">
          <FilterableProductGrid products={products} />
        </div>
      </div>
    </>
  );
}
