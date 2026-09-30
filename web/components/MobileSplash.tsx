'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

const HOLD_MS = 1500;
const FADE_MS = 700;

/**
 * A branded splash on phones only, shown on every fresh load of the site
 * (not on in-app navigation, the same way a native app's splash shows once
 * at cold start and never again until the app is relaunched).
 *
 * Holds for HOLD_MS, then fades its own opacity to 0 over FADE_MS — the page
 * underneath is already fully rendered, so that fade is all "the real
 * content fading in" actually is; no separate animation on the page itself
 * needed. Stays mounted (rather than just toggling opacity forever) only
 * until the fade finishes, so it stops intercepting taps the moment it's
 * invisible rather than sitting there as a dead full-screen layer.
 *
 * `sm:hidden` rather than a JS width check: it needs to be right the instant
 * the page paints, before any script has run, or the whole point — covering
 * the first frame — is lost.
 */
export function MobileSplash() {
  const [phase, setPhase] = useState<'visible' | 'fading' | 'gone'>('visible');

  useEffect(() => {
    const hold = setTimeout(() => setPhase('fading'), HOLD_MS);
    const remove = setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS);
    return () => { clearTimeout(hold); clearTimeout(remove); };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      className={`fixed inset-0 z-[200] sm:hidden transition-opacity ease-out ${phase === 'fading' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      role="presentation"
      aria-hidden="true"
    >
      <Image src="/brand/splash.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
    </div>
  );
}
