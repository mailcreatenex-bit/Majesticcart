import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AdminLogin } from '@/components/admin/AdminLogin';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Admin sign in'),
  description: 'Administrator access.',
  pathname: '/admin/login',
});

export default function Page() {
  return (
    <Suspense>
      <AdminLogin />
    </Suspense>
  );
}
