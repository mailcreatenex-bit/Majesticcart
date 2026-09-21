'use client';

import { paiseReviver } from './paise';

/**
 * The browser's client for the member API.
 *
 * Everything here runs after login, against routes the API scopes to the
 * caller's own token. The rules this file exists to hold:
 *
 *   • **The member id is never sent.** It lives in the access token and the
 *     server reads it from there. A client that passes its own id invites a
 *     client that passes someone else's.
 *   • **A 401 means the session ended**, not that the call failed. It redirects
 *     to login rather than surfacing an error the member cannot act on.
 *   • **Double-submit protection is per-endpoint, not a header.** There is no
 *     `Idempotency-Key` interceptor on this API, so a header would look like
 *     protection while doing nothing. Each write path dedupes in its own way
 *     and the caller has to use the right one — see `newRequestId` below.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Field-level messages from the server's zod validation, when present. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = process.env.NEXT_PUBLIC_API_ORIGIN ?? '/api';

/**
 * Where to send someone whose session has ended, preserving where they were.
 *
 * An admin whose session lapses mid-console must land on `/admin/login`, not
 * the member login page — those are two different accounts with two different
 * credential types, and sending an admin to the member form reads as "you are
 * not who you think you are" for no reason.
 */
function toLogin(path: string) {
  if (typeof window === 'undefined') return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  const isAdminCall = path.startsWith('/admin');
  window.location.href = isAdminCall ? `/admin/login?next=${next}` : `/login?next=${next}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      // The token is an httpOnly cookie: it is never readable from JavaScript,
      // so an XSS cannot exfiltrate it the way a localStorage token can.
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // Offline, DNS, a dropped connection mid-request. Distinguished from a
    // server error because the member can actually do something about it.
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  if (res.status === 401) {
    toLogin(path);
    throw new ApiError('Your session has ended. Please log in again.', 401);
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = JSON.parse(await res.text(), paiseReviver);
  } catch {
    // A non-JSON body on an error is a proxy or gateway page, not the API.
    if (!res.ok) throw new ApiError(`Something went wrong (${res.status}).`, res.status);
  }

  if (!res.ok) {
    const p = payload as { message?: string | string[]; fields?: Record<string, string> } | null;
    const message = Array.isArray(p?.message) ? p.message[0] : p?.message;
    throw new ApiError(message ?? `Something went wrong (${res.status}).`, res.status, p?.fields);
  }

  return payload as T;
}

/* ------------------------------------------------- double-submit safety
 *
 * On Indian mobile data a slow POST looks exactly like a failed one, so the
 * member taps again. Every write path therefore has to be safe to repeat — but
 * each one achieves it differently, and using the wrong mechanism looks like
 * protection while providing none:
 *
 *   • **Checkout** (`POST /orders`) takes a `requestId` UUID **in the body**.
 *     The server derives its ledger key from it, so the same id twice is one
 *     order. This is the only path where the client supplies the key, and the
 *     only one where forgetting it means real duplicate money movement.
 *   • **Recharge** (`POST /wallet/recharge`) dedupes on the UTR: the same
 *     reference twice is a 409, because one bank payment is one credit.
 *   • **Withdrawal** (`POST /wallet/withdrawal`) allows one PENDING request per
 *     member, checked inside the transaction.
 *   • **Admin approve / reject** lock the row and check its status, so a second
 *     press gets "already processed" rather than a second credit.
 *
 * Only the first needs anything from the client. There is deliberately no
 * generic header helper here, because one would get reached for on the other
 * three and quietly do nothing.
 * ------------------------------------------------------------------------ */

/**
 * A `requestId` for checkout.
 *
 * `crypto.randomUUID` is available in every browser this site supports over
 * HTTPS, which the site requires anyway for the service worker. The fallback
 * covers an insecure-context dev server rather than any real user — and it
 * still has to be a v4-shaped UUID, because the server validates it as one.
 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();

  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  // Version 4, variant 10xx — the shape z.string().uuid() accepts.
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}
