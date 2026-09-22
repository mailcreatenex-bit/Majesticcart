import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { RolesAdminView } from '@/components/admin/RolesAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Roles & admins'),
  description: 'Administrator console.',
  pathname: '/admin/roles',
});

export default function Page() {
  return (
    <Suspense>
      <RolesAdminView />
    </Suspense>
  );
}
