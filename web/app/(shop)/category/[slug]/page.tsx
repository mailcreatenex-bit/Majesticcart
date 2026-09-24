import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  buildMetadata, pageTitle, metaDescription, breadcrumbJsonLd, SITE,
} from '@/lib/seo';
import { absoluteUrl } from '@/lib/referral';
import {
  listProducts, listCategories, listBrands, getCategory, categoryCopy, categoryTree,
} from '@/lib/catalog';
import { FilterableProductGrid } from '@/components/FilterableProductGrid';

/**
 * A category.
 *
 * These are the pages that carry the catalogue's search traffic — "body lotion
 * for dry skin India" reaches a category, not the home page — so each one is
 * statically generated with copy of its own rather than being a bare grid.
 *
 * Next requires `revalidate` to be a literal it can read without executing the module,
 * so it cannot be the imported CATALOG_REVALIDATE. The two are held together by
 * a test in __tests__/seo.spec.ts rather than by whoever edits one of them next.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const categories = await listCategories();
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) {
    return { title: pageTitle('Category not found'), robots: { index: false, follow: true } };
  }

  const copy = categoryCopy(slug);
  // A sub-category with nothing in it yet is a thin page: keep it out of the index
  // until it has products (the page itself still works, and is linked from the menu).
  const empty = (await listProducts({ category: slug })).length === 0;
  return {
    ...buildMetadata({
      title: pageTitle(category.name),
      description: metaDescription(category.description ?? copy.intro),
      pathname: `/category/${slug}`,
      ...(category.imageUrl ? { image: { url: category.imageUrl, alt: category.name } } : {}),
    }),
    ...(empty ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [category, products, allCategories, allBrands] = await Promise.all([
    getCategory(slug),
    listProducts({ category: slug }),
    listCategories(),
    listBrands(),
  ]);
  // A slug that is not a real category is a 404, not an empty grid. An empty
  // grid at a made-up URL is a soft 404: the crawler indexes it, and the site
  // accumulates worthless pages.
  if (!category) notFound();

  const copy = categoryCopy(slug);

  // Where this category sits: the department it belongs to (if it is a sub-category),
  // and the sub-categories to browse next (its own, or its siblings').
  const tree = categoryTree(allCategories);
  const department = category.parentId ? tree.find((d) => d.id === category.parentId) ?? null : null;
  const family = department ?? tree.find((d) => d.id === category.id) ?? null;
  const subcategories = family?.children ?? [];

  const jsonLd = [
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/shop' },
      { name: category.name, path: `/category/${slug}` },
    ]),
    // The grid as an ordered list, so a crawler reads it as a product listing
    // rather than a set of unrelated links.
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${category.name} — ${SITE.name}`,
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
          {department && (
            <>
              <Link href={`/category/${department.slug}`} className="hover:text-[var(--ink)]">{department.name}</Link>
              <span className="mx-2">/</span>
            </>
          )}
          <span className="text-[var(--body)]">{category.name}</span>
        </nav>

        <h1 className="mt-3 font-serif text-3xl text-[var(--ink)]">{category.name}</h1>
        {/* Real copy, not a placeholder line. A category page that is only a
            grid has nothing to rank on and reads as thin to a crawler. */}
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--body)]">
          {category.description ?? copy.intro}
        </p>

        <p className="mt-6 text-xs text-[var(--faint)]">
          {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>

        {subcategories.length > 0 && (
          <nav aria-label={`${family?.name ?? category.name} sub-categories`} className="mt-5 flex flex-wrap gap-2">
            {department && (
              <Link href={`/category/${department.slug}`} className="rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-sm text-[var(--body)] hover:bg-[var(--surface-tint)]">
                All {department.name}
              </Link>
            )}
            {subcategories.map((c) => {
              const on = c.slug === slug;
              return (
                <Link
                  key={c.slug}
                  href={`/category/${c.slug}`}
                  aria-current={on ? 'page' : undefined}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${on ? 'border-[var(--ink)] bg-[var(--ink)] font-semibold text-[var(--gold-pale)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'}`}
                >
                  {c.name}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="mt-4">
          {products.length > 0 ? (
            <FilterableProductGrid products={products} allCategories={allCategories} allBrands={allBrands} />
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
              <p className="font-serif text-lg text-[var(--ink)]">Products are on their way</p>
              <p className="mt-2 text-sm text-[var(--body)]">Nothing is listed in {category.name} just yet. Have a look at the rest of the range.</p>
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
