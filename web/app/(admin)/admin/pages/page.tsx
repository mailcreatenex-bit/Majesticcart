import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { PagesAdminView } from '@/components/admin/PagesAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Pages'),
  description: 'Administrator console.',
  pathname: '/admin/pages',
});

export default function Page() {
  return (
    <Suspense>
      <PagesAdminView />
    </Suspense>
  );
}
