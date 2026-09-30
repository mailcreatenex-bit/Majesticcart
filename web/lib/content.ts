import { paiseReviver } from './paise';

/**
 * Blog, pages and theme settings — editorial content, not the catalogue.
 * Same fail-soft contract as lib/catalog.ts: a content-API outage renders an
 * empty blog or the default theme, never a 500 on the page a crawler hits.
 */

export interface BlogListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: string;
}

export interface BlogPost extends BlogListItem {
  contentHtml: string;
  author: { name: string } | null;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  contentHtml: string;
  updatedAt: string;
}

export interface ThemeSettings {
  colors: { ink: string; accent: string; gold: string };
  logoUrl: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    imageUrls: string[];
  };
  announcement: {
    enabled: boolean;
    text: string;
    linkLabel: string;
    linkHref: string;
    couponCode: string;
    startsOn: string;
    endsOn: string;
  };
  promoBanner: {
    enabled: boolean;
    images: string[];
    heading: string;
    ctaLabel: string;
    ctaHref: string;
  };
  promoStrip: { images: string[] };
  homeSections: {
    categoriesBg: PlayColorKey;
    featuredBg: PlayColorKey;
    aboutBg: PlayColorKey;
    exploreBg: PlayColorKey;
  };
  trustBadges: [TitleBody, TitleBody, TitleBody];
  pinkBadges: [TitleBody, TitleBody, TitleBody];
  exploreTiles: [TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody];
  aboutUs: { title: string; body: string; images: [string, string] };
}

export interface TitleBody {
  title: string;
  body: string;
  image?: string;
}

export const PLAY_COLORS = ['coral', 'teal', 'violet', 'lime', 'pink', 'yellow', 'sky'] as const;
export type PlayColorKey = (typeof PLAY_COLORS)[number];

const DEFAULT_ANNOUNCEMENT: ThemeSettings['announcement'] = {
  enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '',
};

const DEFAULT_PROMO_BANNER: ThemeSettings['promoBanner'] = {
  enabled: true, images: [], heading: '', ctaLabel: '', ctaHref: '/shop',
};

const DEFAULT_PROMO_STRIP: ThemeSettings['promoStrip'] = {
  images: ['/home/promo-banner-1.jpg', '/home/promo-banner-2.jpg', '/home/promo-banner-3.jpg', '/home/promo-banner-4.jpg'],
};

const DEFAULT_HOME_SECTIONS: ThemeSettings['homeSections'] = {
  categoriesBg: 'pink', featuredBg: 'yellow', aboutBg: 'violet', exploreBg: 'sky',
};

