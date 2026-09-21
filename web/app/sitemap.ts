import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';
import { LEGAL_DOCUMENTS } from '@/lib/legal';
import { absoluteUrl } from '@/lib/referral';

/**
 * Sitemap, generated from the live catalogue.
 *
 * Only indexable pages appear. Nothing behind the login is listed: a sitemap
 * entry for a page that returns noindex is a contradictory signal and wastes
 * crawl budget.
 *
 * Revalidated on the same cadence as the catalogue, so a new product becomes
 * discoverable without a deploy.
 */
export const revalidate = 3600;

interface CatalogEntry { slug: string; updatedAt?: string }

async function fetchEntries(path: string): Promise<CatalogEntry[]> {
  const origin = process.env.API_ORIGIN;
  // No origin configured (e.g. the frontend deployed before the backend
  // exists) and a network failure both mean the same thing here: skip these
  // entries rather than take the whole sitemap route down with a build error.
  if (!origin) return [];
  try {
    const res = await fetch(`${origin}/api${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    fetchEntries('/catalog/sitemap'),
    fetchEntries('/catalog/categories'),
  ]);
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE.origin, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/shop', SITE.origin), lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: absoluteUrl('/about', SITE.origin), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/faq', SITE.origin), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/contact', SITE.origin), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl('/join', SITE.origin), lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/shade-finder', SITE.origin), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    // Indexable per robotsFor() (they're not in PRIVATE_PREFIXES — a member
    // searching "majestic cart login" is meant to find this), but nothing
    // was pointing a crawler at them beyond the footer link.
    { url: absoluteUrl('/login', SITE.origin), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl('/signup', SITE.origin), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    // Same gap, same fix: real, indexable pages with no sitemap entry.
    ...LEGAL_DOCUMENTS.map((d) => ({
      url: absoluteUrl(`/legal/${d.slug}`, SITE.origin),
      lastModified: now, changeFrequency: 'yearly' as const, priority: 0.2,
    })),
  ];

  return [
    ...staticPages,
    ...categories.map((c) => ({
      url: absoluteUrl(`/category/${c.slug}`, SITE.origin),
      // /catalog/categories doesn't carry an updatedAt (it's a lightweight
      // listing) — fall back to build time rather than crash the sitemap
      // route on `new Date(undefined).toISOString()`.
      lastModified: c.updatedAt ? new Date(c.updatedAt) : now, changeFrequency: 'weekly' as const, priority: 0.8,
    })),
    ...products.map((p) => ({
      url: absoluteUrl(`/product/${p.slug}`, SITE.origin),
      lastModified: p.updatedAt ? new Date(p.updatedAt) : now, changeFrequency: 'weekly' as const, priority: 0.7,
    })),
  ];
}
