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
    imageUrl: string;
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
}

const DEFAULT_ANNOUNCEMENT: ThemeSettings['announcement'] = {
  enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '',
};

const DEFAULT_THEME: ThemeSettings = {
  colors: { ink: '#341316', accent: '#B84654', gold: '#D9B25A' },
  logoUrl: '',
  hero: {
    eyebrow: 'Beauty from brands you know',
    title: 'Beauty brands you love,\nunder one roof',
    subtitle: 'Shop makeup, skin care, body care and fragrance from brands you already trust — Lakmé, Lotus Herbals, Pond’s, Dot & Key, Himalaya and more — delivered to your door.',
    primaryCtaLabel: 'Shop the range',
    primaryCtaHref: '/shop',
    secondaryCtaLabel: 'Become a member',
    secondaryCtaHref: '/join',
    imageUrl: '',
  },
  announcement: DEFAULT_ANNOUNCEMENT,
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

  return { colors: { ...DEFAULT_THEME.colors, ...t.colors }, logoUrl: t.logoUrl ?? '', hero, announcement: { ...DEFAULT_ANNOUNCEMENT, ...t.announcement } };
}
