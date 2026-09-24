import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { SupportAdminView } from '@/components/admin/SupportAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Support'),
  description: 'Administrator console.',
  pathname: '/admin/support',
});

export default function Page() {
  return (
    <Suspense>
      <SupportAdminView />
    </Suspense>
  );
}
