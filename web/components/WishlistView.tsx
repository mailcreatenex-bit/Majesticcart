'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CatalogProduct } from '@/lib/catalog';
import { MemberShell, EmptyState } from './MemberShell';
import { ProductGrid } from './ProductCard';

/** The products a member has saved, as the same cards the shop uses. */
export function WishlistView() {
  return (
    <MemberShell title="Wishlist">
      {() => <Saved />}
    </MemberShell>
  );
}

function Saved() {
  const [items, setItems] = useState<(CatalogProduct & { alertWhenBack?: boolean })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: (CatalogProduct & { alertWhenBack?: boolean })[] }>('/me/wishlist')
      .then((r) => { if (!cancelled) setItems(r.items); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your wishlist.'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="mt-6 text-sm text-[#C0392B]">{error}</p>;
  if (!items) return <div className="mt-6 h-64 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />;

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing saved yet"
        body="Tap the heart on any product to keep it here. Save something that is out of stock and we will message you when it is back."
        action={
          <Link href="/shop" className="inline-block rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white">
            Browse the shop
          </Link>
        }
      />
    );
  }

  const waiting = items.filter((i) => i.alertWhenBack).length;
  return (
    <div className="mt-6">
      {waiting > 0 && (
        <p className="mb-4 rounded-xl bg-[var(--notice-bg)] px-4 py-3 text-sm text-[var(--body)]">
          {waiting === 1 ? '1 saved item is' : `${waiting} saved items are`} out of stock. We will message you when {waiting === 1 ? 'it is' : 'they are'} back.
        </p>
      )}
      <ProductGrid products={items} />
    </div>
  );
}
