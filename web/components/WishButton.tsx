'use client';

import { useWishlist } from './WishlistProvider';

/**
 * The heart. On a card it floats over the photo (outside the card's link, so a
 * tap saves rather than navigates); on the product page it sits beside the
 * title. Filled when saved.
 */
export function WishButton({ slug, name, className = '' }: { slug: string; name: string; className?: string }) {
  const { has, toggle } = useWishlist();
  const saved = has(slug);
  const label = saved ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`;
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={saved ? 'Saved' : 'Save for later'}
      onClick={() => void toggle(slug)}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105 ${saved ? 'text-[#D6336C]' : 'text-[var(--ink)]'} ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    </button>
  );
}

/** For an out-of-stock product: save it and be told when it is back. */
export function NotifyMe({ slug }: { slug: string }) {
  const { has, alerting, toggle } = useWishlist();
  const on = has(slug) && alerting(slug);
  return (
    <button
      type="button"
      onClick={() => void toggle(slug)}
      aria-pressed={on}
      className={`mt-3 w-full rounded-xl px-5 py-3 text-sm font-semibold transition ${
        on ? 'border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)]' : 'bg-[var(--accent)] text-white hover:opacity-90'
      }`}
    >
      {on ? '✓ We will tell you when it is back — tap to cancel' : 'Notify me when it is back'}
    </button>
  );
}
