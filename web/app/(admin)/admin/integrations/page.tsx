import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { IntegrationsAdminView } from '@/components/admin/IntegrationsAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Integrations'),
  description: 'Administrator console.',
  pathname: '/admin/integrations',
});

export default function Page() {
  return (
    <Suspense>
      <IntegrationsAdminView />
    </Suspense>
  );
}
