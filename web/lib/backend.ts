import 'server-only';

/**
 * The member/admin API sits behind this site, not in front of it.
 *
 * `lib/api.ts` (the browser-side client) always calls a relative `/api/...`
 * path with `credentials: 'include'`, expecting the session to live in an
 * httpOnly cookie it can never read. Nothing issues that cookie on its own —
 * the real API returns tokens as JSON, not as a Set-Cookie header — so this
 * file, and the routes under `app/api/`, are the missing middle: every one of
 * them reads or writes these cookies and is the only code in the frontend
 * that ever sees a raw access or refresh token.
 *
 * `import 'server-only'` makes an accidental client-component import of this
 * file fail the build rather than ship `API_ORIGIN` — the backend's real,
 * internal address — into the browser bundle. The pure pieces (cookie names,
 * `safeNextPath`, the token-shape checks) live in `lib/session-shared.ts`
 * instead, specifically so they can be unit-tested in plain Node without
 * tripping that guard.
 */

export * from './session-shared';

const DEFAULT_BACKEND_ORIGIN = 'http://localhost:3001';
const BACKEND_PREFIX = '/api';

export function backendOrigin(): string {
  return process.env.API_ORIGIN ?? DEFAULT_BACKEND_ORIGIN;
}

export function backendUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${backendOrigin()}${BACKEND_PREFIX}${clean}`;
}

/**
 * Headers to carry from the visitor's original request onto the outgoing
 * backend call. Without these, `ClientContext` on the API sees this server's
 * own address on every request — every lockout, fraud signal and audit-log
 * row would record the proxy instead of the member.
 */
export function forwardedHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {};
  const ua = req.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua;
  const deviceId = req.headers.get('x-device-id');
  if (deviceId) headers['x-device-id'] = deviceId;

  // Prepend this request's own client IP so `req.ip` on the API (which reads
  // the left-most trusted entry once `trust proxy` is set) resolves to the
  // visitor, not to this server, even when this server itself sits behind
  // another proxy.
  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = clientIp(req);
  headers['x-forwarded-for'] = ip ? [ip, forwardedFor].filter(Boolean).join(', ') : (forwardedFor ?? '');
  return headers;
}

function clientIp(req: Request): string | null {
  // Next.js does not expose the platform-level connecting IP on the Request
  // object itself; on Vercel and most reverse proxies it arrives as one of
  // these headers instead.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  const real = req.headers.get('x-real-ip');
  return real?.trim() || null;
}
