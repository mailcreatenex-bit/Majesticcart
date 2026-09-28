import Image from 'next/image';

/**
 * Auto-rotating hero photos. Pure CSS crossfade (each slide gets a negative
 * animation-delay so they're already mid-cycle on first paint) — no client
 * JS, no state, and nothing for a reduced-motion or slow-render visitor to
 * get stuck on. There are deliberately no arrows or dots: the client asked
 * for automatic-only.
 */
export function HeroSlider({ images, fallback }: { images: string[]; fallback: string }) {
  const slides = images.length > 0 ? images : [fallback];
  const duration = slides.length * 5;

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-xl">
      {slides.map((src, i) => (
        <div
          key={src}
          className="hero-slide absolute inset-0"
          style={{
            animationDuration: `${duration}s`,
            animationDelay: `${-i * 5}s`,
          }}
        >
          <Image
            src={src}
            alt=""
            fill
            priority={i === 0}
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      ))}
      {slides.length > 1 && (
        <style>{`
          @keyframes heroFade {
            0% { opacity: 0; }
            4% { opacity: 1; }
            ${Math.round((5 / duration) * 100 - 4)}% { opacity: 1; }
            ${Math.round((5 / duration) * 100)}% { opacity: 0; }
            100% { opacity: 0; }
          }
          .hero-slide {
            opacity: 0;
            animation-name: heroFade;
            animation-timing-function: ease-in-out;
            animation-iteration-count: infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .hero-slide { animation: none; opacity: 0; }
            .hero-slide:first-child { opacity: 1; }
          }
        `}</style>
      )}
    </div>
  );
}
