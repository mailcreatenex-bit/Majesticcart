import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { OrderQueueView } from '@/components/admin/OrderQueue';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Orders'),
  description: 'Administrator console.',
  pathname: '/admin/orders',
});

export default function Page() {
  return (
    <Suspense>
      <OrderQueueView />
    </Suspense>
  );
}
