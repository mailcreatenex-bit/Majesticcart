import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { RechargeQueueView } from '@/components/admin/RechargeQueue';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Recharges'),
  description: 'Administrator console.',
  pathname: '/admin/recharges',
});

export default function Page() {
  return (
    <Suspense>
      <RechargeQueueView />
    </Suspense>
  );
}
