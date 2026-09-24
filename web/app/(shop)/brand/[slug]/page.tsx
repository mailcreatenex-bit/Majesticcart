import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  buildMetadata, pageTitle, metaDescription, breadcrumbJsonLd, SITE,
} from '@/lib/seo';
import { absoluteUrl } from '@/lib/referral';
import { listProducts, listBrands, getBrand, listCategories } from '@/lib/catalog';
import { FilterableProductGrid } from '@/components/FilterableProductGrid';

/**
 * A brand's own storefront page.
 *
 * Mirrors `/category/[slug]` on purpose — same reasoning: a real, indexable
 * page per brand rather than a query-string filter, so "glow botanics
 * skincare" reaches a page built for it instead of a bare grid nobody linked
 * to. See app/(shop)/shop/page.tsx for why a filter widget deliberately does
 * not do this for anything unbounded, like a price range.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const brands = await listBrands();
  return brands.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) {
    return { title: pageTitle('Brand not found'), robots: { index: false, follow: true } };
  }
  return {
    ...buildMetadata({
      title: pageTitle(brand.name),
      description: metaDescription(`Shop the full ${brand.name} range on Majestic Cart.`),
      pathname: `/brand/${slug}`,
    }),
    // A brand the store carries but has not listed anything from yet is a thin page.
    ...(brand.productCount === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [brand, products, allCategories, allBrands] = await Promise.all([
    getBrand(slug),
    listProducts({ brand: slug }),
    listCategories(),
    listBrands(),
  ]);
  // A slug that isn't a real (or currently visible) brand is a 404, not an
  // empty grid — same reasoning as the category page: an empty grid at a
  // made-up URL is a soft 404 a crawler indexes anyway.
  if (!brand) notFound();

  const jsonLd = [
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/shop' },
      { name: brand.name, path: `/brand/${slug}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${brand.name} — ${SITE.name}`,
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(`/product/${p.slug}`, SITE.origin),
        name: p.name,
      })),
    },
  ];

  return (
    <>
      {jsonLd.map((graph, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
      ))}

      <div className="mx-auto max-w-6xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
          <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/shop" className="hover:text-[var(--ink)]">Shop</Link>
          <span className="mx-2">/</span>
          <span className="text-[var(--body)]">{brand.name}</span>
        </nav>

        <h1 className="mt-3 font-serif text-3xl text-[var(--ink)]">{brand.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--body)]">
          The full {brand.name} range, sold direct through Majestic Cart.
        </p>

        <p className="mt-6 text-xs text-[var(--faint)]">
          {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>

        <div className="mt-4">
          {products.length > 0 ? (
            <FilterableProductGrid products={products} allCategories={allCategories} allBrands={allBrands} />
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
              <p className="font-serif text-lg text-[var(--ink)]">{brand.name} products are on their way</p>
              <p className="mt-2 text-sm text-[var(--body)]">We carry {brand.name}, but nothing is listed just yet. Have a look at the rest of the range.</p>
              <Link href="/shop" className="mt-4 inline-block rounded-xl gold-foil px-6 py-3 font-semibold text-white">Shop all products</Link>
            </div>
          )}
        </div>

        <div className="mt-12 border-t border-[var(--line)] pt-6">
          <Link href="/shop" className="text-sm font-semibold text-[var(--accent)] hover:underline">
            ← Back to all products
          </Link>
        </div>
      </div>
    </>
  );
}
