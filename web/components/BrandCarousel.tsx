import Image from 'next/image';

/**
 * The brands this store sells, as a slow marquee under the hero.
 *
 * Majestic Cart resells other companies' products and makes none of its own, so
 * this strip is the honest answer to "what do you sell?" — the names are the
 * brands' own marks and are used only to say the products are stocked.
 *
 * The list is rendered twice and the track slides by exactly half its width, so
 * the loop has no visible seam. The second copy is hidden from assistive tech
 * so a screen reader hears each brand once. Motion stops on hover, and under
 * `prefers-reduced-motion` the strip becomes a static, scrollable row.
 */
const BRANDS = [
  { name: 'Lakmé', src: '/brands/lakme.png', width: 300, height: 128 },
  { name: 'Lotus Herbals', src: '/brands/lotus-herbals.png', width: 259, height: 79 },
  { name: 'Pond’s', src: '/brands/ponds.svg', width: 265, height: 60 },
  { name: 'Hindustan Unilever', src: '/brands/hindustan-unilever.svg', width: 1000, height: 333 },
  { name: 'Dot & Key', src: '/brands/dot-and-key.svg', width: 278, height: 65 },
  { name: 'Himalaya Herbals', src: '/brands/himalaya.svg', width: 400, height: 142 },
] as const;

export function BrandCarousel() {
  return (
    <section aria-label="Brands we carry" className="border-b border-[var(--line)] bg-[var(--surface)] py-8">
      <p className="text-center text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Brands we carry</p>
      <div className="brand-marquee mt-6 overflow-hidden">
        <ul className="brand-track flex w-max items-center">
          {[0, 1].map((copy) =>
            BRANDS.map((b) => (
              <li
                key={`${copy}-${b.name}`}
                className="flex shrink-0 items-center pr-14 sm:pr-20"
                aria-hidden={copy === 1 ? true : undefined}
              >
                <Image
                  src={b.src}
                  alt={copy === 1 ? '' : b.name}
                  width={b.width}
                  height={b.height}
                  unoptimized
                  loading="eager"
                  className="brand-logo h-9 w-auto sm:h-11"
                />
              </li>
            )),
          )}
        </ul>
      </div>
    </section>
  );
}
