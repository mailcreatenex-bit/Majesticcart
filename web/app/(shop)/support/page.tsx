import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { SupportView } from '@/components/SupportView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Support'),
    description: 'Your support tickets.',
    pathname: '/support',
  }),
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <SupportView />
    </Suspense>
  );
}
