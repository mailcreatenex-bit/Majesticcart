import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { WithdrawalQueueView } from '@/components/admin/WithdrawalQueue';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Withdrawals'),
  description: 'Administrator console.',
  pathname: '/admin/withdrawals',
});

export default function Page() {
  return (
    <Suspense>
      <WithdrawalQueueView />
    </Suspense>
  );
}