const DEFAULT_TRUST_BADGES: ThemeSettings['trustBadges'] = [
  { title: 'Brands you already know', body: 'Everything we sell is made by other established beauty brands. We do not manufacture products or sell under our own brand name.' },
  { title: 'Wallet-based ordering', body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.' },
  { title: 'Delivered across India', body: 'Tracking on every order, and a returns window set out in full in the refund policy.' },
];

const DEFAULT_PINK_BADGES: ThemeSettings['pinkBadges'] = [
  { title: 'Pan-India Delivery', body: 'Tracking on every order, wherever you are.' },
  { title: 'Authentic Products', body: 'Sourced directly from brands and authorised distributors.' },
  { title: 'Easy Returns', body: 'A return window set out in full in the refund policy.' },
];

const DEFAULT_EXPLORE_TILES: ThemeSettings['exploreTiles'] = [
  { title: 'Shop the range', body: 'Makeup, skin care, body care and fragrance — the full catalogue, or browse by category.', image: '/home/explore-shop.jpg' },
  { title: 'AI shade finder', body: 'Upload a selfie and get shade suggestions from the current makeup range.', image: '/home/explore-shade-finder.jpg' },
  { title: 'Wallet & recharge', body: 'Add funds by UPI, track both wallets, or recharge a mobile number instead of buying right now.', image: '/home/explore-wallet.jpg' },
  { title: 'Become a member', body: 'Free to register. What it costs, what is expected, and what you are paid on.', image: '/home/explore-join.jpg' },
  { title: 'Your network', body: 'Your team and your referral link, once you are a member.', image: '/home/explore-network.jpg' },
  { title: 'Your account', body: 'Rank, volume, payout details and order history in one place.', image: '/home/explore-account.jpg' },
  { title: 'Help & policies', body: 'Ordering, delivery, returns and membership — answered plainly, with every policy linked below.', image: '/home/explore-faq.jpg' },
];

const DEFAULT_ABOUT_US: ThemeSettings['aboutUs'] = {
  title: 'About Majestic Cart',
  body: 'Majestic Cart brings beauty and personal-care products from established brands together in one place, and sells them through a network of independent sellers rather than retail shelves. We do not make products or sell under a brand of our own. Here’s how the business works, and just as importantly, what it does not do.',
  images: ['/home/about-1.jpg', '/home/editorial-3.jpg'],
};

function mergeTuple<N extends readonly TitleBody[]>(defaults: N, stored: readonly Partial<TitleBody>[] | undefined): N {
  return defaults.map((d, i) => ({ ...d, ...stored?.[i] })) as unknown as N;
}

const DEFAULT_THEME: ThemeSettings = {
  colors: { ink: '#341316', accent: '#B84654', gold: '#D9B25A' },
  logoUrl: '',
  hero: {
    eyebrow: 'Beauty from brands you know',
    title: 'Beauty brands you love,\nunder one roof',
    subtitle: 'Shop makeup, skin care, body care and fragrance from brands you already trust — Lakmé, Lotus Herbals, Pond’s, Dot & Key, Himalaya and more — delivered to your door.',
    primaryCtaLabel: 'Shop Now',
    primaryCtaHref: '/shop',
    secondaryCtaLabel: 'Become a member',
    secondaryCtaHref: '/join',
    imageUrls: [],
  },
  announcement: DEFAULT_ANNOUNCEMENT,
  promoBanner: DEFAULT_PROMO_BANNER,
  promoStrip: DEFAULT_PROMO_STRIP,
  homeSections: DEFAULT_HOME_SECTIONS,
  trustBadges: DEFAULT_TRUST_BADGES,
  pinkBadges: DEFAULT_PINK_BADGES,
  exploreTiles: DEFAULT_EXPLORE_TILES,
  aboutUs: DEFAULT_ABOUT_US,
};

const API = () => {
  const origin = process.env.API_ORIGIN;
  return origin ? `${origin}/api` : '';
};

const REVALIDATE = 3600;

async function getJson<T>(path: string): Promise<T | null> {
  const origin = API();
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}${path}`, { next: { revalidate: REVALIDATE, tags: ['content'] } });
    if (!res.ok) return null;
    return JSON.parse(await res.text(), paiseReviver) as T;
  } catch {
    return null;
  }
}

export async function listBlogPosts(): Promise<BlogListItem[]> {
  const data = await getJson<{ items: BlogListItem[] }>('/blog');
  return data?.items ?? [];
}

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  return getJson<BlogPost>(`/blog/${encodeURIComponent(slug)}`);
}

export async function getCmsPage(slug: string): Promise<CmsPage | null> {
  return getJson<CmsPage>(`/pages/${encodeURIComponent(slug)}`);
}

/** Always resolves — falls back to the built-in copy so the homepage never has a "theme API is down" state. */
export async function getTheme(): Promise<ThemeSettings> {
  const t = await getJson<ThemeSettings>('/theme');
  if (!t) return DEFAULT_THEME;
  const hero = { ...DEFAULT_THEME.hero, ...t.hero };

  // The console's Theme page was saved with the original launch copy, which
  // describes Majestic Cart as the maker of its own products. It sells other
  // brands' products and makes none, so that wording is treated as unset and
  // the current default shows instead. Anything an admin writes afterwards is
  // left exactly as saved.
  const stale = {
    eyebrow: /^made in india$/i,
    title: /formulated for indian skin/i,
    subtitle: /glow botanics|urban skin co|formulated|developed for indian/i,
  } as const;
  for (const key of ['eyebrow', 'title', 'subtitle'] as const) {
    if (stale[key].test(hero[key])) hero[key] = DEFAULT_THEME.hero[key];
  }

  return {
    colors: { ...DEFAULT_THEME.colors, ...t.colors },
    logoUrl: t.logoUrl ?? '',
    hero,
    announcement: { ...DEFAULT_ANNOUNCEMENT, ...t.announcement },
    promoBanner: { ...DEFAULT_PROMO_BANNER, ...t.promoBanner },
    // Defensively merged the same way as the fields above: a backend that
    // hasn't been redeployed with these newer settings yet returns a `theme`
    // payload with these keys simply missing, not present-but-empty.
    promoStrip: { ...DEFAULT_PROMO_STRIP, ...t.promoStrip },
    homeSections: { ...DEFAULT_HOME_SECTIONS, ...t.homeSections },
    trustBadges: mergeTuple(DEFAULT_TRUST_BADGES, t.trustBadges),
    pinkBadges: mergeTuple(DEFAULT_PINK_BADGES, t.pinkBadges),
    exploreTiles: mergeTuple(DEFAULT_EXPLORE_TILES, t.exploreTiles),
    aboutUs: { ...DEFAULT_ABOUT_US, ...t.aboutUs },
  };
}
