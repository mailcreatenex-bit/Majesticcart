'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * A selfie in, two or three real products out — see
 * `backend/src/shade-finder/shade-finder.service.ts` for what happens to the
 * photo (nothing is stored; it goes to Gemini and is discarded).
 *
 * Resized client-side before it ever leaves the phone: a modern phone photo
 * is routinely 3-5MB, and none of that extra resolution helps a model that's
 * just reading skin tone. Smaller upload, faster result, less of the
 * member's data plan spent on a feature that's trying to help them.
 */

const MAX_DIMENSION = 640;

interface ShadeMatch { name: string; slug: string; reason: string }
interface ShadeResult { summary: string; matches: ShadeMatch[] }

export function ShadeFinderView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ base64: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShadeResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const { base64, mimeType, dataUrl } = await resizeToBase64(file);
      setPayload({ base64, mimeType });
      setPreview(dataUrl);
    } catch {
      setError('Could not read that photo. Try a different one.');
    }
  };

  const analyze = async () => {
    if (!payload || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<ShadeResult>('/me/shade-finder', { method: 'POST', body: payload });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not analyse that photo right now.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setPayload(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">AI shade finder</p>
        <h1 className="mt-2 font-serif text-2xl text-[var(--ink)]">Find your shade</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          A clear photo in good light — front-facing, no filter — works best. Your photo is
          analysed and then discarded; it is never saved.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
        {!preview ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--line-strong)] py-12 text-center">
            <CameraIcon />
            <span className="text-sm font-medium text-[var(--ink)]">Take or upload a selfie</span>
            <span className="text-xs text-[var(--muted)]">JPEG, PNG or WEBP</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="sr-only"
            />
          </label>
        ) : (
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a client-resized data URL, not an optimisable remote asset */}
            <img src={preview} alt="" className="mx-auto h-48 w-48 rounded-full border border-[var(--line-strong)] object-cover" />
            {!result && (
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={analyze}
                  disabled={busy}
                  className="rounded-xl gold-foil px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[var(--faint)]"
                >
                  {busy ? 'Analysing…' : 'Find my shade'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy}
                  className="rounded-xl border border-[var(--line-strong)] px-4 py-3 text-sm font-semibold text-[var(--body)] hover:bg-[var(--surface-tint)]"
                >
                  Choose another
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>
        )}

        {result && (
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <p className="text-sm leading-relaxed text-[var(--body)]">{result.summary}</p>

            {result.matches.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {result.matches.map((m) => (
                  <li key={m.slug}>
                    <Link
                      href={`/product/${m.slug}`}
                      className="block rounded-xl border border-[var(--line)] p-4 transition hover:border-[var(--gold-mid)]/50 hover:bg-[var(--surface-tint)]"
                    >
                      <p className="font-serif text-base text-[var(--ink)]">{m.name}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{m.reason}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Nothing in the current makeup range matched well — worth browsing{' '}
                <Link href="/category/makeup" className="font-semibold text-[var(--accent)] hover:underline">the full range</Link> yourself.
              </p>
            )}

            <button type="button" onClick={reset} className="mt-5 text-xs font-semibold text-[var(--accent)] hover:underline">
              Try another photo →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Downscales to at most MAX_DIMENSION on the long edge and returns JPEG base64 (no data-URL prefix). */
function resizeToBase64(file: File): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const c2d = canvas.getContext('2d');
        if (!c2d) return reject(new Error('no canvas context'));
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg', dataUrl });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold-mid)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.3" />
    </svg>
  );
}
