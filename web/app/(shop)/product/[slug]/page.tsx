import { ProductReviews } from '@/components/ProductReviews';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  buildMetadata, pageTitle, metaDescription, productJsonLd, breadcrumbJsonLd,
} from '@/lib/seo';
import { getProduct, listProducts, categoryCopy } from '@/lib/catalog';
import { showMoney, showVolume, discountPercent } from '@/lib/money';
import { AddToBag } from '@/components/AddToBag';
import { ProductCard } from '@/components/ProductCard';
import { ProductGallery } from '@/components/ProductGallery';

/**
 * Product page — the template every other indexable page follows.
 *
 * Rendered statically and revalidated hourly (ISR): a crawler and a first-time
 * visitor both get HTML from the edge with no database round trip, while price
 * and stock stay fresh without a deploy. Prices and BV come from the API, so
 * the admin console remains the single source of truth.
 *
 * Next requires `revalidate` to be a literal it can read without executing the
 * module, so it cannot be the imported CATALOG_REVALIDATE. The two are held
 * together by a test in __tests__/seo.spec.ts.
 */
export const revalidate = 3600;
export const dynamicParams = true;

/**
 * Pre-render the catalogue at build; anything newer is generated on demand.
 *
 * Fails soft, and deliberately so. With `dynamicParams = true` an empty list
 * means product pages are generated on first request instead of at build —
 * the site still works, it just loses the pre-render. A thrown error here
 * fails the whole build, which turns a five-minute API blip into a deploy that
 * cannot happen at all.
 *
 * It logs loudly, because a build that quietly pre-renders nothing is worth
 * noticing in CI even though it is not worth stopping.
 */
export async function generateStaticParams() {
  try {
    const res = await fetch(`${process.env.API_ORIGIN}/api/catalog/sitemap`);
    if (!res.ok) {
      console.warn(`[build] catalogue sitemap returned ${res.status}; product pages will render on demand`);
      return [];
    }
    const products: { slug: string }[] = await res.json();
    return products.map((p) => ({ slug: p.slug }));
  } catch (err) {
    console.warn(`[build] could not reach the catalogue (${(err as Error).message}); product pages will render on demand`);
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: pageTitle('Product not found'), robots: { index: false, follow: true } };

  return buildMetadata({
    title: pageTitle(product.name, product.category),
    description: metaDescription(product.description),
    pathname: `/product/${slug}`,
    image: product.imageUrl ? { url: product.imageUrl, alt: product.name } : undefined,
  });
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  // Same category, this one excluded. A product page with no way onward is a
  // dead end for a visitor and a leaf with no internal links for a crawler.
  const related = (await listProducts({ category: product.categorySlug, limit: 5 }))
    .filter((p) => p.slug !== slug)
    .slice(0, 4);

  const off = discountPercent(product.mrp.paise, product.price.paise);

  const jsonLd = [
    productJsonLd({
      slug: product.slug,
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.category,
      pricePaise: product.price.paise,
      mrpPaise: product.mrp.paise,
      inStock: product.inStock,
      imageUrl: product.imageUrl,
      // verifiedReviews deliberately omitted: the catalogue carries seeded
      // demo ratings, and marking those up as AggregateRating is fabricated
      // review data. See the note in lib/seo.ts.
    }),
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/shop' },
      { name: product.category, path: `/category/${product.categorySlug}` },
      { name: product.name, path: `/product/${slug}` },
    ]),
  ];

  return (
    <>
      {/* One script per graph. Next injects these into the streamed HTML, so a
          crawler sees them without executing any JavaScript. */}
      {jsonLd.map((graph, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
      ))}

      <div className="mx-auto max-w-6xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
          <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/shop" className="hover:text-[var(--ink)]">Shop</Link>
          <span className="mx-2">/</span>
          <Link href={`/category/${product.categorySlug}`} className="hover:text-[var(--ink)]">
            {product.category}
          </Link>
        </nav>

        <article className="mt-6 grid gap-10 md:grid-cols-2">
          <ProductGallery
            images={[...(product.imageUrl ? [product.imageUrl] : []), ...(product.galleryImages ?? [])]}
            name={product.name}
            discountBadge={off}
          />

          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">
              {product.brand && product.brandSlug ? (
                <Link href={`/brand/${product.brandSlug}`} className="hover:text-[var(--ink)]">{product.brand}</Link>
              ) : product.brand}
              {product.brand ? ' · ' : ''}{product.category}
            </p>
            {/* Exactly one h1 per page, and it is the product name. */}
            <h1 className="mt-1 font-serif text-3xl leading-tight text-[var(--ink)]">{product.name}</h1>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-[var(--ink)]">{showMoney(product.price)}</span>
              {product.mrp.paise > product.price.paise && (
                <span className="text-[var(--faint)] line-through">{showMoney(product.mrp)}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Price includes GST</p>

            {/* Business volume is shown, earnings are not. What a member would
                make from it appears only after login — see the income-claim
                lint in lib/seo.ts. */}
            <p className="mt-4 text-sm text-[var(--body)]">
              <span className="font-semibold text-[var(--ink)]">{showVolume(product.businessVolume)}</span> per unit for members
            </p>

            <AddToBag product={product} />

            <h2 className="mt-10 font-serif text-lg text-[var(--ink)]">About this product</h2>
            <p className="mt-2 max-w-prose leading-relaxed text-[var(--body)]">{product.description}</p>

            {product.howToUse && (
              <>
                <h2 className="mt-8 font-serif text-lg text-[var(--ink)]">How to use</h2>
                <p className="mt-2 max-w-prose whitespace-pre-line leading-relaxed text-[var(--body)]">{product.howToUse}</p>
              </>
            )}
            {product.ingredients && (
              <>
                <h2 className="mt-8 font-serif text-lg text-[var(--ink)]">Ingredients</h2>
                <p className="mt-2 max-w-prose whitespace-pre-line text-sm leading-relaxed text-[var(--body)]">{product.ingredients}</p>
              </>
            )}

            {/* Required on a product listing by the Consumer Protection
                (E-Commerce) Rules, 2020. Not optional, and not a footnote. */}
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--line)] pt-6 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--faint)]">Country of origin</dt>
                <dd className="mt-0.5 text-[var(--ink)]">{product.countryOfOrigin}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--faint)]">SKU</dt>
                <dd className="mt-0.5 text-[var(--ink)]">{product.sku}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--faint)]">HSN</dt>
                <dd className="mt-0.5 text-[var(--ink)]">{product.hsnCode}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-[var(--faint)]">GST</dt>
                <dd className="mt-0.5 text-[var(--ink)]">{product.gstPercent}% (included)</dd>
              </div>
            </dl>

            <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
              Orders are paid from your shopping wallet.{' '}
              <Link href="/faq" className="font-semibold text-[var(--accent)] hover:underline">
                How that works
              </Link>
            </p>
          </div>
        </article>

        <ProductReviews slug={slug} />

        {related.length > 0 && (
          <section className="mt-16 border-t border-[var(--line)] pt-10">
            <h2 className="font-serif text-2xl text-[var(--ink)]">More in {product.category}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{categoryCopy(product.categorySlug).blurb}</p>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.slug} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
