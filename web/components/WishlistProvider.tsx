'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { MEMBER_FLAG_COOKIE } from '@/lib/session-shared';

/**
 * Which products the signed-in member has saved, for every heart on the site.
 *
 * Pages are statically cached, so a card cannot know at render time who is
 * looking. The browser learns it after load from the same plain flag cookie the
 * header uses, then asks the API once for the saved slugs.
 *
 *   • A visitor who is not signed in never causes a request. Tapping a heart
 *     remembers which product it was, sends them to log in, and saves it as
 *     soon as they are back (so the tap is not lost).
 *   • The first load must never bounce anyone to the login page: a flag cookie
 *     can outlive its session, and a background fetch is not a reason to
 *     interrupt browsing. Only a tap on a heart (something the member asked
 *     for) may do that.
 *   • A tap is optimistic and put back if the server refuses, with a message
 *     saying so, rather than the heart quietly un-filling.
 *   • One request per product at a time, and the latest state is read from a
 *     ref, so a quick double tap cannot act on a stale view of the list.
 */
interface WishlistState {
  has: (slug: string) => boolean;
  /** Saved while out of stock, so the member will be told when it is back. */
  alerting: (slug: string) => boolean;
  toggle: (slug: string) => Promise<void>;
  count: number;
  /** False until the saved list has been fetched, so a page can tell "empty" from "not loaded yet". */
  ready: boolean;
}

const Ctx = createContext<WishlistState | null>(null);

const PENDING_KEY = 'mc-wish-pending';

const signedIn = () => typeof document !== 'undefined' && document.cookie.split('; ').some((c) => c === `${MEMBER_FLAG_COOKIE}=1`);

const path = (slug: string) => `/me/wishlist/${encodeURIComponent(slug)}`;

function message(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'The wishlist is not available right now. Please try again in a little while.';
  if (err instanceof ApiError && err.status === 0) return err.message;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return 'Could not update your wishlist. Please try again.';
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The truth for decisions made inside event handlers; state is for rendering.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const busy = useRef<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const mark = useCallback((slug: string, on: boolean, alert?: boolean) => {
    setSaved((s) => { const n = new Set(s); if (on) n.add(slug); else n.delete(slug); return n; });
    setAlerts((s) => { const n = new Set(s); if (on && alert) n.add(slug); else n.delete(slug); return n; });
  }, []);

  useEffect(() => {
    if (!signedIn()) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ slugs: string[]; alerts: string[] }>('/me/wishlist/slugs', { skipAuthRedirect: true });
        if (cancelled) return;
        setSaved(new Set(r.slugs));
        setAlerts(new Set(r.alerts));
      } catch {
        // Not signed in after all, or the wishlist is unavailable: hearts simply start empty.
        return;
      } finally {
        if (!cancelled) setReady(true);
      }

      // A heart tapped before logging in is saved now that there is a session.
      let pending: string | null = null;
      try { pending = localStorage.getItem(PENDING_KEY); localStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ }
      if (pending && !cancelled) {
        try {
          const r = await api<{ alert: boolean }>(path(pending), { method: 'PUT', body: {}, skipAuthRedirect: true });
          if (!cancelled) { mark(pending, true, r.alert); say('Saved to your wishlist.'); }
        } catch { /* the product may be gone; nothing useful to say */ }
      }
    })();
    return () => { cancelled = true; };
  }, [mark, say]);

  const toggle = useCallback(async (slug: string) => {
    if (!signedIn()) {
      try { localStorage.setItem(PENDING_KEY, slug); } catch { /* storage blocked: they just tap again */ }
      router.push(`/login?next=${encodeURIComponent(pathname || '/')}`);
      return;
    }
    if (busy.current.has(slug)) return;
    busy.current.add(slug);

    const was = savedRef.current.has(slug);
    mark(slug, !was); // optimistic
    try {
      if (was) {
        await api(path(slug), { method: 'DELETE' });
      } else {
        const r = await api<{ alert: boolean }>(path(slug), { method: 'PUT', body: {} });
        mark(slug, true, r.alert);
        if (r.alert) say('We will message you when it is back in stock.');
      }
    } catch (err) {
      mark(slug, was, was && alertsRef.current.has(slug));
      say(message(err));
    } finally {
      busy.current.delete(slug);
    }
  }, [mark, pathname, router, say]);

  const value = useMemo<WishlistState>(() => ({
    has: (slug) => saved.has(slug),
    alerting: (slug) => alerts.has(slug),
    toggle,
    count: saved.size,
    ready,
  }), [saved, alerts, toggle, ready]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 xl:bottom-6">
        {toast && (
          <p role="status" className="pointer-events-auto max-w-sm rounded-xl bg-[var(--ink)] px-4 py-3 text-sm text-[var(--gold-pale)] shadow-xl">
            {toast}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

const NONE: WishlistState = { has: () => false, alerting: () => false, toggle: async () => undefined, count: 0, ready: true };

export function useWishlist(): WishlistState {
  return useContext(Ctx) ?? NONE;
}
