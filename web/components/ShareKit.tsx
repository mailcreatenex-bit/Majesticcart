'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildProductSvg, catalogueMessage, productMessage, videoEmbed, whatsappUrl, type KitProduct } from '@/lib/sharecards';
import { buildReferralLink } from '@/lib/referral';

/**
 * The rest of the share kit, under the messages and join image:
 *   • a one-tap WhatsApp catalogue (a handful of products with prices and the
 *     member's own links, plus their storefront), optionally for one department;
 *   • a branded image for any single product, with the photo, price, member ID
 *     and a QR code to that product;
 *   • short training videos, managed by the store in the admin console.
 *
 * Prices and the discount come from the shop; there is no earnings talk here.
 */

export interface TrainingVideo { title: string; url: string; blurb: string }
interface Dept { slug: string; name: string; parentId?: string | null; id?: string }

async function imageAsDataUrl(src: string): Promise<string | null> {
  try {
    // Through the site's own image route, so the photo is same-origin and the canvas stays untainted.
    const res = await fetch(`/_next/image?url=${encodeURIComponent(src)}&w=1080&q=85`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function ShareKit({ name, code, origin, logo, videos }: { name: string; code: string; origin: string; logo: string | null; videos: TrainingVideo[] }) {
  const [products, setProducts] = useState<KitProduct[] | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [dept, setDept] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalog/categories').then((r) => (r.ok ? r.json() : [])).then((all: Dept[]) => {
      if (!cancelled) setDepts(all.filter((c) => !c.parentId));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    const qs = new URLSearchParams({ sort: 'popular', limit: '50' });
    if (dept) qs.set('category', dept);
    fetch(`/api/catalog/products?${qs}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: KitProduct[] }) => {
      if (!cancelled) setProducts(d.items.filter((p) => p.price?.display));
    }).catch(() => { if (!cancelled) setProducts([]); });
    return () => { cancelled = true; };
  }, [dept]);

  const storefront = origin ? `${origin}/mc/${code}` : '';
  const linkFor = (slug: string) => {
    try { return buildReferralLink(`/product/${slug}`, code, origin); } catch { return `${origin}/product/${slug}`; }
  };

  const catalogue = useMemo(() => {
    if (!products || products.length === 0 || !storefront) return '';
    const label = depts.find((d) => d.slug === dept)?.name;
    const title = label ? `${name.split(' ')[0]}'s ${label} picks at Majestic Cart` : `My favourites at Majestic Cart`;
    return catalogueMessage(title, products.slice(0, 8).map((p) => ({ p, link: linkFor(p.slug) })), { name, storefront });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, storefront, dept, depts, name]);

  return (
    <div className="mt-12 space-y-12 border-t border-[var(--line)] pt-10">
      {/* ---------------------------------------------------- catalogue */}
      <section>
        <h2 className="font-serif text-xl text-[var(--ink)]">Send a catalogue on WhatsApp</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">One tap: our best sellers with prices and your own links.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={dept === ''} onClick={() => setDept('')}>All</Chip>
          {depts.map((d) => <Chip key={d.slug} active={dept === d.slug} onClick={() => setDept(d.slug)}>{d.name}</Chip>)}
        </div>
        {catalogue ? (
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-[var(--body)]">{catalogue}</p>
            <a
              href={whatsappUrl(catalogue)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex rounded-xl bg-[#1F9D55] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#188046]"
            >
              Send catalogue on WhatsApp
            </a>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">{products ? 'No products to share here yet.' : 'Loading products…'}</p>
        )}
      </section>

      {/* ------------------------------------------------ product images */}
      <section>
        <h2 className="font-serif text-xl text-[var(--ink)]">Product images</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Pick a product to get a branded image with your member ID and a QR code.</p>
        {products === null ? (
          <div className="mt-4 h-40 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
        ) : (
          <ProductImages products={products} name={name} code={code} logo={logo} linkFor={linkFor} />
        )}
      </section>

      {/* --------------------------------------------------- videos */}
      {videos.length > 0 && (
        <section>
          <h2 className="font-serif text-xl text-[var(--ink)]">Training videos</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Short videos on using the site and talking about the products.</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {videos.map((v) => <li key={v.url}><Video v={v} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm ${active ? 'border-[var(--ink)] bg-[var(--ink)] font-semibold text-[var(--gold-pale)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'}`}
    >
      {children}
    </button>
  );
}

function ProductImages({ products, name, code, logo, linkFor }: {
  products: KitProduct[]; name: string; code: string; logo: string | null; linkFor: (slug: string) => string;
}) {
  const [picked, setPicked] = useState<KitProduct | null>(null);
  const [svg, setSvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!picked) { setSvg(''); return; }
    let cancelled = false;
    setSvg('');
    (async () => {
      const link = linkFor(picked.slug);
      const [photo, QR] = await Promise.all([picked.imageUrl ? imageAsDataUrl(picked.imageUrl) : Promise.resolve(null), import('qrcode')]);
      const qrSvg = await QR.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#341316', light: '#ffffff' } });
      if (!cancelled) setSvg(buildProductSvg(picked, { name, code, link, photo, logo, qrSvg }));
    })().catch(() => { if (!cancelled) setNotice('The image could not be created.'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, name, code, logo]);

  const toPng = async (): Promise<Blob> => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('render'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, 1080, 1080);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('png');
    return blob;
  };

  const message = picked ? productMessage(picked, { name, link: linkFor(picked.slug) }) : '';

  const download = async () => {
    setBusy(true); setNotice(null);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await toPng());
      a.download = `MajesticCart-${picked?.slug ?? 'product'}-${code}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { setNotice('The image could not be created. Try again.'); }
    finally { setBusy(false); }
  };

  const share = async () => {
    setBusy(true); setNotice(null);
    try {
      const file = new File([await toPng()], `MajesticCart-${code}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: message });
      else setNotice('Sharing images directly is not supported here. Download it and attach it to your message.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('Could not share the image. Download it instead.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ul className="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        {products.map((p) => (
          <li key={p.slug}>
            <button
              type="button"
              onClick={() => setPicked(p)}
              aria-pressed={picked?.slug === p.slug}
              className={`block w-full overflow-hidden rounded-xl border text-left ${picked?.slug === p.slug ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30' : 'border-[var(--line)]'}`}
            >
              <span className="block aspect-square bg-[var(--page)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.imageUrl && <img src={`/_next/image?url=${encodeURIComponent(p.imageUrl)}&w=256&q=60`} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </span>
              <span className="block truncate px-2 py-1.5 text-[11px] text-[var(--body)]">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <div>
        {picked ? (
          <>
            {svg ? (
              <div className="overflow-hidden rounded-2xl shadow-xl shadow-rose-900/10 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="aspect-square animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={download} disabled={busy || !svg} className="rounded-xl gold-foil px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50">
                {busy ? 'Preparing…' : 'Download image'}
              </button>
              <button type="button" onClick={share} disabled={busy || !svg} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:opacity-50">
                Share…
              </button>
              <a href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#1F9D55] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#188046]">
                WhatsApp text
              </a>
              <button
                type="button"
                onClick={async () => { try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setNotice('Copy is not available in this browser.'); } }}
                className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
            </div>
            {notice && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{notice}</p>}
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--muted)]">Choose a product to see its image.</p>
        )}
      </div>
    </div>
  );
}

/**
 * A video that costs nothing until it is played: a thumbnail (YouTube) or a
 * plain button, and the player is only created on tap. Matters on a phone on 4G.
 */
function Video({ v }: { v: TrainingVideo }) {
  const [playing, setPlaying] = useState(false);
  const e = videoEmbed(v.url);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
      <div className="relative aspect-video bg-[var(--ink)]">
        {e.kind === 'file' ? (
          <video controls preload="none" playsInline className="h-full w-full" src={e.url} />
        ) : e.kind === 'link' ? (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="flex h-full items-center justify-center text-sm font-semibold text-[var(--gold-pale)] underline">Open the video</a>
        ) : playing ? (
          <iframe
            className="h-full w-full"
            src={e.kind === 'youtube' ? `https://www.youtube-nocookie.com/embed/${e.id}?autoplay=1&rel=0` : `https://player.vimeo.com/video/${e.id}?autoplay=1`}
            title={v.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${v.title}`} className="group absolute inset-0">
            {e.kind === 'youtube' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-[var(--ink)]">▶</span>
            </span>
          </button>
        )}
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold text-[var(--ink)]">{v.title}</p>
        {v.blurb && <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{v.blurb}</p>}
      </div>
    </div>
  );
}
