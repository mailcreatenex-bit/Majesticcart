import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AnalyticsAdminView } from '@/components/admin/AnalyticsAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Analytics'),
  description: 'Administrator console.',
  pathname: '/admin/analytics',
});

export default function Page() {
  return (
    <Suspense>
      <AnalyticsAdminView />
    </Suspense>
  );
}
