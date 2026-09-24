import type { Metadata, Viewport } from 'next';
import { Cinzel, Jost } from 'next/font/google';
import { Header, Footer } from '@/components/Chrome';
import { PwaRegister, installCaptureScript } from '@/components/PwaRegister';
import { InstallPromptPopup } from '@/components/InstallPrompt';
import { CartProvider } from '@/components/CartProvider';
import { themeBootScript } from '@/components/ThemeToggle';
import { SITE, organizationJsonLd } from '@/lib/seo';
import { ENTITY } from '@/lib/legal';
import { getTheme } from '@/lib/content';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import { LocaleProvider } from '@/components/LocaleProvider';
import '@/app/globals.css';

/**
 * Self-hosted through next/font: no render-blocking request to Google, and no
 * layout shift when the face swaps in. CLS is a ranking input and the audience
 * is mid-range Android on patchy mobile data.
 */
const display = Cinzel({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });
const body = Jost({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.origin),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s` },
  description: 'Makeup, skin care, body care and fragrance from leading beauty brands, sold direct across India.',
  applicationName: SITE.name,
  formatDetection: { telephone: true, address: false, email: false },
  // Set per page by buildMetadata(); this is the safe default for anything
  // that somehow renders without its own metadata.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Two entries so the browser chrome around the page matches the theme
  // inside it. A single colour would leave a cream address bar sitting above
  // Royal Night, which is exactly the seam a dark theme is supposed to hide.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#341316' },
    { media: '(prefers-color-scheme: dark)', color: '#1A0E10' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Lets the installed app draw behind the notch on iOS instead of leaving
  // black bars at the top and bottom.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const org = organizationJsonLd({ phone: ENTITY.supportPhone, email: ENTITY.supportEmail });
  const theme = await getTheme();

  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Plain inline <script>, deliberately, and deliberately here.

          `beforeinstallprompt` fires once, cannot be retrieved afterwards, and
          a listener attached after it fires misses it for good — the classic
          PWA bug where the install button silently does nothing.

          next/script with strategy="beforeInteractive" is NOT the answer in the
          App Router: it queues into Next's own runtime (self.__next_s), so it
          lands after Next's bundles instead of before them. A raw inline script
          executes where the parser finds it, which is what is wanted.

          It still cannot be proven to beat Next's async bundles on a warm
          cache, so it is only half the guarantee — ensureInstallCapture() in
          the components is the other half.
        */}
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />

        {/*
          Applies the saved theme before the first paint. Inline and
          parser-blocking for the same reason as the script above: run it
          any later and the page paints in the day theme and then snaps to
          Royal Night, which looks worse than having no dark theme at all.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />

        {/*
          Admin-editable brand colours from the console's Theme page.
          Light theme only: `:root[data-theme='night']` in globals.css has
          higher specificity than a plain `:root` rule regardless of source
          order, so Royal Night keeps its own hand-tuned palette no matter
          what an admin picks here.
        */}
        <style dangerouslySetInnerHTML={{ __html: `:root { --ink: ${theme.colors.ink}; --accent: ${theme.colors.accent}; --gold: ${theme.colors.gold}; }` }} />

        {/* iOS ignores the manifest for these two. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Majestic Cart" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="bg-[var(--page)] font-sans text-[var(--ink)] antialiased">
        {/* Keyboard users should not have to tab through the whole nav. */}
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--surface)] focus:px-4 focus:py-2 focus:shadow">
          Skip to content
        </a>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
        {/* Wraps the chrome as well as the page: the header's bag badge reads
            the same cart the pages write to. */}
        <LocaleProvider>
        <CartProvider>
          <AnnouncementBar a={theme.announcement} />
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </CartProvider>
        </LocaleProvider>
        <PwaRegister />
        {/* Appears after 30 seconds of visible browsing, never to someone who
            already installed it or said no recently. */}
        <InstallPromptPopup />
      </body>
    </html>
  );
}
