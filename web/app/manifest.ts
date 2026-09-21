import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';

/**
 * Web app manifest.
 *
 * Next generates this at /manifest.webmanifest and links it automatically.
 *
 * For a browser to consider the site installable it needs: a name, a
 * start_url, display standalone (or better), and a 192px and a 512px icon. Miss
 * any one and `beforeinstallprompt` never fires — with no error anywhere — and
 * the install button appears to be broken for no visible reason.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: 'Shop luxury beauty, track your wallet and follow your team.',

    // Members land on a product page from a WhatsApp link, but the installed
    // app should open at home, not on whatever they last viewed.
    start_url: '/?src=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',

    background_color: '#FBF8F9',
    theme_color: '#341316',
    lang: 'en-IN',
    dir: 'ltr',
    categories: ['shopping', 'lifestyle', 'business'],

    icons: [
      // Purpose "any" and "maskable" are separate entries on purpose. A single
      // maskable icon gets cropped into a circle on Android and loses its
      // edges; a single "any" icon gets an ugly white box behind it.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],

    // Long-press the installed icon to jump straight to these.
    shortcuts: [
      { name: 'My wallet', short_name: 'Wallet', url: '/wallet?src=pwa', description: 'Balance, recharge and withdrawals' },
      { name: 'My orders', short_name: 'Orders', url: '/orders?src=pwa', description: 'Track your deliveries' },
      { name: 'Shop', short_name: 'Shop', url: '/shop?src=pwa', description: 'Browse the full range' },
    ],
  };
}
