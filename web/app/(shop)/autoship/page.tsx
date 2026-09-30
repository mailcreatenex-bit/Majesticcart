import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AutoshipView } from '@/components/AutoshipView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Autoship'),
    description: 'Your standing monthly order.',
    pathname: '/autoship',
  }),
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { autoshipCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <AutoshipView copy={autoshipCopy} />
    </Suspense>
  );
}
