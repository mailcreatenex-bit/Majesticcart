import Link from 'next/link';
import Image from 'next/image';
import { SITE } from '@/lib/seo';
import { ENTITY, LEGAL_DOCUMENTS } from '@/lib/legal';
import { InstallButton } from './InstallPrompt';
import { CartCount } from './CartProvider';
import { ThemeToggle } from './ThemeToggle';
import { MobileMenu } from './MobileMenu';

/**
 * Shared chrome.
 *
 * The footer is not decoration here. Under the Consumer Protection
 * (E-Commerce) Rules the legal entity name, address, customer care contact and
 * grievance officer must be findable from any page — which in practice means
 * the footer.
 */

const SHOP_LINKS = [
  { href: '/shop', label: 'All products' },
  { href: '/category/makeup', label: 'Makeup' },
  { href: '/category/skin-care', label: 'Skin care' },
  { href: '/category/body-care', label: 'Body care' },
  { href: '/category/fragrance', label: 'Fragrance' },
];
const COMPANY_LINKS = [
  { href: '/about', label: 'About us' },
  { href: '/contact', label: 'Contact us' },
  { href: '/join', label: 'Become a member' },
  { href: '/faq', label: 'FAQ' },
];

export function Header() {
  return (
    // The extra top padding only ever does anything on a notched/Dynamic
    // Island phone with the PWA installed (`viewport-fit: cover` in the shop
    // layout lets content draw under the status bar in the first place) — on
    // everything else `env(safe-area-inset-top)` resolves to 0 and this is a
    // no-op.
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)] pt-[env(safe-area-inset-top)] backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-6" aria-label="Main">
        {/* The wordmark is dropped here deliberately: the seal alone is what
            carries brand recognition, and skipping the text is what leaves
            the mobile header room for the menu, wallet and bag icons without
            crowding. `aria-label` keeps the link named for anyone not seeing
            the image. */}
        <Link href="/" aria-label={SITE.name} className="flex shrink-0 items-center">
          <Image
            src="/brand/majestic-cart-seal.png"
            alt=""
            width={240}
            height={240}
            priority
            className="h-10 w-10 rounded-full sm:h-11 sm:w-11"
          />
        </Link>
        <MobileMenu links={SHOP_LINKS} />
        <ul className="hidden gap-1 md:flex">
          {SHOP_LINKS.slice(0, 4).map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-full px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Renders nothing where installing is impossible, so the nav does
              not carry a dead control on Firefox or inside WhatsApp. */}
          <ThemeToggle />
          <InstallButton variant="header" />
          {/* Goes to the member's wallet. A guest lands here too — MemberShell's
              own 401 handling sends them on to login, the same as any other
              account page, so this needs no auth check of its own. */}
          <Link
            href="/wallet"
            aria-label="Wallet"
            title="Wallet"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]"
          >
            <WalletIcon />
          </Link>
          <Link href="/cart" className="inline-flex items-center rounded-full px-2 py-2 text-sm text-[var(--muted)] hover:text-[var(--ink)] sm:px-3">
            Bag
            <CartCount />
          </Link>
          <Link href="/login" className="shrink-0 rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--gold-pale)] sm:px-4">Log in</Link>
        </div>
      </nav>
    </header>
  );
}

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5v1H4.5A1.5 1.5 0 0 0 3 10Z" />
      <path d="M3 10v8a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18v-7a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 1 3 8" />
      <circle cx="16.5" cy="14.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 font-serif text-lg text-[var(--ink)]">
            <Image src="/brand/majestic-cart-seal.png" alt="" width={240} height={240} className="h-9 w-9 rounded-full" />
            {SITE.name}
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">{SITE.tagline}</p>
          <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
            {ENTITY.legalName}<br />{ENTITY.registeredAddress}<br />
            GSTIN {ENTITY.gstin}
          </p>
        </div>

        <nav aria-label="Shop">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Shop</h2>
          <ul className="mt-3 space-y-2">
            {SHOP_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{l.label}</Link></li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Company">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Company</h2>
          <ul className="mt-3 space-y-2">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{l.label}</Link></li>
            ))}
          </ul>
          <h2 className="mt-6 text-sm font-semibold text-[var(--ink)]">Policies</h2>
          <ul className="mt-3 space-y-2">
            {LEGAL_DOCUMENTS.map((d) => (
              <li key={d.slug}><Link href={`/legal/${d.slug}`} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{d.title}</Link></li>
            ))}
          </ul>
        </nav>

        {/* Required to be published and reachable. Not buried. */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Customer care</h2>
          <address className="mt-3 space-y-1 text-sm not-italic text-[var(--muted)]">
            <div><a href={`tel:${ENTITY.supportPhone}`} className="hover:text-[var(--ink)]">{ENTITY.supportPhone}</a></div>
            <div><a href={`mailto:${ENTITY.supportEmail}`} className="hover:text-[var(--ink)]">{ENTITY.supportEmail}</a></div>
            <div className="text-xs">{ENTITY.supportHours}</div>
          </address>
          {/* Renders nothing where installing is impossible — a dead button is
              worse than no button. */}
          <div className="mt-6">
            <InstallButton />
          </div>

          <h2 className="mt-6 text-sm font-semibold text-[var(--ink)]">Grievance officer</h2>
          <address className="mt-3 space-y-1 text-sm not-italic text-[var(--muted)]">
            <div>{ENTITY.grievanceOfficer.name}</div>
            <div><a href={`mailto:${ENTITY.grievanceOfficer.email}`} className="hover:text-[var(--ink)]">{ENTITY.grievanceOfficer.email}</a></div>
            <div className="text-xs">Acknowledged within 48 hours</div>
          </address>
        </div>
      </div>

      <div className="border-t border-[var(--line)] px-4 py-6">
        <div className="mx-auto max-w-6xl text-xs leading-relaxed text-[var(--muted)]">
          {/* Says what joining costs and what income depends on, without making
              a claim about amounts. Income figures belong behind the login. */}
          Joining is free. There is no registration fee and no purchase is required to become a member.
          Income is earned only on products that are sold and delivered, and depends entirely on the sales
          you and your team make. We make no guarantee of earnings.
          <div className="mt-3">© {new Date().getFullYear()} {ENTITY.legalName}. All rights reserved.</div>
          <div className="mt-2 flex items-center gap-1.5">
            Developed with
            <span aria-hidden="true">♥️</span>
            by
            <a
              href="https://cre8nex.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Cre8nex — Digital Marketing & Software"
              className="inline-flex items-center align-middle opacity-90 transition-opacity hover:opacity-100"
            >
              <Image src="/brand/cre8nex-logo.png" alt="Cre8nex" width={78} height={24} className="h-[18px] w-auto" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--accent-soft)]">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="font-serif text-3xl leading-tight text-[var(--ink)] md:text-4xl">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-[var(--body)]">{lead}</p>}
      </div>
    </div>
  );
}
