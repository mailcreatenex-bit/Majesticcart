import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { buildMetadata, metaDescription, SITE } from '@/lib/seo';
import { listProducts, listCategories, categoryCopy, categoryTree } from '@/lib/catalog';
import { getTheme } from '@/lib/content';
import { MandalaRule } from '@/components/MandalaRule';
import { ProductGrid } from '@/components/ProductCard';
import { BrandCarousel } from '@/components/BrandCarousel';
import { HeroSlider } from '@/components/HeroSlider';
import { PromoBanner } from '@/components/PromoBanner';
import { CATEGORY_IMAGES } from '@/lib/categoryImages';
import { playChipClass, playTileClass } from '@/lib/playColors';

/**
 * Home.
 *
 * Statically generated and revalidated hourly. It is the page a crawler reaches
 * first, the page a WhatsApp link lands on, and the page every "majestic cart"
 * search resolves to, so it renders as HTML from the edge with no database
 * round trip.
 *
 * Next requires `revalidate` to be a literal it can read without executing the module,
 * so it cannot be the imported CATALOG_REVALIDATE. The two are held together by
 * a test in __tests__/seo.spec.ts rather than by whoever edits one of them next.
 */
export const revalidate = 3600;

const DESCRIPTION =
  'Makeup, skin care, body care and fragrance from leading beauty brands such as Lakmé, Lotus Herbals, Pond’s, Dot & Key and Himalaya, sold direct across India.';

export const metadata: Metadata = buildMetadata({
  title: `${SITE.name} — ${SITE.tagline}`,
  description: metaDescription(DESCRIPTION),
  pathname: '/',
});

/** Default rotation when the admin hasn't uploaded hero photos in Theme. */
const DEFAULT_HERO_IMAGES = ['/home/skin-1.jpg', '/home/skin-2.jpg', '/home/skin-3.jpg', '/home/skin-4.jpg'];
const DEFAULT_PROMO_IMAGES = ['/home/editorial-8.jpg', '/home/editorial-9.jpg'];
const DEFAULT_PROMO_HEADING = 'Skin care, makeup and more — picked from brands already on your shelf.';

