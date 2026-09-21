/**
 * Referral links.
 *
 * Every member shares product links carrying their sponsor ID:
 *
 *   /product/rose-gold-body-lotion?ref=MC100002
 *
 * With 500 members that is 500 URLs serving one product. To a crawler those are
 * 500 near-identical pages, and the usual outcome is that none of them ranks:
 * link equity splits across the variants, and the site trips duplicate-content
 * handling. This is the most common and most expensive SEO mistake in MLM
 * e-commerce, and it is entirely avoidable.
 *
 * The fix has three parts, and all three are needed:
 *
 *   1. Middleware reads ?ref, drops it into a cookie, and 308-redirects to the
 *      clean URL. Crawlers and humans both end up on one canonical address.
 *   2. Every page emits a canonical tag pointing at the ref-free URL, as a
 *      backstop for any variant that escapes the redirect.
 *   3. robots.txt disallows the parameter, so a crawler that finds one in the
 *      wild does not spend budget on it.
 *
 * The attribution itself is unaffected — the cookie carries the sponsor through
 * signup exactly as the query string did.
 */

export const REF_PARAM = 'ref';
export const REF_COOKIE = 'mc_ref';
/** 30 days. Long enough for a considered purchase, short enough to stay honest. */
export const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Member codes are MC followed by digits. Anything else is discarded. */
const MEMBER_CODE = /^MC\d{4,12}$/;

export function normaliseRefCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  // Validate before it is ever written to a cookie or echoed into a page. An
  // unvalidated ref is a reflected-XSS vector and a cookie-stuffing vector.
  return MEMBER_CODE.test(code) ? code : null;
}

/**
 * Query parameters that must never appear in a canonical URL.
 *
 * Marketing and analytics tags multiply URLs the same way referral codes do,
 * so they are stripped from the canonical even though they are kept in the
 * address bar for attribution.
 */
export const NON_CANONICAL_PARAMS = new Set([
  REF_PARAM, 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', '_branch_match_id',
]);

/**
 * Parameters that legitimately change what the page shows.
 *
 * `next`, `error` and `identifier` are here for the auth pages, not the
 * catalogue: `app/api/auth/login/route.ts` redirects a failed attempt back to
 * `/login?error=...`, and without an allowlist entry `canonicalise()` would
 * treat that as a tracking parameter and 308 it straight back to a bare
 * `/login` — stripping the message before the page ever renders it. They
 * never affect the canonical tag itself, since the auth pages pass a fixed
 * `pathname` to `buildMetadata` rather than deriving one from the request.
 *
 * `name`, `phone`, `email` and `sponsorCode` are the same story for
 * `/signup`: a rejected password redirects back with the other fields still
 * filled in rather than making the member retype them, and that only works
 * if this allowlist lets the values survive the redirect.
 */
export const CANONICAL_PARAMS = new Set([
  'page', 'sort', 'category', 'q', 'next', 'error', 'identifier',
  'name', 'phone', 'email', 'sponsorCode',
]);

export interface CanonicalResult {
  /** Path plus only the parameters that genuinely change the content. */
  path: string;
  /** The referral code found, if any. */
  ref: string | null;
  /** True when the request should be redirected to `path`. */
  shouldRedirect: boolean;
}

/**
 * Work out the canonical form of an incoming URL.
 *
 * Parameters are re-emitted in a fixed order: ?sort=price&page=2 and
 * ?page=2&sort=price are the same page, and without sorting they would be two
 * canonical URLs again.
 */
export function canonicalise(pathname: string, search: string | URLSearchParams): CanonicalResult {
  const params = typeof search === 'string' ? new URLSearchParams(search) : new URLSearchParams(search);
  const ref = normaliseRefCode(params.get(REF_PARAM));

  const kept = new URLSearchParams();
  let dropped = false;
  for (const key of [...params.keys()].sort()) {
    if (CANONICAL_PARAMS.has(key)) {
      const value = params.get(key);
      if (value) kept.set(key, value);
    } else {
      dropped = true;
    }
  }

  const cleanPath = stripTrailingSlash(pathname);
  const qs = kept.toString();
  return {
    path: qs ? `${cleanPath}?${qs}` : cleanPath,
    ref,
    // Redirect only when something was actually removed, or the path needed
    // tidying. Redirecting a clean URL to itself is an infinite loop.
    shouldRedirect: dropped || cleanPath !== pathname,
  };
}

/** "/shop/" and "/shop" are one page. Pick one; the root stays "/". */
export function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
  return pathname;
}

export function absoluteUrl(path: string, origin: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${origin.replace(/\/$/, '')}${clean}`;
}

/**
 * The canonical URL for a page. Always ref-free, always absolute, always
 * without tracking parameters.
 */
export function canonicalUrl(pathname: string, search: string | URLSearchParams, origin: string): string {
  return absoluteUrl(canonicalise(pathname, search).path, origin);
}

/** A shareable member link. The ref is a parameter; the canonical is not. */
export function buildReferralLink(path: string, memberCode: string, origin: string): string {
  const code = normaliseRefCode(memberCode);
  if (!code) throw new Error(`"${memberCode}" is not a valid member code`);
  const url = new URL(absoluteUrl(path, origin));
  url.searchParams.set(REF_PARAM, code);
  return url.toString();
}

export const refCookieOptions = {
  name: REF_COOKIE,
  maxAge: REF_COOKIE_MAX_AGE,
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: false, // the signup form reads it client-side
  secure: process.env.NODE_ENV === 'production',
};
