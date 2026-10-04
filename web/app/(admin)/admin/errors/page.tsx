import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ErrorsAdminView } from '@/components/admin/ErrorsAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Errors'),
  description: 'Administrator console.',
  pathname: '/admin/errors',
});

export default function Page() {
  return (
    <Suspense>
      <ErrorsAdminView />
    </Suspense>
  );
}
