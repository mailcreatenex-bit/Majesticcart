import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AccountView } from '@/components/AccountView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Your account'),
  description: 'Your rank, volume and payout details.',
  pathname: '/account',
});

export default async function Page() {
  const { accountCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <AccountView copy={accountCopy} />
    </Suspense>
  );
}
