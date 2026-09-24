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
export function AccountLink() {
  const [signedIn, setSignedIn] = useState(false);
  const t = useT();
  useEffect(() => {
    setSignedIn(document.cookie.split('; ').some((c) => c === `${MEMBER_FLAG_COOKIE}=1`));
  }, []);
  return (
    <Link
      href={signedIn ? '/account' : '/login'}
      className="shrink-0 rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--gold-pale)] sm:px-4"
    >
      {signedIn ? t('nav.account') : t('nav.login')}
    </Link>
  );
}