export default async function HomePage() {
  const [featured, categories, theme] = await Promise.all([
    listProducts({ limit: 8 }),
    listCategories(),
    getTheme(),
  ]);
  const hero = theme.hero;
  const heroImages = hero.imageUrls.length > 0 ? hero.imageUrls : DEFAULT_HERO_IMAGES;
  const promo = theme.promoBanner;
  const promoImages = promo.images.length > 0 ? promo.images : DEFAULT_PROMO_IMAGES;

  // WebSite markup enables the sitelinks search box, and ItemList tells a
  // crawler these are products rather than an unlabelled set of links.
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE.name,
      url: SITE.origin,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE.origin}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  return (
    <>
      {jsonLd.map((graph, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
      ))}

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-[var(--line)] bg-gradient-to-br from-[var(--play-pink-soft)] via-[var(--play-violet-soft)] to-[var(--play-teal-soft)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-24 md:grid-cols-2 md:items-center">
          <div className="max-w-2xl">
            <p className="inline-block rounded-full bg-[var(--play-pink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">{hero.eyebrow}</p>
            {/* The only h1 on the page. It carries the brand and what is sold,
                because that is the query it has to answer. Editable from the
                console's Theme page — see lib/content.ts's getTheme(). */}
            <h1 className="mt-3 font-serif text-4xl leading-[1.1] text-[var(--ink)] sm:text-6xl">
              {hero.title.split('\n').map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-[var(--body)]">{hero.subtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={hero.primaryCtaHref}
                className="rounded-xl gold-foil px-7 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20"
              >
                {hero.primaryCtaLabel}
              </Link>
              <Link
                href={hero.secondaryCtaHref}
                className="rounded-xl border border-[var(--ink)]/15 bg-[var(--surface)] px-7 py-3.5 font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
              >
                {hero.secondaryCtaLabel}
              </Link>
            </div>
          </div>
          <HeroSlider images={heroImages} fallback="/home/hero-1.jpg" />
        </div>
      </section>

      <BrandCarousel />

      {/* ------------------------------------------------------ categories */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-serif text-2xl text-[var(--ink)]">Shop by category</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categoryTree(categories).map((c) => {
            const image = c.imageUrl || CATEGORY_IMAGES[c.slug];
            return (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] transition hover:border-[var(--line-strong)] hover:shadow-lg hover:shadow-rose-900/5"
              >
                <div className={`relative aspect-[4/3] overflow-hidden ${playTileClass(c.slug)}`}>
                  {image && (
                    <Image
                      src={image}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover object-top transition duration-500 group-hover:scale-105"
                    />
                  )}
                  <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${playChipClass(c.slug)}`}>
                    {c.name}
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="font-serif text-lg text-[var(--ink)]">{c.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {c.description ?? categoryCopy(c.slug).blurb}
                  </p>
                  <span className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] group-hover:underline">
                    Browse →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <MandalaRule />

      {/* ------------------------------------------------------ banner */}
      {promo.enabled && (
        <PromoBanner
          images={promoImages}
          heading={promo.heading || DEFAULT_PROMO_HEADING}
          ctaLabel={promo.ctaLabel || 'Shop the range'}
          ctaHref={promo.ctaHref || '/shop'}
        />
      )}

      {/* -------------------------------------------------------- featured */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex items-end justify-between">
          <h2 className="font-serif text-2xl text-[var(--ink)]">New this season</h2>
          <Link href="/shop" className="text-sm font-semibold text-[var(--accent)] hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-6">
          <ProductGrid products={featured} />
        </div>
      </section>

      {/* ------------------------------------------------------- about us */}
      <section className="border-y border-[var(--line)] bg-[var(--accent-soft)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:items-center">
          <div className="order-2 flex gap-4 sm:order-1">
            <div className="relative mt-8 aspect-[3/4] w-1/2 overflow-hidden rounded-2xl shadow-lg">
              <Image src="/home/about-1.jpg" alt="" fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
            </div>
            <div className="relative aspect-[3/4] w-1/2 overflow-hidden rounded-2xl shadow-lg">
              <Image src="/home/editorial-3.jpg" alt="" fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />
            </div>
          </div>
          <div className="order-1 max-w-xl sm:order-2">
            <h2 className="font-serif text-2xl text-[var(--ink)]">About Majestic Cart</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--body)]">
              Majestic Cart brings beauty and personal-care products from established brands together in one
              place, and sells them through a network of independent sellers rather than retail shelves. We do
              not make products or sell under a brand of our own. Here&apos;s how the business works, and just
              as importantly, what it does not do.
            </p>
            <Link
              href="/about"
              className="mt-6 inline-block shrink-0 rounded-xl border border-[var(--ink)]/15 bg-[var(--surface)] px-6 py-3 font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
            >
              Read our story →
            </Link>
          </div>
        </div>
      </section>

      <MandalaRule />

      {/* ----------------------------------------------------- explore */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-serif text-2xl text-[var(--ink)]">Explore Majestic Cart</h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          A quick map of the site — everything below has its own page with more detail.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: '/shop', title: 'Shop the range', body: 'Makeup, skin care, body care and fragrance — the full catalogue, or browse by category.', image: '/home/explore-shop.jpg' },
            { href: '/shade-finder', title: 'AI shade finder', body: 'Upload a selfie and get shade suggestions from the current makeup range.', image: '/home/explore-shade-finder.jpg' },
            { href: '/wallet', title: 'Wallet & recharge', body: 'Add funds by UPI, track both wallets, or recharge a mobile number instead of buying right now.', image: '/home/explore-wallet.jpg' },
            { href: '/join', title: 'Become a member', body: 'Free to register. What it costs, what is expected, and what you are paid on.', image: '/home/explore-join.jpg' },
            { href: '/network', title: 'Your network', body: 'Your team and your referral link, once you are a member.', image: '/home/explore-network.jpg' },
            { href: '/account', title: 'Your account', body: 'Rank, volume, payout details and order history in one place.', image: '/home/explore-account.jpg' },
            { href: '/faq', title: 'Help & policies', body: 'Ordering, delivery, returns and membership — answered plainly, with every policy linked below.', image: '/home/explore-faq.jpg' },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] transition hover:border-[var(--line-strong)] hover:shadow-lg hover:shadow-rose-900/5"
            >
              <div className={`relative aspect-[4/3] overflow-hidden ${playTileClass(c.title)}`}>
                <Image
                  src={c.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover object-top transition duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-6">
                <h3 className="font-serif text-lg text-[var(--ink)]">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{c.body}</p>
                <span className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] group-hover:underline">
                  Open →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- trust */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          {[
            {
              title: 'Brands you already know',
              body: 'Everything we sell is made by other established beauty brands. We do not manufacture products or sell under our own brand name.',
              icon: BrandBadgeIcon,
              tone: 'var(--play-coral)',
            },
            {
              title: 'Wallet-based ordering',
              body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.',
              icon: WalletBadgeIcon,
              tone: 'var(--play-teal)',
            },
            {
              title: 'Delivered across India',
              body: 'Tracking on every order, and a returns window set out in full in the refund policy.',
              icon: TruckBadgeIcon,
              tone: 'var(--play-violet)',
            },
          ].map((f) => (
            <div key={f.title} className="flex gap-4">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
                style={{ background: f.tone }}
              >
                <f.icon />
              </span>
              <div>
                <h3 className="font-semibold text-[var(--ink)]">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function BrandBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 7v5c0 4.5 3.4 7.6 8 9 4.6-1.4 8-4.5 8-9V7Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function WalletBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5v1H4.5A1.5 1.5 0 0 0 3 10Z" />
      <path d="M3 10v8a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18v-7a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 1 3 8" />
      <circle cx="16.5" cy="14.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TruckBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  );
}
