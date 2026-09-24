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
    <section aria-label="Brands we carry" className="border-b border-[var(--line)] bg-[var(--surface)] py-8">
      <p className="text-center text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Brands we carry</p>
      <div className="brand-marquee mt-6 overflow-hidden">
        <ul className="brand-track flex w-max items-center">
          {[0, 1].map((copy) =>
            brands.map((b) => (
              <li key={`${copy}-${b.slug}`} className="flex shrink-0 items-center pr-6 sm:pr-8" aria-hidden={copy === 1 ? true : undefined}>
                <Link
                  href={`/brand/${b.slug}`}
                  tabIndex={copy === 1 ? -1 : undefined}
                  aria-label={copy === 1 ? undefined : `Shop ${b.name}`}
                  className="brand-chip flex h-16 w-40 items-center justify-center rounded-xl bg-white px-4 sm:h-20 sm:w-48"
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
