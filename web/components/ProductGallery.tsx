'use client';

import { useState } from 'react';
import Image from 'next/image';

/**
 * The product page's main image plus its gallery.
 *
 * A client component only for the thumbnail click state — the images
 * themselves are still server-rendered `next/image` elements, so the LCP
 * image loads the same way it always did (`priority`, no client fetch) and
 * this adds no network round trip of its own.
 */
export function ProductGallery({
  images, name, discountBadge,
}: {
  images: string[];
  name: string;
  discountBadge: number | null;
}) {
  const [active, setActive] = useState(0);
  const current = images[active];

  return (
    <div>
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[var(--surface)]">
        {current ? (
          // priority: this is the LCP element on the page, and Core Web
          // Vitals is a ranking input.
          <Image
            key={current}
            src={current}
            alt={name}
            fill
            priority={active === 0}
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center font-serif text-xl text-[#C9B8C2]">
            {name}
          </div>
        )}
        {discountBadge !== null && (
          <span className="absolute left-4 top-4 rounded-full bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-[var(--gold-pale)]">
            {discountBadge}% off
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === active}
              className={`relative aspect-square w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                i === active ? 'border-[var(--accent)]' : 'border-transparent'
              }`}
            >
              <Image src={src} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
