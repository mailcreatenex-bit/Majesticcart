'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { reportError } from '@/lib/report-error';

/** A page that crashed: say so plainly, offer a retry and a way out, and tell the server so it gets fixed. */
export default function ShopError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportError(error.message || 'Page error', error.stack); }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="font-serif text-3xl text-[var(--ink)]">Something went wrong</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        This page did not load properly. It is not your fault, and the team has been told. Try again, or go back to the shop.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={() => retry()} className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white hover:opacity-90">
          Try again
        </button>
        <Link href="/" className="rounded-xl border border-[var(--line-strong)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">
          Home
        </Link>
      </div>
    </div>
  );
}
