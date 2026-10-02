'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { T, LanguageSwitcher } from './LocaleProvider';
import type { TKey } from '@/lib/i18n';

/**
 * The category nav, for phones.
 *
 * The header's `<ul>` of shop links is `hidden` below `md` — there was no
 * mobile equivalent at all, so a phone visitor had no way to reach "Makeup"
 * or "Skin care" without scrolling to the footer. This is that equivalent:
 * a toggle button plus a dropdown panel, closed by default.
 */
export interface MenuGroup { href: string; label: string; k?: TKey; children?: { href: string; label: string }[] }

export function MobileMenu({ links, onColor = false }: { links: MenuGroup[]; onColor?: boolean }) {
  const [open, setOpen] = useState(false);

  // Closing on route change would need a router event; closing on Escape and
  // on resize past the breakpoint covers the cases that actually happen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => { if (window.innerWidth >= 1280) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div className="xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-shop-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${onColor ? 'text-white hover:bg-white/15' : 'text-[var(--muted)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]'}`}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open && (
        <>
          {/* Click-outside target, not a visual scrim — the panel below already
              reads as attached to the header. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id="mobile-shop-menu"
            className="absolute inset-x-0 top-full z-40 max-h-[80vh] overflow-y-auto border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[var(--body)] shadow-lg"
          >
            {/* Search lives in the header band itself on phones now (see
                MobileSearchBar), so this panel is just the department list
                and the language choice. */}
            <ul>
            {links.map((l) => (
              <li key={l.href}>
                {l.children && l.children.length > 0 ? (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-3 text-[var(--body)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
                      {l.label}
                      <span aria-hidden="true" className="text-xs transition group-open:rotate-180">▾</span>
                    </summary>
                    <ul className="mb-2 ml-3 border-l border-[var(--line-strong)] pl-2">
                      <li>
                        <Link href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">
                          <T k="nav.allIn" /> {l.label}
                        </Link>
                      </li>
                      {l.children.map((c) => (
                        <li key={c.href}>
                          <Link href={c.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm text-[var(--body)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
                            {c.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-3 text-[var(--body)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]"
                  >
                    {l.k ? <T k={l.k} /> : l.label}
                  </Link>
                )}
              </li>
            ))}
            </ul>

            <div className="mt-2 flex justify-end border-t border-[var(--line)] pt-3">
              <LanguageSwitcher />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
