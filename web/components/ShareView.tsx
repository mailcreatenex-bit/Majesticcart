'use client';

import { useEffect, useMemo, useState } from 'react';
import { MemberShell, type MemberSummary } from './MemberShell';
import { buildShareSvg, shareMessages, whatsappUrl, SHARE_SIZE, type ShareKind } from '@/lib/sharecards';
import { buildReferralLink } from '@/lib/referral';

/**
 * Ready-made things a member can send: WhatsApp messages carrying their link, and
 * share images (a square post and a 9:16 story) with their member ID and a QR code.
 *
 * The link is the member's storefront page (/mc/<code>), which carries their name
 * and remembers the sponsor for whoever signs up from it.
 */

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
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

export function ShareView() {
  return (
    <MemberShell title="Share">
      {(data) => <Share data={data} />}
    </MemberShell>
  );
}

function Share({ data }: { data: MemberSummary }) {
  const [origin, setOrigin] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [kind, setKind] = useState<ShareKind>('post');
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => { toDataUrl('/brand/majestic-cart-logo.webp').then(setLogo); }, []);

  const storefront = origin ? `${origin}/mc/${data.member.code}` : '';
  // The plain referral link is the fallback if the storefront path could not be formed.
  const link = useMemo(() => {
    if (!origin) return '';
    if (storefront) return storefront;
    try { return buildReferralLink('/', data.member.code, origin); } catch { return origin; }
  }, [origin, storefront, data.member.code]);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    import('qrcode').then(async (QR) => {
      const svg = await QR.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#341316', light: '#ffffff' } });
      if (!cancelled) setQrSvg(svg);
    }).catch(() => { if (!cancelled) setQrSvg(null); });
    return () => { cancelled = true; };
  }, [link]);

  const messages = useMemo(() => (link ? shareMessages({ name: data.member.name, code: data.member.code, link }) : []), [link, data.member.name, data.member.code]);
  const svg = useMemo(
    () => (link ? buildShareSvg(kind, { name: data.member.name, code: data.member.code, link, logo, qrSvg }) : ''),
    [link, kind, data.member.name, data.member.code, logo, qrSvg],
  );

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch { setNotice('Copy is not available in this browser.'); }
  };

  const toPng = async (): Promise<Blob> => {
    const { w, h } = SHARE_SIZE[kind];
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('render'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('png');
    return blob;
  };

  const download = async () => {
    setBusy(true); setNotice(null);
    try {
      const blob = await toPng();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MajesticCart-Share-${data.member.code}-${kind}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { setNotice('The image could not be created. Try again.'); }
    finally { setBusy(false); }
  };

  const shareImage = async () => {
    setBusy(true); setNotice(null);
    try {
      const blob = await toPng();
      const file = new File([blob], `MajesticCart-${data.member.code}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: messages[0]?.text });
      } else {
        setNotice('Sharing images directly is not supported here. Download it and attach it to your message.');
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('Could not share the image. Download it instead.');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <section>
          <h2 className="font-serif text-xl text-[var(--ink)]">WhatsApp messages</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Ready to send. Each one carries your storefront link.</p>
          <div className="mt-4 space-y-4">
            {messages.map((m) => (
              <div key={m.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{m.title}</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--body)]">{m.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={whatsappUrl(m.text)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl bg-[#1F9D55] px-4 py-2 text-sm font-semibold text-white hover:bg-[#188046]"
                  >
                    Send on WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => copy(m.id, m.text)}
                    className="rounded-xl border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
                  >
                    {copied === m.id ? 'Copied' : 'Copy message'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs leading-relaxed text-[var(--muted)]">
          These messages talk about the products and free registration only. Please do not add claims about
          earnings or promise anyone income - it is against the direct selling rules and against your agreement with us.
        </p>
      </div>

      <aside>
        <h2 className="font-serif text-xl text-[var(--ink)]">Share image</h2>
        <div className="mt-3 flex gap-2">
          {(Object.keys(SHARE_SIZE) as ShareKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full border px-4 py-1.5 text-sm ${kind === k ? 'border-[var(--ink)] bg-[var(--ink)] font-semibold text-[var(--gold-pale)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'}`}
            >
              {SHARE_SIZE[k].label}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl shadow-xl shadow-rose-900/10 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={download} disabled={busy || !svg} className="rounded-xl gold-foil px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50">
            {busy ? 'Preparing…' : 'Download image'}
          </button>
          <button type="button" onClick={shareImage} disabled={busy || !svg} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:opacity-50">
            Share…
          </button>
        </div>
        {notice && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{notice}</p>}
      </aside>
    </div>
  );
}
