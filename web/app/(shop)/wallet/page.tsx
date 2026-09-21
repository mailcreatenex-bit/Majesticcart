import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { WalletView } from '@/components/WalletView';
import { MemberSkeleton } from '@/components/MemberShell';

/**
 * `noindex, nofollow, nocache` via buildMetadata, and on the service worker's
 * never-cache list. Nothing behind the login belongs in a search index, and a
 * cached balance or order status is worse than a slow one.
 */
export const metadata: Metadata = buildMetadata({
  title: pageTitle('Wallet'),
  description: 'Your shopping and income wallet balances and statements.',
  pathname: '/wallet',
});

export default function Page() {
  return (
    // useSearchParams needs a Suspense boundary, or the whole route opts out
    // of static rendering and the shell stops being served from the edge.
    <Suspense fallback={<MemberSkeleton />}>
      <WalletView />
    </Suspense>
  );
}
