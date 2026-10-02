'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MEMBER_FLAG_COOKIE } from '@/lib/session-shared';
import { useT } from './LocaleProvider';

/**
 * The header's account button: "Log in" for a visitor, "My account" for a member.
 *
 * The header is part of statically cached pages, so it cannot know who is
 * looking; the browser decides after load from a plain flag cookie set at login
 * (see `MEMBER_FLAG_COOKIE`). It starts as "Log in", which is also what a
 * visitor with scripts off sees.
 */
export function AccountLink({ compact = false }: { compact?: boolean } = {}) {
  const [signedIn, setSignedIn] = useState(false);
  const t = useT();
  useEffect(() => {
    setSignedIn(document.cookie.split('; ').some((c) => c === `${MEMBER_FLAG_COOKIE}=1`));
  }, []);
  const label = signedIn ? t('nav.account') : t('nav.login');
  // Phone header: just the round profile icon, like Purplle's app, with the
  // same destination and an accessible name in place of the visible text.
  if (compact) {
    return (
      <Link
        href={signedIn ? '/account' : '/login'}
        aria-label={label}
        title={label}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/90 text-white transition-colors hover:bg-white/15"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      </Link>
    );
  }
  return (
    <Link
      href={signedIn ? '/account' : '/login'}
      className="shrink-0 rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--gold-pale)] sm:px-4"
    >
      {label}
    </Link>
  );
}
