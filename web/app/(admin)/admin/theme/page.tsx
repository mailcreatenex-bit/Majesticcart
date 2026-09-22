import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { ThemeAdminView } from '@/components/admin/ThemeAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Theme'),
  description: 'Administrator console.',
  pathname: '/admin/theme',
});

export default function Page() {
  return (
    <Suspense>
      <ThemeAdminView />
    </Suspense>
  );
}
