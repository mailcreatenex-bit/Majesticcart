import Link from 'next/link';
import Image from 'next/image';

/**
 * Full-width photo banner, auto-rotating the same way HeroSlider does (pure
 * CSS crossfade, no controls, no client JS).
 *
 * The caption sits on its own frosted panel rather than directly on the
 * photo. A gradient-over-image overlay only guarantees contrast against the
 * one photo it was tuned for — the moment the slide rotates to a brighter or
 * differently-composed shot, the same gradient can leave text unreadable.
 * A solid panel is contrast-safe against every slide by construction.
 *
 * The panel is a literal black, not a `--ink`-based token: `--ink` flips to
 * a light cream in the site's dark theme (it means "primary text colour"
 * there, not "dark surface"), which would turn this panel light and leave
 * the white heading on it unreadable in exactly that mode.
 */
export function PromoBanner({
  images,
  heading,
  ctaLabel,
  ctaHref,
}: {
  images: string[];
  heading: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  const duration = images.length * 6;

  return (
    <section className="relative overflow-hidden">
      <div className="relative aspect-[4/5] w-full sm:aspect-video">
        {images.map((src, i) => (
          <div
            key={src}
            className="promo-slide absolute inset-0"
            style={{ animationDuration: `${duration}s`, animationDelay: `${-i * 6}s` }}
          >
            <Image src={src} alt="" fill sizes="100vw" className="object-cover" />
          </div>
        ))}
        {images.length > 1 && (
          <style>{`
            @keyframes promoFade {
              0% { opacity: 0; }
              4% { opacity: 1; }
              ${Math.round((6 / duration) * 100 - 4)}% { opacity: 1; }
              ${Math.round((6 / duration) * 100)}% { opacity: 0; }
              100% { opacity: 0; }
            }
            .promo-slide {
              opacity: 0;
              animation-name: promoFade;
              animation-timing-function: ease-in-out;
              animation-iteration-count: infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .promo-slide { animation: none; opacity: 0; }
              .promo-slide:first-child { opacity: 1; }
            }
          `}</style>
        )}

        {/* Darkens the bottom third on every slide so the panel's own
            translucency never has to fight a bright photo underneath. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex justify-center p-4 sm:inset-y-0 sm:left-0 sm:right-auto sm:items-center sm:justify-start sm:p-10">
          <div className="w-full max-w-sm rounded-2xl bg-black/70 p-5 backdrop-blur-sm sm:p-6">
            <p className="font-serif text-xl leading-snug text-white sm:text-2xl">{heading}</p>
            <Link
              href={ctaHref}
              className="mt-4 inline-block rounded-xl gold-foil px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-900/20"
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
