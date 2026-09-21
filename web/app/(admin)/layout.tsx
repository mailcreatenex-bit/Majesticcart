import type { Metadata, Viewport } from 'next';
import '@/app/globals.css';

/**
 * The admin console's root layout.
 *
 * A separate root from the storefront's, which is why both live in route
 * groups: the console must not inherit the shop's header, footer, cart
 * provider or install prompt. Those are not just visual noise here — a cart
 * badge on a page where an admin is approving payments is a page that can be
 * mistaken for the shop, and the PWA install prompt has no business appearing
 * over an approval queue.
 *
 * No display font either. The console is a tool, and Cinzel on a data table is
 * a readability cost with no benefit.
 */
export const metadata: Metadata = {
  title: 'Admin — Majestic Cart',
  // Belt and braces with buildMetadata's robotsFor(): every page here also
  // sets its own, and /admin is in PRIVATE_PREFIXES. Two independent
  // mechanisms, because one silently failing is how a console gets indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#171717',
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="bg-[#F7F7F8] font-sans text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
