import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { BlogAdminView } from '@/components/admin/BlogAdmin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Blog'),
  description: 'Administrator console.',
  pathname: '/admin/blog',
});

export default function Page() {
  return (
    <Suspense>
      <BlogAdminView />
    </Suspense>
  );
}
