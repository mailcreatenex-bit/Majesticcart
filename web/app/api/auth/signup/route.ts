import { NextRequest, NextResponse } from 'next/server';
import { backendUrl, forwardedHeaders, sessionCookieOptions, isIssuedTokens, COOKIES, ACCESS_TOKEN_MAX_AGE_SECONDS, REFRESH_TOKEN_MAX_AGE_SECONDS, MEMBER_FLAG_COOKIE, memberFlagOptions } from '@/lib/backend';

/**
 * Target of `app/(shop)/signup/page.tsx`'s form. Signup succeeds straight into
 * a session (the API returns the same token shape as login), so this does the
 * same JSON-tokens-to-httpOnly-cookies step as `auth/login/route.ts` — see
 * that file for why the conversion happens here rather than in the browser.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const payload = {
    name: String(form.get('name') ?? '').trim(),
    phone: String(form.get('phone') ?? '').trim(),
    email: String(form.get('email') ?? '').trim() || undefined,
    password: String(form.get('password') ?? ''),
    sponsorCode: String(form.get('sponsorCode') ?? '').trim() || undefined,
  };

  const signupUrl = new URL('/signup', req.url);

  let apiRes: Response;
  try {
    apiRes = await fetch(backendUrl('/auth/signup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    signupUrl.searchParams.set('error', 'Could not reach the server. Please try again.');
    return NextResponse.redirect(signupUrl, 303);
  }

  const body = await apiRes.json().catch(() => null);

  if (!apiRes.ok || !isIssuedTokens(body)) {
    const message = (body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string')
      ? (body as { message: string }).message
      : 'Could not create your account. Please check the form and try again.';
    signupUrl.searchParams.set('error', message);
    // Everything except the password comes back as a query param so the next
    // render can refill it — a rejected password (or any other field error)
    // should not also cost the member re-typing their name and phone number.
    if (payload.name) signupUrl.searchParams.set('name', payload.name);
    if (payload.phone) signupUrl.searchParams.set('phone', payload.phone);
    if (payload.email) signupUrl.searchParams.set('email', payload.email);
    if (payload.sponsorCode) signupUrl.searchParams.set('sponsorCode', payload.sponsorCode);
    return NextResponse.redirect(signupUrl, 303);
  }

  // New members land on the ID card, where the first thing to do is add a photo.
  const res = NextResponse.redirect(new URL('/id-card?welcome=1', req.url), 303);
  res.cookies.set(COOKIES.member.access, body.accessToken, sessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
  res.cookies.set(COOKIES.member.refresh, body.refreshToken, sessionCookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  res.cookies.set(MEMBER_FLAG_COOKIE, '1', memberFlagOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  return res;
}
