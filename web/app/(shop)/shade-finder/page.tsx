import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ShadeFinderView } from '@/components/ShadeFinderView';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('AI shade finder'),
  description: 'Upload a selfie and get shade suggestions from the current makeup range.',
  pathname: '/shade-finder',
});

export default function Page() {
  return (
    <Suspense>
      <ShadeFinderView />
    </Suspense>
  );
}
