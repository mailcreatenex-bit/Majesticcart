import Link from 'next/link';
import Image from 'next/image';
import { faceCrop } from '@/lib/focal';
import { SITE } from '@/lib/seo';
import { LEGAL_DOCUMENTS } from '@/lib/legal';
import { getCompanyInfo } from '@/lib/content';
import { InstallButton } from './InstallPrompt';
import { CartCount } from './CartProvider';
import { MobileMenu } from './MobileMenu';
import { MobileSearchBar } from './MobileSearchBar';
import { DesktopSearch } from './DesktopSearch';
import { MobileCategoryTabs } from './MobileCategoryTabs';
import { AccountLink } from './AccountLink';
import { CategoryNav } from './CategoryNav';
import { T, LanguageSwitcher } from './LocaleProvider';
import type { TKey } from '@/lib/i18n';
import { categoryTree, listCategories } from '@/lib/catalog';

/**
 * Shared chrome.
 *
 * The footer is not decoration here. Under the Consumer Protection
 * (E-Commerce) Rules the legal entity name, address, customer care contact and
 * grievance officer must be findable from any page — which in practice means
 * the footer.
 */

const SHOP_LINKS = [
  { href: '/shop', label: 'All products', k: 'nav.all' as TKey },
  { href: '/category/makeup', label: 'Makeup' },
  { href: '/category/skin-care', label: 'Skin care' },
  { href: '/category/body-care', label: 'Body care' },
  { href: '/category/fragrance', label: 'Fragrance' },
];
const COMPANY_LINKS = [
  { href: '/about', label: 'About us', k: 'link.about' as TKey },
  { href: '/contact', label: 'Contact us', k: 'link.contact' as TKey },
  { href: '/join', label: 'Become a member', k: 'link.join' as TKey },
  { href: '/faq', label: 'FAQ', k: 'link.faq' as TKey },
];

const POLICY_KEY: Record<string, TKey> = {
  'privacy-policy': 'link.privacy', terms: 'link.terms', 'refund-policy': 'link.refund', 'shipping-policy': 'link.shipping',
};

/** Departments and their sub-categories from the live catalogue; the static list is the fallback if the API is down. */
async function shopMenu() {
  const tree = categoryTree(await listCategories());
  const links = tree.length
    ? [
        { href: '/shop', label: 'All products', k: 'nav.all' as TKey },
        ...tree.map((d) => ({
          href: `/category/${d.slug}`,
          label: d.name,
          children: d.children.map((c) => ({ href: `/category/${c.slug}`, label: c.name })),
        })),
      ]
    : SHOP_LINKS;
  return { tree, links };
}

