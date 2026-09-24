import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription, breadcrumbJsonLd } from '@/lib/seo';
import { listProducts, listCategories, categoryTree } from '@/lib/catalog';
import { FilterableProductGrid } from '@/components/FilterableProductGrid';

/**
 * The full catalogue.
 *
 * Category, brand, price and BV filters live in the client (see
 * FilterableProductGrid) and deliberately have no filter state in the URL.
 * Filters in the URL would multiply into an unbounded set of crawlable
 * permutations, each a near-duplicate of this page.
 *
 * Category and brand pages carry the indexable segmentation instead. They are
 * a fixed, small set, they are in the sitemap, and each one has copy of its own.
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
  const [products, categories] = await Promise.all([listProducts(), listCategories()]);
  const departments = categoryTree(categories).filter((d) => d.children.length > 0);

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

        {departments.length > 0 && (
          <section aria-label="Shop by category" className="mt-6">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Shop by category</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((d) => (
                <div key={d.slug} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <Link href={`/category/${d.slug}`} className="font-serif text-lg text-[var(--ink)] hover:text-[var(--accent)]">{d.name}</Link>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {d.children.map((c) => (
                      <li key={c.slug}>
                        <Link href={`/category/${c.slug}`} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{c.name}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="mt-6 text-xs text-[var(--faint)]">
          {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>

        <div className="mt-4">
          <FilterableProductGrid products={products} allCategories={categories} />
        </div>
      </div>
    </>
  );
}
