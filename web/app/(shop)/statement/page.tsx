import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { StatementView } from '@/components/StatementView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Income statement'),
    description: 'Your monthly income statement, with the deduction withheld, as a PDF.',
    pathname: '/statement',
  }),
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <StatementView />
    </Suspense>
  );
}
