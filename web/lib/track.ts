'use client';

/**
 * Anonymous storefront analytics, sent to /api/analytics/event.
 *
 * What is sent: a random id that lives in this tab's sessionStorage (gone when
 * the tab closes), the kind of event, and at most a product slug or a short
 * reason. No cookie, no member id, no IP is kept (see
 * backend/src/analytics/analytics.service.ts). A browser that sends Do Not
 * Track sends nothing at all. Every failure is swallowed: tracking must never
 * be able to break a page.
 */

export type EventType = 'visit' | 'view_product' | 'add_to_bag' | 'view_cart' | 'begin_checkout' | 'checkout_blocked' | 'order_placed';

const KEY = 'mc-sid';

function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(type: EventType, extra: { slug?: string; reason?: string } = {}): void {
  try {
    if (typeof window === 'undefined' || navigator.doNotTrack === '1') return;
    const sid = sessionId();
    if (!sid) return;
    const body = JSON.stringify({ sid, type, ...extra });
    // A Blob so the content type is JSON; sendBeacon survives the page being left straight after.
    if (!navigator.sendBeacon?.('/api/analytics/event', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/analytics/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* never let tracking break the page */
  }
}

/** Once per tab session, however many pages are visited. */
export function trackVisit(): void {
  try {
    if (sessionStorage.getItem('mc-visited')) return;
    sessionStorage.setItem('mc-visited', '1');
  } catch {
    return;
  }
  track('visit');
}
