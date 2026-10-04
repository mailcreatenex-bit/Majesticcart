'use client';

/**
 * Tells the server about an uncaught browser error, so it shows up on the admin's Errors page.
 * Sends the message, a shortened stack and the page path, with no cookie, account or query
 * string. At most five a page view, so a loop cannot flood the server; failures are swallowed.
 */
let sent = 0;
const seen = new Set<string>();

export function reportError(message: string, stack?: string | null): void {
  try {
    if (typeof window === 'undefined' || sent >= 5 || seen.has(message)) return;
    seen.add(message);
    sent += 1;
    const body = JSON.stringify({
      message: message.slice(0, 400),
      stack: stack ? stack.slice(0, 3000) : undefined,
      path: location.pathname.slice(0, 200),
    });
    if (!navigator.sendBeacon?.('/api/monitoring/client-error', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/monitoring/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* never let reporting break the page */
  }
}
