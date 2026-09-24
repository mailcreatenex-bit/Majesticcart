'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { buildCardSvg, availableVariants, CARD_W, CARD_H, type CardData, type CardVariant } from '@/lib/idcard';
import { SITE } from '@/lib/seo';
import { MemberShell, type MemberSummary } from './MemberShell';
import { useT } from './LocaleProvider';

/**
 * The member's printable ID card.
 *
 * The card is drawn from what the account already knows — name, member ID, rank
 * and this month's volume — plus a photo the member uploads here. Which design
 * they can pick follows what they have achieved, so a rank card only exists for
 * a rank they hold and a target card only for a month in which they met the
 * target.
 *
 * The photo is cropped to a square in the browser and sent straight to object
 * storage with the same presigned-upload flow as a payment screenshot, so the
 * API never handles the bytes.
 */

const PHOTO_SIZE = 720;

export function IdCardView() {
  return (
    <MemberShell title="Your ID card">
      {(data, reload) => <IdCard data={data} reload={reload} />}
    </MemberShell>
  );
}

const centiToText = (centi: number) => (centi / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Centre-crops a picked photo to a square JPEG, which also caps its size. */
async function cropSquare(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  // Bias the crop upward: in a portrait, the face sits above the middle.
  const sx = (bitmap.width - side) / 2;
  const sy = Math.max(0, (bitmap.height - side) * 0.3);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process that photo.'))), 'image/jpeg', 0.9),
  );
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function IdCard({ data, reload }: { data: MemberSummary; reload: () => void }) {
  const params = useSearchParams();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [remotePhoto, setRemotePhoto] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [picked, setPicked] = useState<CardVariant | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The photo already on the account, fetched once so it can be embedded in the card.
  useEffect(() => {
    let cancelled = false;
    setRemotePhoto(null);
    if (data.member.photoUrl) toDataUrl(data.member.photoUrl).then((d) => { if (!cancelled) setRemotePhoto(d); });
    return () => { cancelled = true; };
  }, [data.member.photoUrl]);

  useEffect(() => {
    let cancelled = false;
    toDataUrl('/brand/majestic-cart-logo.webp').then((d) => { if (!cancelled) setLogo(d); });
    return () => { cancelled = true; };
  }, []);

  const photo = localPhoto ?? remotePhoto;

  const targetBvCenti = data.repurchase?.targetBv.centi ?? null;
  const variants = useMemo(
    () => availableVariants({
      rankIndex: data.rank.index,
      rankName: data.rank.name,
      monthBvCenti: data.volume.periodSelf.centi,
      targetBvCenti,
    }),
    [data.rank.index, data.rank.name, data.volume.periodSelf.centi, targetBvCenti],
  );
  // The highest-achievement design is the default; the member can switch to any they qualify for.
  const variant: CardVariant = variants.find((v) => v.variant === picked)?.variant ?? variants[variants.length - 1].variant;

  const cardData: CardData = useMemo(() => {
    const [y, m] = data.volume.period.split('-').map(Number);
    return {
      name: data.member.name,
      code: data.member.code,
      location: data.member.location,
      joinedYear: String(new Date(data.member.joinedAt).getFullYear()),
      photo,
      logo,
      tagline: SITE.tagline,
      rankName: data.rank.name,
      rankIndex: data.rank.index,
      monthLabel: new Date(y, (m || 1) - 1, 1).toLocaleString('en-IN', { month: 'long' }),
      monthBv: centiToText(data.volume.periodSelf.centi),
      targetBv: targetBvCenti ? centiToText(targetBvCenti) : null,
    };
  }, [data, photo, logo, targetBvCenti]);

  const svg = useMemo(() => buildCardSvg(variant, cardData), [variant, cardData]);

  const onPick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Choose a JPG, PNG or WebP photo.');
      return;
    }
    setUploading(true);
    try {
      const { blob, dataUrl } = await cropSquare(file);
      setLocalPhoto(dataUrl);

      const ticket = await api<{ uploadUrl: string; objectKey: string }>('/me/photo/upload-ticket', {
        method: 'POST',
        body: { contentType: 'image/jpeg', contentLength: blob.size },
      });
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!put.ok) throw new ApiError('The photo could not be uploaded. Try again.', put.status);
      await api('/me/photo', { method: 'PUT', body: { objectKey: ticket.objectKey } });
      reload();
    } catch (err) {
      setLocalPhoto(null);
      setError(err instanceof Error ? err.message : 'The photo could not be saved.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [reload]);

  const download = async () => {
    setSaving(true);
    setError(null);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('The card could not be rendered.'));
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      const scale = 1.5;
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W * scale;
      canvas.height = CARD_H * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot save the card as an image.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('The card could not be saved.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MajesticCart-ID-${data.member.code}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The card could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const welcome = params.get('welcome') === '1';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <div className="mx-auto max-w-md">
          <div id="id-card-print" className="overflow-hidden rounded-2xl shadow-xl shadow-rose-900/10 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>

      <aside className="space-y-5 print:hidden">
        {welcome && !data.member.photoUrl && (
          <p className="rounded-xl border border-[var(--notice-border)] bg-[var(--notice-bg)] p-4 text-sm text-[var(--body)]">
            Welcome to Majestic Cart! Add your photo below and your ID card is ready to print.
          </p>
        )}

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">{t('idcard.photo')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">A clear, front-facing photo with your face in the middle. It is cropped to a square.</p>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="id-photo" onChange={(e) => onPick(e.target.files?.[0])} />
          <label
            htmlFor="id-photo"
            className={`mt-4 inline-block cursor-pointer rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            {uploading ? '…' : photo ? t('idcard.change') : t('idcard.upload')}
          </label>
        </section>

        {variants.length > 1 && (
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg text-[var(--ink)]">{t('idcard.design')}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Unlocked by what you have achieved.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {variants.map((v) => {
                const on = v.variant === variant;
                return (
                  <button
                    key={v.variant}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(v.variant)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition ${on ? 'border-[var(--ink)] bg-[var(--ink)] font-semibold text-[var(--gold-pale)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'}`}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => window.print()} className="rounded-xl gold-foil px-6 py-3 font-semibold text-white shadow-lg shadow-amber-900/20">
            {t('idcard.print')}
          </button>
          <button type="button" onClick={download} disabled={saving} className="rounded-xl border border-[var(--line-strong)] px-6 py-3 font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:opacity-60">
            {saving ? '…' : t('idcard.download')}
          </button>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
      </aside>
    </div>
  );
}
