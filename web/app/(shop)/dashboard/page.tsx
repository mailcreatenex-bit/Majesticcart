import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { TeamDashboardView } from '@/components/TeamDashboardView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Your dashboard'),
  description: 'Your team, this month against target, rank progress and who needs a nudge.',
  pathname: '/dashboard',
});

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <TeamDashboardView />
    </Suspense>
  );
}
