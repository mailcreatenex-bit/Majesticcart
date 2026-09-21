import type { MoneyView, VolumeView } from './money';
import { paiseReviver } from './paise';

/**
 * The public catalogue.
 *
 * These fetches run on the server during build and revalidation, never in the
 * browser: `API_ORIGIN` has no `NEXT_PUBLIC_` prefix, so it does not reach the
 * client bundle and the API's internal address stays internal.
 *
 * Every function here fails soft. A catalogue outage should leave the shop
 * showing an empty shelf, not a 500 — the home page is also the page a crawler
 * hits, and serving it a server error is how a site loses its ranking over a
 * five-minute incident.
 */

export interface CatalogProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  categorySlug: string;
  brand?: string | null;
  brandSlug?: string | null;
  price: MoneyView;
  mrp: MoneyView;
  businessVolume: VolumeView;
  gstPercent: number;
  hsnCode: string;
  countryOfOrigin: string;
  inStock: boolean;
  imageUrl?: string;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  description?: string;
  productCount?: number;
  imageUrl?: string;
}

export interface CatalogBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
}

const API = () => {
  const origin = process.env.API_ORIGIN;
  return origin ? `${origin}/api` : '';
};

/** An hour. Price and stock stay fresh without a deploy; crawlers get HTML. */
export const CATALOG_REVALIDATE = 3600;

async function getJson<T>(path: string, init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }): Promise<T | null> {
  const origin = API();
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}${path}`, {
      next: { revalidate: CATALOG_REVALIDATE, ...init?.next },
      ...init,
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text(), paiseReviver) as T;
  } catch {
    // Network error, DNS, timeout. The caller substitutes an empty result.
    return null;
  }
}

export async function listProducts(opts: {
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'popular';
  search?: string;
  limit?: number;
} = {}): Promise<CatalogProduct[]> {
  const qs = new URLSearchParams();
  if (opts.category) qs.set('category', opts.category);
  if (opts.brand) qs.set('brand', opts.brand);
  if (opts.minPrice) qs.set('minPrice', opts.minPrice);
  if (opts.maxPrice) qs.set('maxPrice', opts.maxPrice);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.search) qs.set('search', opts.search);
  if (opts.limit) qs.set('limit', String(opts.limit));

  // The API pages its list; the storefront's grids are small enough to take
  // the first page. `nextCursor` is deliberately ignored here rather than
  // looped over — an unbounded fetch loop on a statically generated page is a
  // build that gets slower every time the client adds a product.
  const data = await getJson<{ items: CatalogProduct[]; nextCursor: string | null }>(
    `/catalog/products${qs.toString() ? `?${qs}` : ''}`,
    { next: { tags: ['catalog'] } },
  );
  return data?.items ?? [];
}

export async function getProduct(slug: string): Promise<CatalogProduct | null> {
  return getJson<CatalogProduct>(`/catalog/product/${encodeURIComponent(slug)}`, {
    next: { tags: [`product:${slug}`] },
  });
}

export async function listCategories(): Promise<CatalogCategory[]> {
  const data = await getJson<CatalogCategory[]>('/catalog/categories', { next: { tags: ['catalog'] } });
  return data ?? [];
}

export async function getCategory(slug: string): Promise<CatalogCategory | null> {
  const all = await listCategories();
  return all.find((c) => c.slug === slug) ?? null;
}

/** Only brands with at least one visible product — see CatalogService.activeBrands(). */
export async function listBrands(): Promise<CatalogBrand[]> {
  const data = await getJson<CatalogBrand[]>('/catalog/brands', { next: { tags: ['catalog'] } });
  return data ?? [];
}

export async function getBrand(slug: string): Promise<CatalogBrand | null> {
  const all = await listBrands();
  return all.find((b) => b.slug === slug) ?? null;
}

/** Backs `/mc/[code]` — first name and code only; see the API for why. */
export async function getStorefrontMember(code: string): Promise<{ code: string; firstName: string } | null> {
  return getJson<{ code: string; firstName: string }>(`/catalog/storefront/${encodeURIComponent(code)}`);
}

/* ----------------------------------------------------------------- copy */

/**
 * Category descriptions, as static copy rather than a database column.
 *
 * A category page with nothing but a product grid is a thin page, and thin
 * category pages are what keep a new e-commerce site out of the index. This
 * gives each one something to actually rank for. The client can override any
 * of it from the admin console; this is the fallback when they have not.
 *
 * Nothing here mentions earnings — these pages are indexable, and the
 * income-claim lint in lib/seo.ts runs over this file's output in the test
 * suite.
 */
export const CATEGORY_COPY: Record<string, { blurb: string; intro: string }> = {
  makeup: {
    blurb: 'Colour cosmetics formulated for Indian skin tones.',
    intro:
      'Foundations, lipsticks and eye colour built around Indian undertones rather than adapted from shades made for other markets. Every formula is dermatologically tested and made in India.',
  },
  'skin-care': {
    blurb: 'Serums, cleansers and moisturisers for humid Indian weather.',
    intro:
      'Skin care designed for the climate it is worn in — lightweight textures that hold up through a humid afternoon, with actives at concentrations meant for daily use rather than a single dramatic result.',
  },
  'body-care': {
    blurb: 'Lotions, butters and washes for everyday skin.',
    intro:
      'Body care for regular use: lotions that absorb rather than sit, butters for dry winter skin, and washes gentle enough for daily showers.',
  },
  fragrance: {
    blurb: 'Eau de parfum with the depth Indian occasions call for.',
    intro:
      'Fragrance built on oud, saffron, rose and sandalwood — notes that belong to this part of the world — concentrated as eau de parfum so they last through an evening.',
  },
};

export const categoryCopy = (slug: string) =>
  CATEGORY_COPY[slug] ?? {
    blurb: 'Explore the range.',
    intro: 'Browse the full selection in this category.',
  };
