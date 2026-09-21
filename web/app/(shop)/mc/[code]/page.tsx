import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildMetadata, pageTitle, SITE } from '@/lib/seo';
import { listProducts, getStorefrontMember } from '@/lib/catalog';
import { MandalaRule } from '@/components/MandalaRule';
import { ProductGrid } from '@/components/ProductCard';

/**
 * `majesticcart.in/mc/PRIYA123` — the same shop, with the one thing an
 * anonymous storefront can't have: someone the visitor already knows and
 * trusts standing behind it. Direct selling runs on that relationship, not
 * on the brand alone, so the person, not just the product, gets the top of
 * the page.
 *
 * The referral cookie is set in `middleware.ts`, not here — a Server
 * Component can only read cookies, and setting one is exactly the kind of
 * thing that has to happen before this page ever renders.
 *
 * Deliberately thin: this is the shop's own catalogue behind a banner, not a
 * second content system a member has to maintain. There is no "pick your
 * featured products" step, so there is nothing here for a member to forget
 * to update — the range they're showing is always the current range.
 */

interface Params { code: string }

async function loadMember(code: string) {
  return getStorefrontMember(code);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { code } = await params;
  const member = await loadMember(code);
  const title = member ? pageTitle(`Shop with ${member.firstName}`) : pageTitle('Shop');
  return buildMetadata({
    title,
    description: member
      ? `${member.firstName}'s Majestic Cart storefront — the full range of colour cosmetics, skin care, body care and fragrance.`
      : 'Shop the full Majestic Cart range.',
    pathname: `/mc/${code}`,
  });
}

export default async function StorefrontPage({ params }: { params: Promise<Params> }) {
  const { code } = await params;
  const [member, products] = await Promise.all([
    loadMember(code),
    listProducts({ limit: 24 }),
  ]);

  // No such member, or not currently active: fall back to "page doesn't
  // exist" rather than quietly rendering a storefront for nobody — a 404 here
  // is the honest answer, and it's what stops a mistyped or expired code from
  // looking like a working link.
  if (!member) notFound();

  return (
    <div>
      <section className="border-b border-[var(--line)] bg-gradient-to-br from-[var(--accent-soft)] to-[var(--page)]">
        <div className="mx-auto max-w-6xl px-4 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--gold-mid)]/40 bg-[var(--surface)] font-serif text-2xl text-[var(--ink)]">
            {member.firstName.charAt(0).toUpperCase()}
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">
            {member.firstName}&apos;s storefront
          </p>
          <h1 className="mt-2 font-serif text-3xl text-[var(--ink)]">
            Shop {SITE.name} with {member.firstName}
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[var(--body)]">
            Every order placed here is on {member.firstName}&apos;s recommendation. Wallet,
            delivery and returns work exactly as they do anywhere else on the site.
          </p>
          <Link
            href="/join"
            className="mt-5 inline-block text-xs font-semibold text-[var(--accent)] hover:underline"
          >
            Want to sell like {member.firstName}? See how to join →
          </Link>
        </div>
      </section>

      <MandalaRule />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="font-serif text-2xl text-[var(--ink)]">The full range</h2>
        <div className="mt-6">
          <ProductGrid products={products} />
        </div>
      </section>
    </div>
  );
}
