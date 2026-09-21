import { NextRequest, NextResponse } from 'next/server';
import {
  backendUrl, forwardedHeaders, sessionCookieOptions, expiredCookieOptions,
  isIssuedTokens, withoutTokens, COOKIES, type Subject, type IssuedTokens,
  ACCESS_TOKEN_MAX_AGE_SECONDS, REFRESH_TOKEN_MAX_AGE_SECONDS,
} from '@/lib/backend';

/**
 * Everything `lib/api.ts` calls that isn't the login/signup form post lands
 * here: `/me`, `/orders`, `/wallet/...`, `/admin/...`, and so on. One handler
 * for all of it because the job is the same request in, request out — attach
 * the session, refresh it once if it had expired, hand the response back —
 * regardless of which backend route is behind the path.
 *
 * `auth/logout` and `admin/auth/logout` get one extra step: the browser can no
 * longer supply the refresh token (it is httpOnly), so this reads it from the
 * cookie and injects it into the backend call, then clears both cookies
 * whatever the backend answers — the visitor's intent was to end the session
 * here, and a revoke that failed server-side should not leave them looking
 * logged in.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * `admin/...` is unambiguous. Everything else prefers a member session but
 * falls back to an admin one — `reports/:key` is deliberately callable by
 * either, and this is the one place that ambiguity has to be resolved.
 */
function chooseSubject(path: string, cookies: NextRequest['cookies']): Subject {
  if (path === 'admin' || path.startsWith('admin/')) return 'admin';
  if (cookies.get(COOKIES.member.access) || cookies.get(COOKIES.member.refresh)) return 'member';
  if (cookies.get(COOKIES.admin.access) || cookies.get(COOKIES.admin.refresh)) return 'admin';
  return 'member';
}

async function handle(req: NextRequest, rawParams: Promise<{ path: string[] }>, method: Method) {
  const { path: segments } = await rawParams;
  const path = segments.join('/');
  const search = req.nextUrl.search;

  const subject = chooseSubject(path, req.cookies);
  const names = COOKIES[subject];
  const isLogout = path === 'auth/logout' || path === 'admin/auth/logout';

  let bodyText: string | undefined;
  if (isLogout) {
    bodyText = JSON.stringify({ refreshToken: req.cookies.get(names.refresh)?.value ?? '' });
  } else if (method !== 'GET') {
    const raw = await req.text();
    bodyText = raw.length > 0 ? raw : undefined;
  }

  const target = `${backendUrl(`/${path}`)}${search}`;
  const doFetch = (token?: string) =>
    fetch(target, {
      method,
      headers: {
        ...(bodyText !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...forwardedHeaders(req),
      },
      body: bodyText,
      cache: 'no-store',
    });

  let apiRes = await doFetch(req.cookies.get(names.access)?.value);
  let refreshed: IssuedTokens | null = null;

  // One retry, and only when there was something to refresh with. A 401 with
  // no refresh cookie is just "not signed in" — refreshing would only turn one
  // failed request into two.
  if (apiRes.status === 401 && !isLogout) {
    const refreshToken = req.cookies.get(names.refresh)?.value;
    if (refreshToken) {
      const refreshRes = await fetch(backendUrl(subject === 'admin' ? '/admin/auth/refresh' : '/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...forwardedHeaders(req) },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      const candidate = refreshRes.ok ? await refreshRes.json().catch(() => null) : null;
      if (isIssuedTokens(candidate)) {
        refreshed = candidate;
        apiRes = await doFetch(candidate.accessToken);
      }
    }
  }

  const status = apiRes.status;
  const contentType = apiRes.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (status !== 204) {
    payload = contentType.includes('application/json')
      ? await apiRes.json().catch(() => null)
      : await apiRes.text().catch(() => null);
  }

  // Any response shaped like a fresh token pair (admin login today; anything
  // added later that issues a session the same way) is converted here rather
  // than left for the browser to see — see `lib/backend.ts`.
  const issuesSession = isIssuedTokens(payload);
  const outBody = issuesSession ? withoutTokens(payload as IssuedTokens & Record<string, unknown>) : payload;

  const res = status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(outBody, { status });

  if (refreshed) {
    res.cookies.set(names.access, refreshed.accessToken, sessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
    res.cookies.set(names.refresh, refreshed.refreshToken, sessionCookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  }
  if (issuesSession) {
    const tokens = payload as IssuedTokens;
    res.cookies.set(names.access, tokens.accessToken, sessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
    res.cookies.set(names.refresh, tokens.refreshToken, sessionCookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
  }
  if (isLogout || (status === 401 && !isLogout)) {
    res.cookies.set(names.access, '', expiredCookieOptions());
    res.cookies.set(names.refresh, '', expiredCookieOptions());
  }

  return res;
}

type Ctx = { params: Promise<{ path: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => handle(req, ctx.params, 'GET');
export const POST = (req: NextRequest, ctx: Ctx) => handle(req, ctx.params, 'POST');
export const PUT = (req: NextRequest, ctx: Ctx) => handle(req, ctx.params, 'PUT');
export const PATCH = (req: NextRequest, ctx: Ctx) => handle(req, ctx.params, 'PATCH');
export const DELETE = (req: NextRequest, ctx: Ctx) => handle(req, ctx.params, 'DELETE');
