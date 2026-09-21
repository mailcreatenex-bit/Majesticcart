'use client';

import { useEffect, useState } from 'react';

/**
 * Royal Night.
 *
 * The theme is applied by `themeBootScript` below, which runs before React
 * hydrates. Without it the page paints in the light theme and then snaps to
 * dark a moment later — the flash is worse than not having the feature.
 *
 * Preference is remembered per device, not per account: someone reading in bed
 * on their phone and someone checking orders on a shared desktop want
 * different answers, and a server-stored preference would force one on both.
 */

const STORAGE_KEY = 'mc-theme';
export type Theme = 'day' | 'night';

/**
 * Inlined into <head> with dangerouslySetInnerHTML. Deliberately tiny and
 * dependency-free: it blocks the first paint, so anything slow here is a
 * blank screen on a mid-range Android phone.
 *
 * Wrapped in try/catch because localStorage throws outright in Safari private
 * mode and when cookies are blocked — an exception here would stop the rest
 * of the document's scripts, so the cost of not catching it is the whole page.
 */
export const themeBootScript = `(function(){try{
var t=localStorage.getItem('${STORAGE_KEY}');
if(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='night';
if(t==='night')document.documentElement.setAttribute('data-theme','night');
}catch(e){}})();`;

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'night' || stored === 'day') return stored;
  } catch { /* storage unavailable; fall through to the system preference */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

export function ThemeToggle({ className }: { className?: string }) {
  // Starts as null rather than 'day' so the first client render matches what
  // the server sent; otherwise React hydration warns and, worse, briefly
  // renders the wrong icon.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => { setTheme(readTheme()); }, []);

  const toggle = () => {
    const next: Theme = theme === 'night' ? 'day' : 'night';
    setTheme(next);
    if (next === 'night') document.documentElement.setAttribute('data-theme', 'night');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* nothing to do */ }
  };

  const night = theme === 'night';

  return (
    <button
      type="button"
      onClick={toggle}
      // The label states what the control does, not what is currently on —
      // "Royal Night" alone would leave a screen-reader user guessing whether
      // pressing it turns the theme on or off.
      aria-label={night ? 'Switch to the day theme' : 'Switch to Royal Night'}
      title={night ? 'Day' : 'Royal Night'}
      className={className ?? 'inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]'}
    >
      {/* Before hydration the theme is unknown, so neither icon is correct —
          an empty box of the same size keeps the header from reflowing. */}
      {theme === null ? <span className="h-[18px] w-[18px]" /> : night ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** The crescent from the logo, not a generic filled moon. */
function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      <path d="M17.5 3.5 18 5l1.5.5L18 6l-.5 1.5L17 6l-1.5-.5L17 5Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
