'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MEMBER_FLAG_COOKIE } from '@/lib/session-shared';

/**
 * Which products the signed-in member has saved, for every heart on the site.
 *
 * Pages are statically cached, so a card cannot know at render time who is
 * looking. The browser learns it after load from the same plain flag cookie the
 * header uses, then asks the API once for the saved slugs. A visitor who is not
 * signed in never causes a request, and tapping a heart sends them to log in
 * and brings them back to the page they were on.
 */
interface WishlistState {
  has: (slug: string) => boolean;
  /** Saved while out of stock, so the member will be told when it is back. */
  alerting: (slug: string) => boolean;
  toggle: (slug: string) => Promise<void>;
  count: number;
}

const Ctx = createContext<WishlistState | null>(null);

const signedIn = () => typeof document !== 'undefined' && document.cookie.split('; ').some((c) => c === `${MEMBER_FLAG_COOKIE}=1`);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!signedIn()) return;
    let cancelled = false;
    api<{ slugs: string[]; alerts: string[] }>('/me/wishlist/slugs')
      .then((r) => { if (!cancelled) { setSaved(new Set(r.slugs)); setAlerts(new Set(r.alerts)); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const toggle = useCallback(async (slug: string) => {
    if (!signedIn()) {
      router.push(`/login?next=${encodeURIComponent(pathname || '/')}`);
      return;
    }
    const was = saved.has(slug);
    // Optimistic, and put back if the server says no.
    setSaved((s) => { const n = new Set(s); if (was) n.delete(slug); else n.add(slug); return n; });
    try {
      if (was) {
        await api(`/me/wishlist/${encodeURIComponent(slug)}`, { method: 'DELETE' });
        setAlerts((s) => { const n = new Set(s); n.delete(slug); return n; });
      } else {
        const r = await api<{ alert: boolean }>(`/me/wishlist/${encodeURIComponent(slug)}`, { method: 'PUT', body: {} });
        if (r.alert) setAlerts((s) => new Set(s).add(slug));
      }
    } catch {
      setSaved((s) => { const n = new Set(s); if (was) n.add(slug); else n.delete(slug); return n; });
    }
  }, [saved, router, pathname]);

  const value = useMemo<WishlistState>(() => ({
    has: (slug) => saved.has(slug),
    alerting: (slug) => alerts.has(slug),
    toggle,
    count: saved.size,
  }), [saved, alerts, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NONE: WishlistState = { has: () => false, alerting: () => false, toggle: async () => undefined, count: 0 };

export function useWishlist(): WishlistState {
  return useContext(Ctx) ?? NONE;
}
