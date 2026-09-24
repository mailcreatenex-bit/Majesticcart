import type { Metadata } from 'next';
import { canonicalUrl, absoluteUrl } from './referral';

/**
 * Metadata and structured data.
 *
 * Two rules are enforced here rather than left to whoever writes the next page,
 * because both failures are silent and both are expensive to undo.
 */

export const SITE = {
  name: 'Majestic Cart',
  tagline: 'Royal beauty, rewarded',
  origin: process.env.NEXT_PUBLIC_ORIGIN ?? 'https://majesticcart.in',
  locale: 'en_IN',
  twitter: '@majesticcart',
} as const;

/* ------------------------------------------------------------- indexing */

/**
 * Nothing behind a login is worth indexing, and some of it is actively harmful
 * to expose. Wallets, orders, the genealogy tree and the whole admin console
 * are `noindex, nofollow`.
 *
 * Search result pages are `noindex, follow`: a crawler should walk through to
 * the products, but an infinite space of query permutations must never enter
 * the index.
 */
export const PRIVATE_PREFIXES = [
  '/account', '/wallet', '/orders', '/network', '/recharge', '/cart',
  '/checkout', '/notifications', '/admin', '/reports', '/api', '/id-card', '/statement',
] as const;

export const NOINDEX_FOLLOW_PREFIXES = [
  '/search', '/shop/filter',
  // The service worker's offline fallback. Indexing it would put "You are
  // offline" in the search results as though it were a real page.
  '/offline',
  // A member's storefront (`/mc/:code`) is the shop's own product grid behind
  // a personalised banner — real content worth crawling for the products
  // inside it, but every member's version of it is the same catalogue, so
  // indexing all of them as distinct pages would be a duplicate-content
  // problem multiplied by however many members share a link.
  '/mc',
] as const;

/**
 * Strip any query string or fragment before matching.
 *
 * Callers pass "/search?q=lipstick" as readily as "/search". Without this the
 * prefix match failed and a search page came back indexable — the exact
 * opposite of the rule, and silent.
 */
