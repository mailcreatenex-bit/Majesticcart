'use client';

import { useRef, useState } from 'react';
import { uploadAdminImage, type UploadPurpose } from '@/lib/adminUpload';

/** A single image slot: preview, upload, replace, remove. */
export function ImageUploadField({
  label, value, onChange, purpose, hint,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  purpose: UploadPurpose;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadAdminImage(file, purpose));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-800">{label}</label>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-300 bg-neutral-50">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-neutral-400">No image</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => pick(e.target.files?.[0])}
            disabled={busy}
            className="text-xs text-neutral-600 file:mr-2 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-neutral-700"
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="self-start text-xs font-semibold text-red-700 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
        {busy && <span className="text-xs text-neutral-500">Uploading…</span>}
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/** A reorderable set of images — the product gallery. */
export function ImageGalleryField({
  label, values, onChange, purpose, max = 12,
}: {
  label: string;
  values: string[];
  onChange: (urls: string[]) => void;
  purpose: UploadPurpose;
  max?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = max - values.length;
    if (room <= 0) { setError(`Up to ${max} images.`); return; }
    setBusy(true);
    setError(null);
    try {
      const picked = Array.from(files).slice(0, room);
      const uploaded = await Promise.all(picked.map((f) => uploadAdminImage(f, purpose)));
      onChange([...values, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.length) return;
    const next = [...values];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-800">{label}</label>
      <p className="mt-0.5 text-xs text-neutral-500">Shown on the product page after the thumbnail. First image left, drag order with the arrows.</p>

      {values.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {values.map((url, i) => (
            <div key={url + i} className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-300 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-xs text-white disabled:opacity-30">←</button>
                <button type="button" onClick={() => remove(i)} className="text-xs text-white">✕</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === values.length - 1} className="text-xs text-white disabled:opacity-30">→</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          disabled={busy || values.length >= max}
          className="text-xs text-neutral-600 file:mr-2 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-neutral-700 disabled:opacity-50"
        />
        {busy && <span className="text-xs text-neutral-500">Uploading…</span>}
        <span className="text-xs text-neutral-400">{values.length}/{max}</span>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
