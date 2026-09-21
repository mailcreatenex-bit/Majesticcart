import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { NetworkView } from '@/components/NetworkView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('My team'),
  description: 'Your team and your referral link.',
  pathname: '/network',
});

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <NetworkView />
    </Suspense>
  );
}
