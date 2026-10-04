'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWishlist } from './WishlistProvider';

/**
 * The phone tab bar pinned to the bottom of the screen, in the pattern of
 * shopping apps like Purplle's: a few large icon-over-label targets within
 * thumb reach. Wallet, bag and account are already in the header band, so they
 * are not repeated here; the bar carries what the header does not: home, the
 * catalogue, the wishlist and the AI shade finder.
 *
 * Hidden from xl up, where the desktop header carries all of this; on
 * checkout, where a second row of navigation under the pay button invites a
 * mis-tap away from a half-finished order; and on product pages, where the
 * pinned price-and-buy bar (AddToBag) takes the same spot.
 */
const TABS = [
  { href: '/', label: 'Home', icon: HomeIcon, match: (p: string) => p === '/' },
  { href: '/shop', label: 'Shop', icon: GridIcon, match: (p: string) => p === '/shop' || p.startsWith('/category') || p.startsWith('/brand') || p.startsWith('/product') },
  { href: '/wishlist', label: 'Wishlist', icon: HeartIcon, match: (p: string) => p.startsWith('/wishlist') },
  { href: '/shade-finder', label: 'Shade Finder', icon: SparkleIcon, match: (p: string) => p.startsWith('/shade-finder') },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname() ?? '/';
  const { count } = useWishlist();
  if (pathname.startsWith('/checkout') || pathname.startsWith('/product')) return null;

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_-12px_rgba(0,0,0,0.25)] xl:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {TABS.map((t) => {
          const active = t.match(pathname);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-semibold transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}
              >
                <span className="relative">
                  <Icon filled={active} />
                  {t.href === '/wishlist' && count > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">{count}</span>
                  )}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type IconProps = { filled?: boolean };
const base = { width: 24, height: 24, viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

function HomeIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function GridIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function HeartIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
function SparkleIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M11 3.5 13 9l5.5 2-5.5 2-2 5.5L9 13l-5.5-2L9 9z" />
      <path d="M18.5 3v4M16.5 5h4M18.5 16.5v4M16.5 18.5h4" />
    </svg>
  );
}
