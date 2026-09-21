import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { CheckoutView } from '@/components/CheckoutView';

/**
 * Checkout.
 *
 * `noindex, nofollow, nocache` via buildMetadata, and on the service worker's
 * never-cache list. A cached checkout would show a stale wallet balance, which
 * is the one number on this page that must never be wrong.
 */
export const metadata: Metadata = buildMetadata({
  title: pageTitle('Checkout'),
  description: 'Complete your order.',
  pathname: '/checkout',
});

export default function CheckoutPage() {
  return <CheckoutView />;
}
