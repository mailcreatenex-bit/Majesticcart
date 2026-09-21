import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { PlanEditorView } from '@/components/admin/PlanEditor';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Compensation plan'),
  description: 'Administrator console.',
  pathname: '/admin/plan',
});

export default function Page() {
  return (
    <Suspense>
      <PlanEditorView />
    </Suspense>
  );
}
