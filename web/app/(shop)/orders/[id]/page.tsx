import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { OrderDetailView } from '@/components/OrderDetailView';
import { MemberSkeleton } from '@/components/MemberShell';

/**
 * One order.
 *
 * `dynamic` because there is nothing to pre-render: the order belongs to one
 * member, the page is noindex, and generating static shells for order ids would
 * mean enumerable URLs for a page carrying a name, address and phone number.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Order'),
  description: 'Your order.',
  pathname: '/orders',
});

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <OrderDetailView orderId={id} />
    </Suspense>
  );
}
