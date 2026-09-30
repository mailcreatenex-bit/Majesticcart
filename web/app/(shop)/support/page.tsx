import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { SupportView } from '@/components/SupportView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Support'),
    description: 'Your support tickets.',
    pathname: '/support',
  }),
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { supportCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <SupportView intro={supportCopy.intro} />
    </Suspense>
  );
}
