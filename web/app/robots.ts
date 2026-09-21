import type { MetadataRoute } from 'next';
import { SITE, PRIVATE_PREFIXES } from '@/lib/seo';
import { REF_PARAM, NON_CANONICAL_PARAMS } from '@/lib/referral';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          ...PRIVATE_PREFIXES.map((p) => `${p}/`),
          // Belt and braces behind the middleware redirect. If a referral link
          // is discovered in the wild, no crawl budget is spent on it.
          ...[...NON_CANONICAL_PARAMS].map((p) => `/*?${p}=`),
          `/*?*${REF_PARAM}=`,
        ],
      },
      // These crawl aggressively and add nothing for an Indian D2C storefront.
      { userAgent: ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot'], disallow: '/' },
    ],
    sitemap: `${SITE.origin}/sitemap.xml`,
    host: SITE.origin,
  };
}
