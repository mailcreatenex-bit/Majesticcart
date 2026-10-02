'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';

/**
 * Suggestions under a search box while the shopper is still typing.
 *
 * The search itself forgives spelling slips and understands Hindi, Bengali and
 * Hinglish (see backend/src/catalog/search.ts); this is only the dropdown. A
 * request goes out 180ms after the last keystroke and a slower reply to an
 * older word is thrown away, so the list never shows results for something
 * the shopper has already typed past. Nothing is fetched below two letters.
 */
interface Suggestion {
  total: number;
  didYouMean: string | null;
  categories: { name: string; slug: string }[];
  brands: { name: string; slug: string }[];
  products: { name: string; slug: string; imageUrl: string | null; price: { display: string }; brand: string | null; category: string | null; inStock: boolean }[];
}

export function useSuggestions(query: string): Suggestion | null {
  const [data, setData] = useState<Suggestion | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) { setData(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/catalog/suggest?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Suggestion>) : null))
        .then((d) => { if (d) setData(d); })
        .catch(() => undefined);
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  return q.length < 2 ? null : data;
}

export function SuggestPanel({
  query, data, onPick, className = '',
}: { query: string; data: Suggestion | null; onPick: () => void; className?: string }) {
  const q = query.trim();
  if (q.length < 2 || !data) return null;
  const all = `/search?q=${encodeURIComponent(q)}`;

  return (
    <div
      role="listbox"
      aria-label="Search suggestions"
      className={`absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-xl ${className}`}
    >
      {data.didYouMean && (
        <Link href={`/search?q=${encodeURIComponent(data.didYouMean)}`} onClick={onPick} className="block rounded-xl px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-tint)]">
          Did you mean <strong className="text-[var(--accent)]">{data.didYouMean}</strong>?
        </Link>
      )}

      {data.products.length === 0 ? (
        <p className="px-3 py-3 text-sm text-[var(--muted)]">Nothing found for &ldquo;{q}&rdquo;. Try fewer or different words.</p>
      ) : (
        <ul>
          {data.products.map((p) => (
            <li key={p.slug}>
              <Link href={`/product/${p.slug}`} onClick={onPick} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--surface-tint)]">
                <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--page)]">
                  {p.imageUrl && <Image src={p.imageUrl} alt="" fill sizes="44px" className="object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--ink)]">{p.name}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{[p.brand, p.category].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold text-[var(--ink)]">
                  {p.price.display}
                  {!p.inStock && <span className="block text-[10px] font-normal text-[var(--faint)]">Out of stock</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(data.categories.length > 0 || data.brands.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-2 border-t border-[var(--line)] px-2 pb-1 pt-3">
          {data.categories.map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}`} onClick={onPick} className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--body)] hover:bg-[var(--surface-tint)]">{c.name}</Link>
          ))}
          {data.brands.map((b) => (
            <Link key={b.slug} href={`/brand/${b.slug}`} onClick={onPick} className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--body)] hover:bg-[var(--surface-tint)]">{b.name}</Link>
          ))}
        </div>
      )}

      <Link href={all} onClick={onPick} className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]">
        See all {data.total > 0 ? `${data.total} ` : ''}results for &ldquo;{q}&rdquo; →
      </Link>
    </div>
  );
}
