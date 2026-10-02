'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from './CartProvider';

/**
 * The phone tab bar pinned to the bottom of the screen, in the pattern of
 * shopping apps like Purplle's: a handful of large icon-over-label targets
 * within thumb reach. Only destinations this site really has — home, the
 * full catalogue, wallet, bag and account — rather than tabs for pages we
 * do not offer.
 *
 * Hidden from xl up, where the desktop header carries all of this; on
 * checkout, where a second row of navigation under the pay button invites a
 * mis-tap away from a half-finished order; and on product pages, where the
 * pinned price-and-buy bar (AddToBag) takes the same spot.
 */
const TABS = [
  { href: '/', label: 'Home', icon: HomeIcon, match: (p: string) => p === '/' },
  { href: '/shop', label: 'Shop', icon: GridIcon, match: (p: string) => p === '/shop' || p.startsWith('/category') || p.startsWith('/brand') || p.startsWith('/product') },
  { href: '/wallet', label: 'Wallet', icon: WalletIcon, match: (p: string) => p.startsWith('/wallet') || p.startsWith('/recharge') },
  { href: '/cart', label: 'Bag', icon: BagIcon, match: (p: string) => p.startsWith('/cart') },
  { href: '/account', label: 'Account', icon: UserIcon, match: (p: string) => p.startsWith('/account') || p.startsWith('/login') || p.startsWith('/signup') },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname() ?? '/';
  const { totals, ready } = useCart();
  if (pathname.startsWith('/checkout') || pathname.startsWith('/product')) return null;

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_-12px_rgba(0,0,0,0.25)] xl:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
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
                  {t.href === '/cart' && ready && totals.itemCount > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                      {totals.itemCount}
                    </span>
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
function WalletIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5V9H4.5A1.5 1.5 0 0 1 3 7.5zM3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H4.5" />
      <circle cx="16.5" cy="14.5" r="1.2" fill={filled ? 'var(--surface)' : 'currentColor'} stroke="none" />
    </svg>
  );
}
function BagIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" />
    </svg>
  );
}
function UserIcon({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? 'currentColor' : 'none'}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0z" />
    </svg>
  );
}
