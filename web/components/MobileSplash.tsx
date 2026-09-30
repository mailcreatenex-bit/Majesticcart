'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

/**
 * A one-second branded splash on phones only, shown on every fresh load of
 * the site (not on in-app navigation, the same way a native app's splash
 * shows once at cold start and never again until the app is relaunched).
 *
 * `sm:hidden` rather than a JS width check: it needs to be right the instant
 * the page paints, before any script has run, or the whole point — covering
 * the first frame — is lost.
 */
export function MobileSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setVisible(false), 1000);
    return () => clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] sm:hidden" role="presentation" aria-hidden="true">
      <Image src="/brand/splash.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
    </div>
  );
}
