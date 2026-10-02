import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AdminShell } from '@/components/admin/AdminShell';
import { TwoFactorPanel } from '@/components/admin/TwoFactorPanel';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Security'),
  description: 'Administrator console.',
  pathname: '/admin/security',
});

export default function Page() {
  return (
    <Suspense>
      <AdminShell title="Security" subtitle="Protect your admin account.">
        <TwoFactorPanel forced />
      </AdminShell>
    </Suspense>
  );
}
