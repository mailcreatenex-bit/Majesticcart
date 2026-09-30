'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

/**
 * Full-bleed banner carousel for the homepage hero — the Purplle-style
 * edge-to-edge image strip with dots and arrows, as opposed to the older
 * pure-CSS HeroSlider that sat beside the heading text. This one owns the
 * whole width of the viewport and the heading is overlaid on top of it by
 * the caller, not baked into each slide, so there is still exactly one
 * rotating set of images behind one fixed, crawlable heading.
 */
export function HeroCarousel({ images, fallback }: { images: string[]; fallback: string }) {
  const slides = images.length > 0 ? images : [fallback];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [slides.length]);

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden">
      {slides.map((src, i) => (
        <div key={src} className="absolute inset-0 transition-opacity duration-700" style={{ opacity: i === index ? 1 : 0 }}>
          <Image src={src} alt="" fill priority={i === 0} sizes="100vw" className="object-cover" />
        </div>
      ))}

      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-[var(--ink)] shadow-md transition hover:bg-white sm:left-6"
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 text-[var(--ink)] shadow-md transition hover:bg-white sm:right-6"
          >
            <ChevronIcon direction="right" />
          </button>

          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
            {slides.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${i === index ? 'w-6 bg-white' : 'w-2 bg-white/60'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}
