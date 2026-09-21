import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { CatalogAdminView } from '@/components/admin/CatalogAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Catalogue'),
  description: 'Administrator console.',
  pathname: '/admin/catalog',
});

export default function Page() {
  return (
    <Suspense>
      <CatalogAdminView />
    </Suspense>
  );
}
