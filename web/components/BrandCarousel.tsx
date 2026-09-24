import Link from 'next/link';
import { listBrands } from '@/lib/catalog';

/**
 * The brands this store sells, as a slow marquee under the hero.
 *
 * Majestic Cart resells other companies' products and makes none of its own, so
 * this strip is the honest answer to "what do you sell?" - the names are the
 * brands' own marks and are used only to say the products are stocked. It reads
 * the catalogue's brands (those with a logo), so adding a brand or changing its
 * logo in the admin changes this strip; each logo links to that brand's page.
 *
 * The list is rendered twice and the track slides by exactly half its width, so
 * the loop has no visible seam. The second copy is hidden from assistive tech and
 * taken out of the tab order so a screen reader or keyboard meets each brand once.
 * Motion stops on hover, and under `prefers-reduced-motion` the strip becomes a
 * static, scrollable row.
 */
export async function BrandCarousel() {
  const brands = (await listBrands()).filter((b) => b.logoUrl);
  if (brands.length === 0) return null;

  return (
    <section aria-label="Brands we carry" className="brand-band border-y border-[#e9dcc5] py-7 sm:py-9">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-4 px-4">
        <span aria-hidden="true" className="h-px w-10 bg-gradient-to-r from-transparent to-[#c9a75a] sm:w-20" />
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8a6a2b] sm:text-xs">Brands we carry</p>
        <span aria-hidden="true" className="h-px w-10 bg-gradient-to-l from-transparent to-[#c9a75a] sm:w-20" />
      </div>
      <div className="brand-marquee mt-6 overflow-hidden sm:mt-7">
        <ul className="brand-track flex w-max items-center">
          {[0, 1].map((copy) =>
            brands.map((b) => (
              <li key={`${copy}-${b.slug}`} className="flex shrink-0 items-center" aria-hidden={copy === 1 ? true : undefined}>
                <Link
                  href={`/brand/${b.slug}`}
                  tabIndex={copy === 1 ? -1 : undefined}
                  aria-label={copy === 1 ? undefined : `Shop ${b.name}`}
                  className="brand-chip flex h-14 w-36 items-center justify-center px-4 sm:h-16 sm:w-44 sm:px-6"
                >
                  {/* Plain <img>: small static marks, already sized by CSS. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.logoUrl as string} alt={copy === 1 ? '' : b.name} loading="lazy" className="brand-logo max-h-9 max-w-full object-contain sm:max-h-11" />
                </Link>
              </li>
            )),
          )}
        </ul>
      </div>
    </section>
  );
}
