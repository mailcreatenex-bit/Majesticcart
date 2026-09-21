import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { CouponAdminView } from '@/components/admin/CouponAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Coupons'),
  description: 'Administrator console.',
  pathname: '/admin/coupons',
});

export default function Page() {
  return (
    <Suspense>
      <CouponAdminView />
    </Suspense>
  );
}
