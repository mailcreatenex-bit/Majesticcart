import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { WithdrawView } from '@/components/WithdrawView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Withdraw income'),
  description: 'Withdraw your income wallet balance to your bank account.',
  pathname: '/wallet/withdraw',
});

export default async function Page() {
  const { withdrawCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <WithdrawView copy={withdrawCopy} />
    </Suspense>
  );
}
