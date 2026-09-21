/**
 * The pure half of `lib/backend.ts`, split out so it can be unit-tested
 * directly: `backend.ts` imports the `server-only` marker, which throws if
 * evaluated outside Next.js's own server bundler, so nothing that needs a
 * test in plain Node can live there. Nothing here touches `process.env`,
 * `fetch`, or a `Request`/`Response` — only data in, data out.
 */

export type Subject = 'member' | 'admin';

export const COOKIES: Record<Subject, { access: string; refresh: string }> = {
  member: { access: 'mc_session', refresh: 'mc_refresh' },
  admin: { access: 'mc_admin_session', refresh: 'mc_admin_refresh' },
};

// Mirrors ACCESS_TTL_SECONDS / REFRESH_TTL_DAYS in
// backend/src/auth/token.service.ts — see the note in `lib/backend.ts`.
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 15 * 60;
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeSeconds,
  };
}

export function expiredCookieOptions() {
  return { ...sessionCookieOptions(0), maxAge: 0 };
}

/**
 * A `next` query param is attacker-controlled input rendered straight into a
 * redirect target, so `?next=https://evil.example` must not survive: without
 * this check a phishing link that ends in a real login screen would hand the
 * visitor a genuine session and then bounce them off-site with it.
 */
export function safeNextPath(raw: string | null | undefined, opts: { prefix?: string } = {}): string | null {
  if (!raw) return null;
  // Must start with exactly one '/': "//evil.example" parses in the browser
  // as a protocol-relative URL (same scheme, different host), not a path.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  if (opts.prefix && !raw.startsWith(opts.prefix)) return null;
  return raw;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

/** True for a JSON object carrying the shape `AuthService`/`TokenService` return on sign-in. */
export function isIssuedTokens(body: unknown): body is IssuedTokens {
  return (
    !!body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>).accessToken === 'string' &&
    typeof (body as Record<string, unknown>).refreshToken === 'string'
  );
}

/** Strips the raw tokens out of a response body before it reaches the browser. */
export function withoutTokens(body: IssuedTokens & Record<string, unknown>): Record<string, unknown> {
  const { accessToken: _a, refreshToken: _r, ...rest } = body;
  return rest;
}
