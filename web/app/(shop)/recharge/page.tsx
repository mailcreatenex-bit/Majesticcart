import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { RechargeView } from '@/components/RechargeView';
import { MemberSkeleton } from '@/components/MemberShell';

/**
 * `noindex, nofollow, nocache` via buildMetadata, and on the service worker's
 * never-cache list. Nothing behind the login belongs in a search index, and a
 * cached balance or order status is worse than a slow one.
 */
export const metadata: Metadata = buildMetadata({
  title: pageTitle('Add money to wallet'),
  description: 'Add money to your shopping wallet by UPI.',
  pathname: '/recharge',
});

export default function Page() {
  return (
    // useSearchParams needs a Suspense boundary, or the whole route opts out
    // of static rendering and the shell stops being served from the edge.
    <Suspense fallback={<MemberSkeleton />}>
      <RechargeView />
    </Suspense>
  );
}
