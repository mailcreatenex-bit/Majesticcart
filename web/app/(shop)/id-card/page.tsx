import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { IdCardView } from '@/components/IdCardView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Your ID card'),
    description: 'Your printable Majestic Cart member ID card.',
    pathname: '/id-card',
  }),
  // A member's own card: nothing here for a search engine to index.
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { idCardCopy } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <IdCardView copy={idCardCopy} />
    </Suspense>
  );
}