const pathOnly = (pathname: string): string => pathname.split(/[?#]/)[0];

const matchesPrefix = (pathname: string, prefixes: readonly string[]): boolean => {
  const path = pathOnly(pathname);
  // Exact match or a real path segment: "/accountability" must not match "/account".
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
};

export const isPrivatePath = (pathname: string): boolean => matchesPrefix(pathname, PRIVATE_PREFIXES);

export const isNoindexFollowPath = (pathname: string): boolean => matchesPrefix(pathname, NOINDEX_FOLLOW_PREFIXES);

export type RobotsDirective = Metadata['robots'];

export function robotsFor(pathname: string): RobotsDirective {
  if (isPrivatePath(pathname)) return { index: false, follow: false, nocache: true };
  if (isNoindexFollowPath(pathname)) return { index: false, follow: true };
  return { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } };
}

/* ------------------------------------------------------------- metadata */

export interface PageSeoInput {
  title: string;
  description: string;
  pathname: string;
  search?: string | URLSearchParams;
  image?: { url: string; alt: string; width?: number; height?: number };
  type?: 'website' | 'article';
  publishedTime?: string;
}

export function buildMetadata(input: PageSeoInput): Metadata {
  const canonical = canonicalUrl(input.pathname, input.search ?? '', SITE.origin);
  const image = input.image ?? { url: '/og/default.jpg', alt: `${SITE.name} — ${SITE.tagline}`, width: 1200, height: 630 };

  return {
    title: input.title,
    description: input.description,
    // The canonical is the backstop for any referral variant that slips past
    // the middleware redirect.
    alternates: { canonical },
    robots: robotsFor(input.pathname),
    openGraph: {
      type: input.type ?? 'website',
      siteName: SITE.name,
      title: input.title,
      description: input.description,
      url: canonical,
      locale: SITE.locale,
      images: [{ url: absoluteUrl(image.url, SITE.origin), alt: image.alt, width: image.width ?? 1200, height: image.height ?? 630 }],
      ...(input.publishedTime ? { publishedTime: input.publishedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      site: SITE.twitter,
      title: input.title,
      description: input.description,
      images: [absoluteUrl(image.url, SITE.origin)],
    },
  };
}

/** Titles read "Product — Category | Majestic Cart", trimmed to fit a SERP. */
export function pageTitle(...parts: string[]): string {
  const joined = parts.filter(Boolean).join(' — ');
  const full = joined ? `${joined} | ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
  if (full.length <= 60) return full;
  // The suffix is "… | " plus the site name: four characters plus the name.
  const room = 60 - 4 - SITE.name.length;
  return `${joined.slice(0, room).trimEnd()}… | ${SITE.name}`;
}

export function metaDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/* ---------------------------------------------------------- structured data */

export interface ProductForSeo {
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  pricePaise: number;
  mrpPaise: number;
  inStock: boolean;
  imageUrl?: string;
  /**
   * Reviews collected from verified purchasers, and nothing else.
   *
   * The catalogue carries seeded rating and review counts for the demo. Marking
   * those up as AggregateRating would be fabricated review data under Google's
   * structured data policies, and the penalty is a manual action that strips
   * every rich result from the domain — not just the product pages. So the
   * builder below refuses to emit ratings unless real reviews exist, rather
   * than trusting each page author to remember.
   */
  verifiedReviews?: { count: number; averageRating: number };
}

const rupees = (paise: number): string => (paise / 100).toFixed(2);

export function productJsonLd(product: ProductForSeo) {
  const url = absoluteUrl(`/product/${product.slug}`, SITE.origin);

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: metaDescription(product.description, 300),
    sku: product.sku,
    category: product.category,
    url,
    brand: { '@type': 'Brand', name: SITE.name },
    ...(product.imageUrl ? { image: [absoluteUrl(product.imageUrl, SITE.origin)] } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'INR',
      price: rupees(product.pricePaise),
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: SITE.name },
    },
  };

  // Ratings only when genuine reviews exist. No reviews, no markup.
  if (product.verifiedReviews && product.verifiedReviews.count > 0) {
    const { count, averageRating } = product.verifiedReviews;
    if (averageRating > 0 && averageRating <= 5) {
      schema.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: averageRating.toFixed(1),
        reviewCount: count,
        bestRating: '5',
        worstRating: '1',
      };
    }
  }

  return schema;
}

export function organizationJsonLd(contact: { phone: string; email: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.origin,
    logo: absoluteUrl('/logo.png', SITE.origin),
    contactPoint: [{
      '@type': 'ContactPoint',
      telephone: contact.phone,
      email: contact.email,
      contactType: 'customer service',
      areaServed: 'IN',
      availableLanguage: ['en', 'hi', 'bn'],
    }],
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: absoluteUrl(step.path, SITE.origin),
    })),
  };
}

/* ------------------------------------------------------- compliance guard */

/**
 * Income claims on a public page.
 *
 * "Earn ₹50,000 a month" on an indexable page is a representation about
 * earnings, and under the Consumer Protection (Direct Selling) Rules it has to
 * be substantiated. Anything about income belongs behind the login, with the
 * income-distribution report as its evidence base.
 *
 * This runs in CI over page copy so a marketing edit cannot quietly put one
 * back.
 *
 * It is a lint, not a legal opinion, and it catches the obvious phrasings
 * rather than every possible one. Treat a clean run as "nothing blatant",
 * never as "approved" — public copy still needs a human read.
 */
/**
 * Earnings vocabulary in the languages this storefront actually publishes in.
 *
 * Members write and share in Bengali and Hindi, and those are precisely the
 * pages a regulator would read. An English-only lint would pass a page saying
 * the same thing in Bengali, which is worse than no lint at all because it
 * reads as coverage.
 */
const EARN_WORDS = [
  'earn', 'earning', 'earnings', 'income', 'salary', 'profit', 'payout',
  'kamai', 'kamao', 'rozgar',
  'কমাই', 'কামাই', 'আয়', 'রোজগার', 'উপার্জন', 'ইনকাম',
  'कमाई', 'कमाओ', 'इनकम', 'आमदनी', 'रोज़गार',
].join('|');
const PERIOD_WORDS = [
  'month', 'day', 'week', 'monthly', 'daily', 'weekly',
  'mahina', 'mahine', 'মাস', 'মাসে', 'দিনে', 'সপ্তাহে', 'महीने', 'महीना', 'दिन',
].join('|');
// Currency marks and digits as they are actually typed in India: the rupee
// sign, the Bengali taka sign, and Bengali or Devanagari numerals alongside
// ASCII ones. A member writing ৳২৫০০০ is making the same claim as ₹25,000.
// Two details that look pedantic and are not:
//   • the amount must START with a digit. "[\\d,]+" also matches a bare comma,
//     which made "recruiting membe(rs,)" read as a rupee amount.
//   • the latin currency words need a word boundary, or "rs" matches inside
//     "members", "years" and "offers".
const DIGITS = '[\\d\\u09E6-\\u09EF\\u0966-\\u096F]';
const MONEY = `(?:₹|৳|\\b(?:rs\\.?|inr)|टका|টাকা|রুপি)\\s?${DIGITS}[${DIGITS.slice(1, -1)},]*`;

const INCOME_CLAIM_PATTERNS: { pattern: RegExp; note: string }[] = [
  // "Earn ₹50,000" — an earnings word near a figure, in any of the languages.
  { pattern: new RegExp(`(?:${EARN_WORDS})[^.!?]{0,40}${MONEY}`, 'iu'), note: 'a specific earnings figure' },
  // "₹40,000 প্রতি মাসে" — a figure near a period word, with the earnings word
  // implied. Matches in either order, since Bengali and Hindi put it after.
  { pattern: new RegExp(`${MONEY}[^.!?]{0,25}(?:${PERIOD_WORDS})`, 'iu'), note: 'a per-period earnings figure' },
  { pattern: new RegExp(`(?:${PERIOD_WORDS})[^.!?]{0,25}${MONEY}`, 'iu'), note: 'a per-period earnings figure' },
  { pattern: /\b(?:guaranteed|assured|fixed)\s+(?:income|earning|return|profit)/i, note: 'a guaranteed-income claim' },
  { pattern: /\b(?:passive income|financial freedom|quit your job|become a millionaire)\b/i, note: 'an income-opportunity claim' },
  { pattern: /\b(?:double|triple)\s+your\s+(?:money|investment)/i, note: 'an investment-return claim' },
];

export interface ClaimFinding {
  note: string;
  match: string;
}

export function findIncomeClaims(copy: string): ClaimFinding[] {
  const out: ClaimFinding[] = [];
  for (const { pattern, note } of INCOME_CLAIM_PATTERNS) {
    const m = pattern.exec(copy);
    if (m) out.push({ note, match: m[0].trim() });
  }
  return out;
}

export function assertNoIncomeClaims(copy: string, where: string): void {
  const findings = findIncomeClaims(copy);
  if (findings.length > 0) {
    throw new Error(
      `${where} contains ${findings.map((f) => `${f.note} ("${f.match}")`).join(', ')}. ` +
        'Income claims must not appear on indexable pages — move this behind the login.',
    );
  }
}
