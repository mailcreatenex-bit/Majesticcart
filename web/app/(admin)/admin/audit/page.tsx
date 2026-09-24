import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AuditAdminView } from '@/components/admin/AuditAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Audit log'),
  description: 'Administrator console.',
  pathname: '/admin/audit',
});

export default function Page() {
  return (
    <Suspense>
      <AuditAdminView />
    </Suspense>
  );
}
