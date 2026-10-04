import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { LabelPrintView } from '@/components/admin/LabelPrint';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Shipping labels'),
  description: 'Administrator console.',
  pathname: '/admin/orders/print',
});

export default function Page() {
  return (
    <Suspense>
      <LabelPrintView />
    </Suspense>
  );
}
