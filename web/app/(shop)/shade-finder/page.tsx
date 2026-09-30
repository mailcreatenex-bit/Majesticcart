import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ShadeFinderView } from '@/components/ShadeFinderView';
import { getTheme } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('AI shade finder'),
  description: 'Upload a selfie and get shade suggestions from the current makeup range.',
  pathname: '/shade-finder',
});

export default async function Page() {
  const { shadeFinderCopy } = await getTheme();
  return (
    <Suspense>
      <ShadeFinderView copy={shadeFinderCopy} />
    </Suspense>
  );
}
