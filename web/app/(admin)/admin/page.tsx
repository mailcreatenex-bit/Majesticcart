import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AdminDashboardView } from '@/components/admin/AdminDashboard';

/**
 * The admin console is `noindex, nofollow, nocache` via buildMetadata (the
 * `/admin` prefix is in PRIVATE_PREFIXES), excluded from the sitemap, and on
 * the service worker's never-cache list. A cached admin page would show a stale
 * approval queue — and an approval acted on twice is money paid twice.
 */
export const metadata: Metadata = buildMetadata({
  title: pageTitle('Admin dashboard'),
  description: 'Administrator console.',
  pathname: '/admin',
});

export default function Page() {
  return (
    <Suspense>
      <AdminDashboardView />
    </Suspense>
  );
}
