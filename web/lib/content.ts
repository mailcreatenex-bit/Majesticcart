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
}

const DEFAULT_THEME: ThemeSettings = {
  colors: { ink: '#341316', accent: '#B84654', gold: '#D9B25A' },
  logoUrl: '',
  hero: {
    eyebrow: 'Beauty from brands you know',
    title: 'Beauty brands you love,\nunder one roof',
    subtitle: 'Makeup, skin care, body care and fragrance from leading beauty brands, delivered direct to your door.',
    primaryCtaLabel: 'Shop the range',
    primaryCtaHref: '/shop',
    secondaryCtaLabel: 'Become a member',
    secondaryCtaHref: '/join',
    imageUrl: '',
  },
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
  return { colors: { ...DEFAULT_THEME.colors, ...t.colors }, logoUrl: t.logoUrl ?? '', hero: { ...DEFAULT_THEME.hero, ...t.hero } };
}
