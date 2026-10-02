import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ShareView } from '@/components/ShareView';
import { MemberSkeleton } from '@/components/MemberShell';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = {
  ...buildMetadata({
    title: pageTitle('Share'),
    description: 'Ready-made WhatsApp messages and share images with your link.',
    pathname: '/share',
  }),
  robots: { index: false, follow: false },
};

export default async function Page() {
  const { trainingVideos } = await getTheme();
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <ShareView videos={trainingVideos} />
    </Suspense>
  );
}
