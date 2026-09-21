import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { MobileRechargeView } from '@/components/MobileRechargeView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Mobile recharge'),
  description: 'Recharge a mobile number from your shopping wallet balance.',
  pathname: '/wallet/mobile-recharge',
});

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <MobileRechargeView />
    </Suspense>
  );
}
