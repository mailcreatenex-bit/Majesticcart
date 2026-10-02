import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { WishlistView } from '@/components/WishlistView';
import { MemberSkeleton } from '@/components/MemberShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Your wishlist'),
  description: 'Products you have saved.',
  pathname: '/wishlist',
});

export default function Page() {
  return (
    <Suspense fallback={<MemberSkeleton />}>
      <WishlistView />
    </Suspense>
  );
}
