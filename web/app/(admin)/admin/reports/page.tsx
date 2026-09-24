import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ReportsAdminView } from '@/components/admin/ReportsAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Reports'),
  description: 'Administrator console.',
  pathname: '/admin/reports',
});

export default function Page() {
  return (
    <Suspense>
      <ReportsAdminView />
    </Suspense>
  );
}
