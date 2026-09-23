import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { buildMetadata, metaDescription, SITE } from '@/lib/seo';
import { listProducts, listCategories, categoryCopy } from '@/lib/catalog';
import { getTheme } from '@/lib/content';
import { MandalaRule } from '@/components/MandalaRule';
import { ProductGrid } from '@/components/ProductCard';

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
  'Luxury skin, body and colour cosmetics formulated for Indian skin and sold direct across India. Makeup, skin care, body care and fragrance, made in India.';

export const metadata: Metadata = buildMetadata({
  title: `${SITE.name} — ${SITE.tagline}`,
  description: metaDescription(DESCRIPTION),
  pathname: '/',
});

export default async function HomePage() {
  const [featured, categories, theme] = await Promise.all([
    listProducts({ limit: 8 }),
    listCategories(),
    getTheme(),
  ]);
  const hero = theme.hero;

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
      <section className="relative overflow-hidden border-b border-[var(--line)] bg-gradient-to-b from-[var(--accent-soft)] via-[var(--page)] to-[var(--page)]">
        <div
          className={`mx-auto grid max-w-6xl px-4 md:grid-cols-2 ${
            hero.imageUrl ? 'gap-10 py-16 sm:py-24 md:items-center' : 'gap-4 pt-16 sm:pt-24 md:items-end'
          }`}
        >
          <div className={`max-w-2xl ${hero.imageUrl ? '' : 'md:pb-24'}`}>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">{hero.eyebrow}</p>
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
          {hero.imageUrl ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hero.imageUrl} alt="" className="h-full w-full object-cover" />
            </div>
          ) : (
            // The default hero when no image has been set in the console: a
            // cutout standing on the section's own gradient, so there is no
            // photo rectangle to see.
            <div className="relative mx-auto w-full max-w-sm self-end md:max-w-none">
              <div
                aria-hidden="true"
                className="absolute inset-x-8 bottom-0 top-8 rounded-full bg-[radial-gradient(closest-side,var(--gold),transparent)] opacity-20"
              />
              <Image
                src="/models/model-saree.webp"
                alt=""
                width={698}
                height={626}
                priority
                sizes="(min-width: 768px) 560px, 90vw"
                className="fade-bottom relative h-auto w-full"
              />
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ categories */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-serif text-2xl text-[var(--ink)]">Shop by category</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="group rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 transition hover:border-[var(--line-strong)] hover:shadow-lg hover:shadow-rose-900/5"
            >
              <h3 className="font-serif text-lg text-[var(--ink)]">{c.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {c.description ?? categoryCopy(c.slug).blurb}
              </p>
              <span className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] group-hover:underline">
                Browse →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <MandalaRule />

      {/* -------------------------------------------------------- featured */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
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
        <div className="mx-auto grid max-w-6xl items-end gap-6 px-4 pt-14 md:grid-cols-[1fr_auto] md:gap-12">
          <div className="max-w-xl pb-2 md:pb-14">
            <h2 className="font-serif text-2xl text-[var(--ink)]">About Majestic Cart</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--body)]">
              Majestic Cart is an Indian beauty brand sold direct — formulated and manufactured in India,
              and sold through a network of independent sellers rather than retail shelves. Here&apos;s how
              the business works, and just as importantly, what it does not do.
            </p>
            <Link
              href="/about"
              className="mt-6 inline-block rounded-xl border border-[var(--ink)]/15 bg-[var(--surface)] px-6 py-3 font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
            >
              Read our story →
            </Link>
          </div>
          <Image
            src="/models/model-glow.webp"
            alt=""
            width={994}
            height={1000}
            sizes="(min-width: 768px) 320px, 240px"
            className="fade-bottom mx-auto h-60 w-auto md:h-80"
          />
        </div>
      </section>

      <MandalaRule />

      {/* ------------------------------------------------------- community */}
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <div className="grid items-end gap-8 md:grid-cols-2 md:gap-12">
          <div className="pb-2 md:pb-20">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Join free</p>
            <h2 className="mt-3 font-serif text-3xl leading-tight text-[var(--ink)] sm:text-4xl">Beauty is better shared</h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--body)]">
              Joining is free — no registration fee, and no purchase is needed. Shop the range, follow your
              team, and read exactly how the business works before you decide anything.
            </p>
            <Link
              href="/join"
              className="mt-7 inline-block rounded-xl gold-foil px-7 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20"
            >
              Become a member
            </Link>
          </div>
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute inset-x-6 bottom-0 top-10 rounded-full bg-[radial-gradient(closest-side,var(--gold),transparent)] opacity-15"
            />
            <Image
              src="/models/model-group.webp"
              alt=""
              width={1287}
              height={739}
              sizes="(min-width: 768px) 560px, 92vw"
              className="fade-bottom relative h-auto w-full"
            />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- explore */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="font-serif text-2xl text-[var(--ink)]">Explore Majestic Cart</h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          A quick map of the site — everything below has its own page with more detail.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: '/shop', title: 'Shop the range', body: 'Makeup, skin care, body care and fragrance — the full catalogue, or browse by category.' },
            { href: '/shade-finder', title: 'AI shade finder', body: 'Upload a selfie and get shade suggestions from the current makeup range.' },
            { href: '/wallet', title: 'Wallet & recharge', body: 'Add funds by UPI, track both wallets, or recharge a mobile number instead of buying right now.' },
            { href: '/join', title: 'Become a member', body: 'Free to join. What it costs, what is expected, and what you are paid on.' },
            { href: '/network', title: 'Your network', body: 'Your team and your referral link, once you are a member.' },
            { href: '/account', title: 'Your account', body: 'Rank, volume, payout details and order history in one place.' },
            { href: '/faq', title: 'Help & policies', body: 'Ordering, delivery, returns and membership — answered plainly, with every policy linked below.' },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 transition hover:border-[var(--line-strong)] hover:shadow-lg hover:shadow-rose-900/5"
            >
              <h3 className="font-serif text-lg text-[var(--ink)]">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{c.body}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] group-hover:underline">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- trust */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          {[
            {
              title: 'Made and tested in India',
              body: 'Formulated and manufactured in India, dermatologically tested, and compliant with BIS labelling.',
            },
            {
              title: 'Wallet-based ordering',
              body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.',
            },
            {
              title: 'Delivered across India',
              body: 'Tracking on every order, and a returns window set out in full in the refund policy.',
            },
          ].map((f) => (
            <div key={f.title}>
              <h3 className="font-semibold text-[var(--ink)]">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
