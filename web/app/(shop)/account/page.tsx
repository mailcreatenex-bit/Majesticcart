import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AccountView } from '@/components/AccountView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Your account'),
  description: 'Your rank, volume and payout details.',
  pathname: '/account',
});

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <AccountView />
    </Suspense>
  );
}
