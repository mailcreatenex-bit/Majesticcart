import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { RetryButton } from '@/components/RetryButton';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('You are offline'),
  description: 'This page needs a connection.',
  pathname: '/offline',
});

/**
 * Offline fallback, served by the service worker when a navigation fails.
 *
 * Deliberately says nothing about wallet balance or orders. Those are never
 * cached, so any number shown here would be invented — and on a platform
 * holding member money, an invented balance is worse than no page at all.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
        <svg className="h-8 w-8 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M1 1l22 22" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <path d="M12 20h.01" />
        </svg>
      </div>

      <h1 className="mt-6 font-serif text-2xl text-[var(--ink)]">You are offline</h1>
      <p className="mt-2 text-[var(--body)]">
        This page needs a connection. Your wallet and orders are always shown live, never from a
        cached copy, so they are unavailable until you reconnect.
      </p>

      <div className="mt-6 flex gap-3">
        <RetryButton />
        <Link href="/" className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)]">
          Go home
        </Link>
      </div>
    </div>
  );
}