export async function Header() {
  const { tree, links } = await shopMenu();

  // Example searches for the phone search bar's rotating placeholder, taken
  // from the live catalogue's own sub-category names so they are always
  // things the shop actually sells.
  const suggestions = [...new Set(tree.flatMap((d) => d.children.map((c) => c.name)))].slice(0, 8);
  const tabs = tree.map((d) => ({ slug: d.slug, name: d.name }));

  return (
    <>
      {/* The extra top padding only ever does anything on a notched/Dynamic
          Island phone with the PWA installed (`viewport-fit: cover` in the
          shop layout lets content draw under the status bar in the first
          place) — on everything else `env(safe-area-inset-top)` resolves to
          0 and this is a no-op. Below xl the whole header is the coloured
          band (Purplle-app style); from xl up it is the white desktop bar. */}
      <header className="chrome-bright sticky top-0 z-40 bg-[var(--accent)] pt-[env(safe-area-inset-top)] xl:border-b xl:border-[var(--line)] xl:bg-[var(--surface)] xl:backdrop-blur">
        {/* ------------------------------------------------ phone and tablet */}
        <div className="text-white xl:hidden">
          <div className="flex items-center gap-1 px-3 pb-3 pt-3">
            <MobileMenu links={links} onColor />
            <Link href="/" aria-label={SITE.name} className="ml-1 flex shrink-0 items-center rounded-full bg-white p-0.5 shadow-sm">
              <Image src="/brand/majestic-cart-logo.webp" alt="" width={512} height={512} priority className="h-10 w-10" />
            </Link>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {/* The install button, beside the wallet. Icon-only on phones;
                  it renders nothing at all once the app is installed or on a
                  browser that cannot install, so there is never a dead button. */}
              <InstallButton
                variant="header"
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
              />
              <Link href="/wallet" aria-label="Wallet" title="Wallet" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15">
                <WalletIcon />
              </Link>
              <Link href="/cart" aria-label="Bag" title="Bag" className="inline-flex h-10 items-center rounded-full px-2.5 text-white transition-colors hover:bg-white/15">
                <CartIcon />
                <CartCount tone="onColor" />
              </Link>
              <AccountLink compact />
            </div>
          </div>
          <div className="pb-3">
            <MobileSearchBar suggestions={suggestions.length ? suggestions : tabs.map((t) => t.name)} />
          </div>
        </div>

        {/* ----------------------------------------------------- desktop */}
        <nav className="mx-auto hidden h-20 max-w-6xl items-center gap-6 px-4 xl:flex" aria-label="Main">
          {/* The wordmark is dropped here deliberately: the seal alone is what
              carries brand recognition. `aria-label` keeps the link named for
              anyone not seeing the image. */}
          <Link href="/" aria-label={SITE.name} className="flex shrink-0 items-center">
            <Image
              src="/brand/majestic-cart-logo.webp"
              alt=""
              width={512}
              height={512}
              priority
              className="h-[4.5rem] w-[4.5rem]"
            />
          </Link>
          {tree.length ? (
            <CategoryNav tree={tree} />
          ) : (
            <ul className="flex gap-1">
              {SHOP_LINKS.slice(0, 4).map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="rounded-full px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <DesktopSearch />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            {/* Renders nothing where installing is impossible, so the nav does
                not carry a dead control on Firefox or inside WhatsApp. */}
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
            <Link
              href="/wishlist"
              aria-label="Wishlist"
              title="Wishlist"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </Link>
            <Link href="/cart" aria-label="Bag" title="Bag" className="inline-flex items-center rounded-full px-3 py-2 text-[var(--muted)] hover:text-[var(--ink)]">
              <CartIcon />
              <CartCount />
            </Link>
            <AccountLink />
          </div>
        </nav>
      </header>

      {/* Scrolls away with the page while the bar above stays put — like the
          Purplle app, where the department tabs are not part of the pinned bar. */}
      <div className="bg-[var(--accent)] text-white xl:hidden">
        <MobileCategoryTabs departments={tabs} />
      </div>
    </>
  );
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4h2l.4 2M7 13h10l3-7H6" />
      <circle cx="9" cy="19" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
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

export async function Footer() {
  const [{ links: shopLinks }, ENTITY] = await Promise.all([shopMenu(), getCompanyInfo()]);
  return (
    <footer className="chrome-bright mt-20 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 font-serif text-lg text-[var(--ink)]">
            <Image src="/brand/majestic-cart-logo.webp" alt="" width={512} height={512} className="h-16 w-16" />
            {SITE.name}
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">{SITE.tagline}</p>
          <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
            {ENTITY.legalName}<br />{ENTITY.registeredAddress}
          </p>
        </div>

        <nav aria-label="Shop">
          <h2 className="text-sm font-semibold text-[var(--ink)]"><T k="footer.shop" /></h2>
          <ul className="mt-3 space-y-2">
            {shopLinks.map((l) => (
              <li key={l.href}><Link href={l.href} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{'k' in l && l.k ? <T k={l.k} /> : l.label}</Link></li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Company">
          <h2 className="text-sm font-semibold text-[var(--ink)]"><T k="footer.company" /></h2>
          <ul className="mt-3 space-y-2">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{'k' in l && l.k ? <T k={l.k} /> : l.label}</Link></li>
            ))}
          </ul>
          <h2 className="mt-6 text-sm font-semibold text-[var(--ink)]"><T k="footer.policies" /></h2>
          <ul className="mt-3 space-y-2">
            {LEGAL_DOCUMENTS.map((d) => (
              <li key={d.slug}><Link href={`/legal/${d.slug}`} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">{POLICY_KEY[d.slug] ? <T k={POLICY_KEY[d.slug]} /> : d.title}</Link></li>
            ))}
          </ul>
        </nav>

        {/* Required to be published and reachable. Not buried. */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]"><T k="footer.care" /></h2>
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

          <h2 className="mt-6 text-sm font-semibold text-[var(--ink)]"><T k="footer.grievance" /></h2>
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
          Registering is free. There is no registration fee; earning requires a minimum first order, as set out in the compensation plan.
          Income is earned only on products that are sold and delivered, and depends entirely on the sales
          you and your team make. We make no guarantee of earnings.
          <div className="mt-3">© {new Date().getFullYear()} {ENTITY.legalName}. All rights reserved.</div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#0B1E3D] px-3 py-1.5 text-white">
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

export function PageHeader({ title, lead, image }: { title: string; lead?: string; image?: string }) {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--accent-soft)]">
      <div className={`mx-auto max-w-4xl px-4 py-12 ${image ? 'grid gap-8 md:max-w-6xl md:grid-cols-2 md:items-center' : ''}`}>
        <div>
          <h1 className="font-serif text-3xl leading-tight text-[var(--ink)] md:text-4xl">{title}</h1>
          {lead && <p className="mt-3 max-w-2xl text-[var(--body)]">{lead}</p>}
        </div>
        {image && (
          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl shadow-lg">
            <Image src={image} alt="" fill sizes="(max-width: 768px) 100vw, 50vw" {...faceCrop(image, 16 / 10)} />
          </div>
        )}
      </div>
    </div>
  );
}
