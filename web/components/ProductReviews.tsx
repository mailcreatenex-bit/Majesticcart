'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

/**
 * Reviews on a product page.
 *
 * Loaded in the browser so the product page itself stays static and fast. Anyone
 * can read them; writing needs a signed-in member who has had the product
 * delivered (the API enforces it - this only decides what to offer). Reviews show
 * a first name and a "verified purchase" mark.
 */

interface Review { id: string; rating: number; title: string | null; body: string; at: string; author: string; verified: boolean }
interface Summary { count: number; average: number; distribution: { stars: number; count: number }[] }
interface Mine { eligible: boolean; review: { rating: number; title: string | null; body: string; status: string } | null }

const Stars = ({ n, size = 16 }: { n: number; size?: number }) => (
  <span aria-label={`${n} out of 5 stars`} role="img" style={{ fontSize: size }} className="tracking-tight text-[var(--gold)]">
    {'★'.repeat(Math.round(n))}<span className="text-[var(--line-strong)]">{'★'.repeat(5 - Math.round(n))}</span>
  </span>
);

export function ProductReviews({ slug }: { slug: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ summary: Summary; reviews: Review[]; nextCursor: string | null }>(`/catalog/product/${encodeURIComponent(slug)}/reviews`);
      setSummary(r.summary); setReviews(r.reviews); setCursor(r.nextCursor);
    } catch { setSummary({ count: 0, average: 0, distribution: [] }); }
    finally { setLoading(false); }
  }, [slug]);

  const loadMine = useCallback(async () => {
    try { setMine(await api<Mine>(`/reviews/${encodeURIComponent(slug)}/mine`)); } catch { setMine(null); }
  }, [slug]);

  useEffect(() => { void load(); void loadMine(); }, [load, loadMine]);

  const more = async () => {
    if (!cursor) return;
    const r = await api<{ reviews: Review[]; nextCursor: string | null }>(`/catalog/product/${encodeURIComponent(slug)}/reviews?cursor=${cursor}`);
    setReviews((x) => [...x, ...r.reviews]); setCursor(r.nextCursor);
  };

  return (
    <section id="reviews" aria-labelledby="reviews-h" className="mt-16 border-t border-[var(--line)] pt-10">
      <h2 id="reviews-h" className="font-serif text-2xl text-[var(--ink)]">Reviews</h2>

      {loading ? (
        <div className="mt-4 h-16 animate-pulse rounded-xl bg-[var(--surface-tint)]" />
      ) : summary && summary.count > 0 ? (
        <div className="mt-4 grid gap-6 sm:grid-cols-[14rem_1fr]">
          <div>
            <p className="font-serif text-5xl text-[var(--ink)]">{summary.average.toFixed(1)}</p>
            <Stars n={summary.average} size={20} />
            <p className="mt-1 text-xs text-[var(--muted)]">{summary.count} review{summary.count === 1 ? '' : 's'}</p>
            <ul className="mt-3 space-y-1">
              {summary.distribution.map((d) => (
                <li key={d.stars} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <span className="w-3">{d.stars}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-tint)]">
                    <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${summary.count ? (d.count / summary.count) * 100 : 0}%` }} />
                  </div>
                  <span className="w-5 text-right">{d.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <ul className="space-y-5">
            {reviews.map((r) => (
              <li key={r.id} className="border-b border-[var(--line)] pb-5 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars n={r.rating} />
                  {r.title && <span className="font-semibold text-[var(--ink)]">{r.title}</span>}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--body)]">{r.body}</p>
                <p className="mt-1.5 text-xs text-[var(--faint)]">
                  {r.author} · {new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {r.verified && <span className="ml-2 rounded-full bg-[#E8F5EC] px-2 py-0.5 text-[10px] font-semibold text-[#1F7A3D]">Verified purchase</span>}
                </p>
              </li>
            ))}
            {cursor && <li><button type="button" onClick={more} className="text-sm font-semibold text-[var(--accent)] hover:underline">Show more reviews</button></li>}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">No reviews yet.</p>
      )}

      <div className="mt-8">
        {mine === null ? (
          <p className="text-sm text-[var(--muted)]">
            <Link href={`/login?next=/product/${slug}`} className="font-semibold text-[var(--accent)] hover:underline">Log in</Link> to review a product you have received.
          </p>
        ) : mine.eligible ? (
          formOpen ? (
            <ReviewForm slug={slug} initial={mine.review} onDone={async () => { setFormOpen(false); await Promise.all([load(), loadMine()]); }} onCancel={() => setFormOpen(false)} />
          ) : (
            <button type="button" onClick={() => setFormOpen(true)} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">
              {mine.review ? 'Edit your review' : 'Write a review'}
            </button>
          )
        ) : (
          <p className="text-xs text-[var(--muted)]">You can review this product once an order with it has been delivered to you.</p>
        )}
        {mine?.review?.status === 'HIDDEN' && <p className="mt-2 text-xs text-[#9A6A08]">Your review is not showing right now - it is being looked at by our team.</p>}
      </div>
    </section>
  );
}

function ReviewForm({ slug, initial, onDone, onCancel }: { slug: string; initial: Mine['review']; onDone: () => Promise<void>; onCancel: () => void }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating < 1) { setError('Choose a star rating.'); return; }
    setBusy(true); setError(null);
    try {
      await api(`/reviews/${encodeURIComponent(slug)}`, { method: 'PUT', body: { rating, title: title || undefined, body } });
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your review.');
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-sm font-semibold text-[var(--ink)]">Your rating</p>
      <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)} className={`text-3xl leading-none ${n <= rating ? 'text-[var(--gold)]' : 'text-[var(--line-strong)]'}`}>★</button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Headline (optional)" className="mt-4 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4} placeholder="What did you like, or not? How did you use it?" className="mt-3 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none" />
      {error && <p role="alert" className="mt-2 text-sm text-[#C0392B]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="rounded-xl gold-foil px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Post review'}</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">Cancel</button>
      </div>
    </div>
  );
}
