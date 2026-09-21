import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { SettingsView } from '@/components/admin/SettingsView';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Settings'),
  description: 'Administrator console.',
  pathname: '/admin/settings',
});

export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
