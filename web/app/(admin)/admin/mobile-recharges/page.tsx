import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { MobileRechargeQueueView } from '@/components/admin/MobileRechargeQueue';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Mobile recharges'),
  description: 'Administrator console.',
  pathname: '/admin/mobile-recharges',
});

export default function Page() {
  return (
    <Suspense>
      <MobileRechargeQueueView />
    </Suspense>
  );
}
