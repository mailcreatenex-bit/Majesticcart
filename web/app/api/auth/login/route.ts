import { NextRequest, NextResponse } from 'next/server';
import { backendUrl, forwardedHeaders, sessionCookieOptions, safeNextPath, isIssuedTokens, COOKIES, ACCESS_TOKEN_MAX_AGE_SECONDS, REFRESH_TOKEN_MAX_AGE_SECONDS, MEMBER_FLAG_COOKIE, memberFlagOptions } from '@/lib/backend';

/**
 * Target of `app/(shop)/login/page.tsx`'s real `<form method="post">`.
 *
 * The page posts here (not straight to the API) specifically so this step can
 * exist: take the JSON tokens the API returns, turn them into httpOnly
 * cookies the browser will carry automatically, and never let the tokens
 * themselves reach client JavaScript. A plain fetch from the login page could
 * call the API directly, but then the tokens would land in a variable in the
 * browser with nowhere safe to put them.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const identifier = String(form.get('identifier') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = safeNextPath(String(form.get('next') ?? ''));

  const loginUrl = new URL('/login', req.url);
  if (next) loginUrl.searchParams.set('next', next);

  if (!identifier || !password) {
    loginUrl.searchParams.set('error', 'Enter your mobile number or member ID and your password.');
    return NextResponse.redirect(loginUrl, 303);
  }

  let apiRes: Response;
  try {
    apiRes = await fetch(backendUrl('/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
      body: JSON.stringify({ identifier, password }),
      cache: 'no-store',
    });
  } catch {
    loginUrl.searchParams.set('error', 'Could not reach the server. Please try again.');
    return NextResponse.redirect(loginUrl, 303);
  }

  const body = await apiRes.json().catch(() => null);

  if (!apiRes.ok || !isIssuedTokens(body)) {
    const message = (body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string')
      ? (body as { message: string }).message
      : 'That phone number or password is not right.';
    loginUrl.searchParams.set('error', message);
    loginUrl.searchParams.set('identifier', identifier);
    return NextResponse.redirect(loginUrl, 303);
  }

  const target = new URL(next ?? '/account', req.url);
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(COOKIES.member.access, body.accessToken, sessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
  res.cookies.set(COOKIES.member.refresh, body.refreshToken, sessionCookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  res.cookies.set(MEMBER_FLAG_COOKIE, '1', memberFlagOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  return res;
}
