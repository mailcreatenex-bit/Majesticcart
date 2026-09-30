import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription } from '@/lib/seo';
import { listProducts, listCategories, listBrands } from '@/lib/catalog';
import { FilterableProductGrid } from '@/components/FilterableProductGrid';

/**
 * Search results.
 *
 * The homepage's `SearchAction` JSON-LD has promised Google's sitelinks
 * search box a `/search?q={term}` URL since the site's first launch; this is
 * that page. `noindex` throughout — a query-string page is a near-infinite
 * set of near-duplicates, and none of them is worth a crawl budget when the
 * category and brand pages already carry the indexable segmentation.
 */
export async function generateMetadata({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    ...buildMetadata({
      title: pageTitle(q ? `Search: ${q}` : 'Search'),
      description: metaDescription('Search the Majestic Cart catalogue.'),
      pathname: '/search',
    }),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const [products, categories, brands] = await Promise.all([
    query ? listProducts({ search: query, limit: 60 }) : Promise.resolve([]),
    listCategories(),
    listBrands(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
        <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--body)]">Search</span>
      </nav>

      <h1 className="mt-3 font-serif text-3xl text-[var(--ink)]">
        {query ? `Results for "${query}"` : 'Search'}
      </h1>

      {!query ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Type a product, brand or category name to search.</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-[var(--faint)]">
            {products.length} {products.length === 1 ? 'result' : 'results'}
          </p>
          <div className="mt-4">
            {products.length > 0 ? (
              <FilterableProductGrid products={products} allCategories={categories} allBrands={brands} />
            ) : (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
                <p className="font-serif text-lg text-[var(--ink)]">Nothing matched &ldquo;{query}&rdquo;</p>
                <p className="mt-2 text-sm text-[var(--body)]">Try a shorter or more general search term.</p>
                <Link href="/shop" className="mt-4 inline-block rounded-xl gold-foil px-6 py-3 font-semibold text-white">
                  Shop all products
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
