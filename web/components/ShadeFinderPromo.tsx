import Link from 'next/link';
import Image from 'next/image';
import { faceCrop } from '@/lib/focal';

/**
 * The AI shade finder, where people will actually see it: a feature band on the
 * homepage and a compact card on makeup product pages. Both lead to
 * /shade-finder, which asks a guest to log in or register first (the photo
 * analysis costs the store money per try, so it is for members).
 *
 * A server component with no state: it is just a link with a promise on it.
 */
export function ShadeFinderPromo({ variant }: { variant: 'home' | 'product' }) {
  if (variant === 'product') {
    return (
      <Link
        href="/shade-finder"
        className="mt-6 flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-gradient-to-r from-[var(--accent-soft)] to-[var(--surface)] p-4 transition hover:border-[var(--accent)]/40"
      >
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xl text-white">✨</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--ink)]">Not sure of your shade?</span>
          <span className="block text-xs leading-relaxed text-[var(--muted)]">Take a selfie and we will pick the shades that suit your skin, ready to add to your bag.</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">Try it →</span>
      </Link>
    );
  }

  const photo = '/home/shop-banner.jpg';
  return (
    <section aria-labelledby="shade-heading" className="px-4 py-10">
      <div className="mx-auto grid max-w-6xl overflow-hidden rounded-3xl bg-[var(--ink)] text-[var(--gold-pale)] md:grid-cols-2">
        <div className="relative aspect-[16/10] md:aspect-auto md:min-h-[22rem]">
          <Image src={photo} alt="" fill sizes="(max-width: 768px) 100vw, 50vw" {...faceCrop(photo, 16 / 10, 1)} />
        </div>
        <div className="flex flex-col justify-center p-6 sm:p-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--gold)]">New · AI shade finder</p>
          <h2 id="shade-heading" className="mt-2 font-serif text-3xl leading-tight text-white">Find the shade that is yours</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--gold-pale)]/85">
            Take a selfie. We read your undertone and pick foundations, lipsticks and more from our range that suit you, with a buy button on every one. Your photo is never stored.
          </p>
          <ol className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-white">
            {['Take a selfie', 'Get your matches', 'Add to bag'].map((step, i) => (
              <li key={step} className="rounded-xl bg-white/10 px-2 py-3">
                <span className="mb-1 block text-base text-[var(--gold)]">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <Link
            href="/shade-finder"
            className="mt-6 inline-block self-start rounded-xl gold-foil px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-amber-900/20"
          >
            Find my shade
          </Link>
          <p className="mt-3 text-xs text-[var(--gold-pale)]/60">Free for members.</p>
        </div>
      </div>
    </section>
  );
}
