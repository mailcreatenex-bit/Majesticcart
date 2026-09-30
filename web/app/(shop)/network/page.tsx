import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { NetworkView } from '@/components/NetworkView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('My team'),
  description: 'Your team and your referral link.',
  pathname: '/network',
});

export default async function Page() {
  const { networkCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <NetworkView content={networkCopy} />
    </Suspense>
  );
}
