import { NextRequest, NextResponse } from 'next/server';
import { canonicalise, refCookieOptions, normaliseRefCode, REF_COOKIE } from './lib/referral';
import { isPrivatePath } from './lib/seo';

/**
 * Edge middleware.
 *
 * Three jobs, all of which have to happen before the page renders:
 *
 *  1. Capture the referral code into a cookie and redirect to the clean URL, so
 *     a crawler only ever sees one address per product.
 *  2. Do the same for a member's `/mc/:code` storefront link — but without the
 *     redirect, because unlike `?ref=`, `/mc/:code` already *is* the clean,
 *     canonical URL for that page. A Server Component can only read cookies,
 *     not set them, which is why this lives here instead of in
 *     `app/(shop)/mc/[code]/page.tsx` itself.
 *  3. Send noindex headers for anything behind the login, as a second line
 *     behind the per-page robots metadata. A page that forgets its metadata is
 *     still protected.
 */
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  const storefrontCode = normaliseRefCode(pathname.match(/^\/mc\/([^/]+)\/?$/)?.[1]);

  const { path, ref, shouldRedirect } = canonicalise(pathname, searchParams);

  if (shouldRedirect) {
    const url = new URL(path, req.url);
    // 308 rather than 302: permanent, and it preserves the method. Crawlers
    // consolidate signals onto the target instead of keeping both URLs.
    const res = NextResponse.redirect(url, 308);
    // Set the cookie on the redirect itself, or the code is lost in the hop.
    if (ref) res.cookies.set({ ...refCookieOptions, value: ref });
    return res;
  }

  const res = NextResponse.next();
  const effectiveRef = ref ?? storefrontCode;
  if (effectiveRef && req.cookies.get(REF_COOKIE)?.value !== effectiveRef) {
    res.cookies.set({ ...refCookieOptions, value: effectiveRef });
  }
  if (isPrivatePath(pathname)) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return res;
}

export const config = {
  // Static assets and image optimisation are excluded: redirecting those costs
  // latency on every page load and gains nothing.
  //
  // `api/` is excluded for a sharper reason than latency: canonicalise() 308s
  // away any query parameter outside its small marketing allowlist, which is
  // exactly right for a crawlable shop URL and exactly wrong for a JSON
  // endpoint — a paginated admin list like `/api/admin/recharges?cursor=...`
  // would have its cursor silently stripped before the request ever reached
  // `app/api/[...path]/route.ts`. API routes get no SEO treatment because
  // they are not pages; letting this run on them was fixing one problem by
  // quietly causing another.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$).*)'],
};
