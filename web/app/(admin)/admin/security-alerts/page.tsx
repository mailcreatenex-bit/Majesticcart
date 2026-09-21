import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { SecurityAlertQueueView } from '@/components/admin/SecurityAlertQueue';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Security alerts'),
  description: 'Administrator console.',
  pathname: '/admin/security-alerts',
});

export default function Page() {
  return (
    <Suspense>
      <SecurityAlertQueueView />
    </Suspense>
  );
}
