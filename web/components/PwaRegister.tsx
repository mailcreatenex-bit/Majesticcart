'use client';

import { useEffect } from 'react';

/**
 * Service worker registration.
 *
 * The `beforeinstallprompt` capture does NOT live here — see
 * `installCaptureScript` and `ensureInstallCapture` below.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // a cached shell makes dev confusing

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        // Not fatal: the site works fine without it, it just is not installable
        // and has no offline page.
        console.warn('Service worker registration failed', err);
      });
    };

    // After load, so registration never competes with the first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}

/* ------------------------------------------------------------------ capture
 *
 * `beforeinstallprompt` fires once, cannot be retrieved afterwards, and does
 * not fire again on its own. Miss it and the install button does nothing —
 * with no error in the console and nothing to debug.
 *
 * The capture is therefore wired twice, by two independent routes:
 *
 *   1. `installCaptureScript`, an inline <script> in the document, which runs
 *      as the parser reaches it — before React has downloaded, let alone
 *      hydrated.
 *   2. `ensureInstallCapture()`, called by the install components on mount.
 *
 * Neither is trusted to be first. Next injects its own bundles as `async`
 * scripts near the top of <head>, so on a warm cache a bundle can execute
 * before an inline script further down the document; and `next/script` with
 * strategy="beforeInteractive" does not help, because in the App Router it
 * queues into Next's own runtime rather than emitting a raw inline script,
 * which puts it *after* the bundles rather than before them.
 *
 * Rather than argue about who wins that race, both routes share one flag and
 * one stash, so whichever runs first wires the listener and the other is a
 * no-op. Correctness stops depending on document order.
 * ---------------------------------------------------------------------- */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallStash {
  event: BeforeInstallPromptEvent | null;
  installed: boolean;
  /** Set by whichever route wires the listeners first. */
  wired?: boolean;
}

declare global {
  interface Window {
    __mcInstall?: InstallStash;
  }
}

/** Runs in the document. Kept in sync with `ensureInstallCapture` below. */
export const installCaptureScript = `
(function () {
  var s = window.__mcInstall || (window.__mcInstall = { event: null, installed: false });
  if (s.wired) return;
  s.wired = true;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    s.event = e;
    window.dispatchEvent(new Event('mc-install-available'));
  });
  window.addEventListener('appinstalled', function () {
    s.event = null;
    s.installed = true;
    window.dispatchEvent(new Event('mc-install-done'));
  });
})();
`.trim();

/**
 * The same wiring, from React.
 *
 * Safe to call from every component on every mount: the shared `wired` flag
 * means only the first call attaches anything.
 */
export function ensureInstallCapture(): InstallStash {
  const stash: InstallStash =
    window.__mcInstall ?? (window.__mcInstall = { event: null, installed: false });
  if (stash.wired) return stash;
  stash.wired = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    stash.event = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('mc-install-available'));
  });
  window.addEventListener('appinstalled', () => {
    stash.event = null;
    stash.installed = true;
    window.dispatchEvent(new Event('mc-install-done'));
  });

  return stash;
}
