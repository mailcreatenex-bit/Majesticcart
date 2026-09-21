import type { Metadata } from 'next';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { CartView } from '@/components/CartView';

/**
 * The bag.
 *
 * `noindex, nofollow` via buildMetadata — a cart page in a search index is a
 * page with nothing on it for anyone but its owner. The route is also in the
 * service worker's never-cache list, so a stale bag is never served from disk.
 */
export const metadata: Metadata = buildMetadata({
  title: pageTitle('Your bag'),
  description: 'The products in your bag.',
  pathname: '/cart',
});

export default function CartPage() {
  return <CartView />;
}
