import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { buildMetadata, metaDescription, SITE } from '@/lib/seo';
import { listProducts, listCategories, listBrands, categoryCopy, categoryTree } from '@/lib/catalog';
import { getTheme } from '@/lib/content';
import { MandalaRule } from '@/components/MandalaRule';
import { ProductGrid } from '@/components/ProductCard';
import { BrandCarousel } from '@/components/BrandCarousel';
import { HeroCarousel } from '@/components/HeroCarousel';
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
const DEFAULT_HERO_IMAGES = [
  '/home/hero-1.jpg', '/home/hero-2.jpg', '/home/hero-4.jpg', '/home/hero-5.jpg',
  '/home/skin-1.jpg', '/home/skin-2.jpg', '/home/skin-3.jpg', '/home/skin-4.jpg',
  '/home/hero-6.jpg', '/home/hero-7.jpg',
];
const DEFAULT_PROMO_IMAGES = ['/home/editorial-8.jpg', '/home/editorial-9.jpg'];
const DEFAULT_PROMO_HEADING = 'Skin care, makeup and more — picked from brands already on your shelf.';

export default async function HomePage() {
  const [featured, categories, brands, allProducts, theme] = await Promise.all([
    listProducts({ limit: 8 }),
    listCategories(),
    listBrands(),
    // Only used for a genuine, live product count on the trust badges below —
    // not rendered as a grid, so no image/priority concerns from fetching it.
    listProducts({ limit: 500 }),
    getTheme(),
  ]);
  // Real counts, not a Purplle-style "1000+ Brands" headline number — the
  // catalogue is much smaller than that, and a made-up figure here would be
  // a false claim on a live storefront.
  const brandCount = brands.length;
  const productCount = allProducts.length;
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
      <section className="relative overflow-hidden border-b border-[var(--line)]">
        {/* The client wants the hero itself to be pure imagery — no heading,
            no copy, just the carousel and the two buttons. That copy still
            has to live somewhere for SEO/crawlability, so it moved to
            AuthIntro on the login and signup pages, and this stays as a
            visually-hidden h1 so the page still has exactly one crawlable
            heading naming the brand and what it sells. */}
        <h1 className="sr-only">{SITE.name} — {SITE.tagline}</h1>

        <HeroCarousel images={heroImages} fallback="/home/hero-1.jpg" />

        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center gap-3 sm:bottom-12">
          <Link
            href={hero.primaryCtaHref}
            className="pointer-events-auto rounded-xl gold-foil px-6 py-3 font-semibold text-white shadow-lg shadow-amber-900/20 sm:px-8 sm:py-4 sm:text-lg"
          >
            {hero.primaryCtaLabel}
          </Link>
          <Link
            href={hero.secondaryCtaHref}
            className="pointer-events-auto rounded-xl bg-[var(--surface)] px-6 py-3 font-semibold text-[var(--ink)] shadow-lg hover:bg-[var(--surface-tint)] sm:px-8 sm:py-4 sm:text-lg"
          >
            {hero.secondaryCtaLabel}
          </Link>
        </div>
      </section>

      <BrandCarousel />

      {/* ------------------------------------------------------ categories */}
      <section className="bg-[var(--play-pink-soft)] px-4 py-14">
        <div className="mx-auto max-w-6xl">
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
        </div>
      </section>

      {/* ---------------------------------------------------- trust ribbon */}
      <div className="bg-[var(--play-pink)] px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-1 text-xs font-semibold uppercase tracking-wide text-white sm:text-sm">
          <span>Secure wallet payments</span>
          <span>Authentic brands only</span>
          <span>Delivered pan-India</span>
        </div>
      </div>

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
      <section className="bg-[var(--play-yellow-soft)] px-4 py-16">
        <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between">
          <h2 className="font-serif text-2xl text-[var(--ink)]">New this season</h2>
          <Link href="/shop" className="text-sm font-semibold text-[var(--accent)] hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-6">
          <ProductGrid products={featured} />
        </div>
        </div>
      </section>

      {/* ------------------------------------------------------- about us */}
      <section className="border-y border-[var(--line)] bg-[var(--play-violet-soft)]">
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
      <section className="bg-[var(--play-sky-soft)] px-4 py-14">
        <div className="mx-auto max-w-6xl">
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
        </div>
      </section>

      {/* ----------------------------------------------------------- trust */}
      <section className="bg-[#111111]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          {[
            {
              title: 'Brands you already know',
              body: 'Everything we sell is made by other established beauty brands. We do not manufacture products or sell under our own brand name.',
              icon: BrandBadgeIcon,
              tone: 'var(--play-coral)',
              glow: 'glow-coral',
            },
            {
              title: 'Wallet-based ordering',
              body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.',
              icon: WalletBadgeIcon,
              tone: 'var(--play-teal)',
              glow: 'glow-teal',
            },
            {
              title: 'Delivered across India',
              body: 'Tracking on every order, and a returns window set out in full in the refund policy.',
              icon: TruckBadgeIcon,
              tone: 'var(--play-violet)',
              glow: 'glow-violet',
            },
          ].map((f) => (
            <div key={f.title} className="flex gap-4">
              <span
                className={`${f.glow} flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white`}
                style={{ background: f.tone }}
              >
                <f.icon />
              </span>
              <div>
                <h3 className="font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ pink badges */}
      <section className="bg-[var(--play-pink-soft)] px-4 py-14">
        <div className="mx-auto grid max-w-3xl gap-x-10 gap-y-8 sm:grid-cols-2">
          {[
            { title: 'Pan-India Delivery', body: 'Tracking on every order, wherever you are.', icon: TruckBadgeIcon },
            { title: 'Authentic Products', body: 'Sourced directly from brands and authorised distributors.', icon: BrandBadgeIcon },
            { title: 'Easy Returns', body: 'A return window set out in full in the refund policy.', icon: ReturnBadgeIcon },
            {
              title: `${brandCount} Brands`,
              body: `${productCount}+ genuine products, and growing.`,
              icon: TagBadgeIcon,
            },
          ].map((f) => (
            <div key={f.title} className="flex items-center gap-4">
              <span className="glow-pink flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--play-pink)] text-white">
                <f.icon />
              </span>
              <div>
                <h3 className="font-semibold text-[var(--ink)]">{f.title}</h3>
                <p className="mt-0.5 text-sm text-[var(--muted)]">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Adapted from the standard e-commerce fraud notice — true of any
            legitimate storefront, and worth stating plainly rather than
            leaving members to guess what a real message from us looks like. */}
        <div className="mx-auto mt-10 max-w-3xl rounded-xl border-l-4 border-[var(--play-pink)] bg-[var(--surface)] px-5 py-4 text-center text-sm leading-relaxed text-[var(--body)]">
          Please be alert to fraudulent calls and messages. {SITE.name} does not call or message you about
          gifts, offers, discounts, prizes or freebies, and never asks for payment through a link or for your
          password or OTP.
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

function ReturnBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10a7 7 0 1 1 2 4.9" />
      <path d="M3 5v5h5" />
    </svg>
  );
}

function TagBadgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.5 3H5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 .59 1.41l8.5 8.5a2 2 0 0 0 2.82 0l7.09-7.09a2 2 0 0 0 0-2.82l-8.5-8.5A2 2 0 0 0 12.5 3Z" />
      <circle cx="8.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
