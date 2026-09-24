import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_REVALIDATE } from '@/lib/catalog';
import {
  normaliseRefCode, canonicalise, canonicalUrl, buildReferralLink,
  stripTrailingSlash, absoluteUrl, REF_PARAM,
} from '@/lib/referral';
import {
  SITE, robotsFor, isPrivatePath, isNoindexFollowPath, pageTitle, metaDescription, buildMetadata,
  productJsonLd, breadcrumbJsonLd, organizationJsonLd, findIncomeClaims,
  assertNoIncomeClaims, type ProductForSeo,
} from '@/lib/seo';

/* ------------------------------------------------------------- referral */

test('a referral code is accepted only in the exact member-code shape', () => {
  assert.equal(normaliseRefCode('MC100002'), 'MC100002');
  assert.equal(normaliseRefCode('mc100002'), 'MC100002');
  assert.equal(normaliseRefCode('  MC100002 '), 'MC100002');

  // Anything else is discarded rather than stored. An unvalidated ref reaches
  // a cookie and, if echoed, the page — a reflected-XSS and cookie-stuffing vector.
  for (const bad of ['', '  ', 'XX100002', 'MC', 'MC<script>', "MC1'||1--", 'MC' + '9'.repeat(50), null, undefined]) {
    assert.equal(normaliseRefCode(bad as string), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the referral parameter is stripped from the canonical URL', () => {
  const r = canonicalise('/product/rose-gold-body-lotion', 'ref=MC100002');
  assert.equal(r.path, '/product/rose-gold-body-lotion');
  assert.equal(r.ref, 'MC100002');
  assert.equal(r.shouldRedirect, true);
});

test('500 members sharing one product still produce one canonical URL', () => {
  // This is the failure mode: without it, a crawler sees 500 near-identical
  // pages and link equity splits across all of them.
  const canonicals = new Set(
    Array.from({ length: 500 }, (_, i) =>
      canonicalUrl('/product/oud-royale', `ref=MC${100002 + i}`, SITE.origin)),
  );
  assert.equal(canonicals.size, 1);
  assert.equal([...canonicals][0], `${SITE.origin}/product/oud-royale`);
});

test('marketing and analytics tags are stripped too', () => {
  const r = canonicalise('/shop', 'utm_source=whatsapp&utm_campaign=diwali&fbclid=abc&gclid=xyz');
  assert.equal(r.path, '/shop');
  assert.equal(r.shouldRedirect, true);
});

test('parameters that genuinely change the page are kept', () => {
  const r = canonicalise('/shop', 'category=makeup&page=2&sort=price');
  assert.equal(r.path, '/shop?category=makeup&page=2&sort=price');
  assert.equal(r.shouldRedirect, false);
});

test('parameter order does not create a second canonical URL', () => {
  const a = canonicalise('/shop', 'sort=price&page=2').path;
  const b = canonicalise('/shop', 'page=2&sort=price').path;
  assert.equal(a, b);
});

test('a clean URL is never redirected, so there is no loop', () => {
  assert.equal(canonicalise('/product/kohl-kajal', '').shouldRedirect, false);
  assert.equal(canonicalise('/', '').shouldRedirect, false);
  assert.equal(canonicalise('/shop', 'page=3').shouldRedirect, false);
});

test('the redirect target is itself already canonical', () => {
  // If the target still needed cleaning, the 308 would bounce forever.
  const first = canonicalise('/shop/', 'ref=MC100002&utm_source=x&page=2');
  const [path, search = ''] = first.path.split('?');
  const second = canonicalise(path, search);
  assert.equal(second.shouldRedirect, false);
  assert.equal(second.path, first.path);
});

test('trailing slashes collapse to one form, and the root survives', () => {
  assert.equal(stripTrailingSlash('/shop/'), '/shop');
  assert.equal(stripTrailingSlash('/shop'), '/shop');
  assert.equal(stripTrailingSlash('/'), '/');
  assert.equal(canonicalise('/shop/', '').shouldRedirect, true);
});

test('a member share link carries the ref while the canonical does not', () => {
  const link = buildReferralLink('/product/oud-royale', 'MC100002', SITE.origin);
  assert.equal(link, `${SITE.origin}/product/oud-royale?${REF_PARAM}=MC100002`);
  assert.equal(canonicalUrl('/product/oud-royale', `${REF_PARAM}=MC100002`, SITE.origin), `${SITE.origin}/product/oud-royale`);
  assert.throws(() => buildReferralLink('/x', 'not-a-code', SITE.origin), /not a valid member code/);
});

test('absolute URLs never double up their slashes', () => {
  assert.equal(absoluteUrl('/shop', 'https://majesticcart.in/'), 'https://majesticcart.in/shop');
  assert.equal(absoluteUrl('shop', 'https://majesticcart.in'), 'https://majesticcart.in/shop');
});

/* ------------------------------------------------------------- indexing */

test('everything behind the login is noindex, nofollow', () => {
  for (const path of ['/wallet', '/orders/OD24088', '/network', '/account', '/admin', '/admin/reports', '/cart', '/api/orders']) {
    const r = robotsFor(path) as { index: boolean; follow: boolean };
    assert.equal(r.index, false, `${path} was indexable`);
    assert.equal(r.follow, false, `${path} was followable`);
    assert.equal(isPrivatePath(path), true);
  }
});

test('search pages are noindex but followable', () => {
  const r = robotsFor('/search?q=lipstick') as { index: boolean; follow: boolean };
  assert.equal(r.index, false); // an infinite query space must never enter the index
  assert.equal(r.follow, true); // but a crawler should walk through to the products
});

test('public storefront pages are indexable', () => {
  for (const path of ['/', '/shop', '/product/oud-royale', '/category/makeup', '/about', '/faq']) {
    const r = robotsFor(path) as { index: boolean };
    assert.equal(r.index, true, `${path} was not indexable`);
    assert.equal(isPrivatePath(path), false);
  }
});

test('a path that merely starts with a private word is not private', () => {
  // "/accountability" is not "/account".
  assert.equal(isPrivatePath('/accountability'), false);
  assert.equal(isPrivatePath('/account'), true);
  assert.equal(isPrivatePath('/account/payout'), true);
});

/* ------------------------------------------------------------- metadata */

test('titles stay inside the SERP limit', () => {
  const short = pageTitle('Kohl Intense Kajal', 'Makeup');
  assert.equal(short, 'Kohl Intense Kajal — Makeup | Majestic Cart');
  assert.ok(short.length <= 60);

  const long = pageTitle('Kumkumadi Night Elixir with Saffron and Sixteen Ayurvedic Herbs', 'Skin Care');
  assert.ok(long.length <= 60, `title was ${long.length} chars`);
  assert.ok(long.includes('Majestic Cart'));
});

test('descriptions are trimmed on a word boundary', () => {
  const d = metaDescription('Deep-moisturising lotion with rose extract, shea butter and a soft gold shimmer that absorbs quickly and leaves absolutely no sticky finish whatsoever on the skin.');
  assert.ok(d.length <= 155);
  assert.ok(d.endsWith('…'));
  assert.equal(d.includes('  '), false);
  assert.equal(/\s…$/.test(d), false); // no space before the ellipsis
});

test('metadata carries a ref-free canonical even when the page was reached with one', () => {
  const meta = buildMetadata({
    title: 'Oud Royale', description: 'A long-lasting oud.',
    pathname: '/product/oud-royale', search: 'ref=MC100002&utm_source=whatsapp',
  });
  assert.equal(meta.alternates?.canonical, `${SITE.origin}/product/oud-royale`);
  assert.equal(String(meta.openGraph?.url), `${SITE.origin}/product/oud-royale`);
});

test('a private page gets noindex metadata regardless of what it passes in', () => {
  const meta = buildMetadata({ title: 'Wallet', description: 'Your wallet', pathname: '/wallet' });
  assert.deepEqual(meta.robots, { index: false, follow: false, nocache: true });
});

/* -------------------------------------------------------- structured data */

const PRODUCT: ProductForSeo = {
  slug: 'oud-royale', sku: 'MC-FR04', name: 'Oud Royale Eau de Parfum',
  description: 'Oud, saffron and amber in a long-lasting eau de parfum.',
  category: 'Fragrance', pricePaise: 159900, mrpPaise: 189900, inStock: true,
  imageUrl: '/img/oud.jpg',
};

test('product markup carries price, availability and currency', () => {
  const ld = productJsonLd(PRODUCT) as any;
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.sku, 'MC-FR04');
  assert.equal(ld.offers.price, '1599.00'); // rupees with decimals, not paise
  assert.equal(ld.offers.priceCurrency, 'INR');
  assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.url, `${SITE.origin}/product/oud-royale`);
  assert.equal(ld.image[0], `${SITE.origin}/img/oud.jpg`);
});

test('out of stock is marked honestly', () => {
  const ld = productJsonLd({ ...PRODUCT, inStock: false }) as any;
  assert.equal(ld.offers.availability, 'https://schema.org/OutOfStock');
});

test('seeded demo ratings never become AggregateRating markup', () => {
  // The catalogue ships with rating and review counts for the demo. Marking
  // those up is fabricated review data under Google's structured data policies,
  // and the penalty is a manual action that strips rich results from the whole
  // domain. The builder refuses rather than trusting each page author.
  const ld = productJsonLd(PRODUCT) as any;
  assert.equal('aggregateRating' in ld, false);
  assert.equal(JSON.stringify(ld).includes('AggregateRating'), false);
});

test('real verified reviews do produce rating markup', () => {
  const ld = productJsonLd({ ...PRODUCT, verifiedReviews: { count: 141, averageRating: 4.8 } }) as any;
  assert.equal(ld.aggregateRating.ratingValue, '4.8');
  assert.equal(ld.aggregateRating.reviewCount, 141);
});

test('a zero or impossible rating is dropped rather than emitted', () => {
  assert.equal('aggregateRating' in (productJsonLd({ ...PRODUCT, verifiedReviews: { count: 0, averageRating: 4.8 } }) as any), false);
  assert.equal('aggregateRating' in (productJsonLd({ ...PRODUCT, verifiedReviews: { count: 5, averageRating: 0 } }) as any), false);
  assert.equal('aggregateRating' in (productJsonLd({ ...PRODUCT, verifiedReviews: { count: 5, averageRating: 7 } }) as any), false);
});

test('breadcrumbs are positioned from one and absolute', () => {
  const ld = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Fragrance', path: '/category/fragrance' },
    { name: 'Oud Royale', path: '/product/oud-royale' },
  ]) as any;
  assert.deepEqual(ld.itemListElement.map((x: any) => x.position), [1, 2, 3]);
  assert.equal(ld.itemListElement[1].item, `${SITE.origin}/category/fragrance`);
});

test('every graph is serialisable, since it is injected as JSON', () => {
  for (const graph of [productJsonLd(PRODUCT), breadcrumbJsonLd([{ name: 'Home', path: '/' }]), organizationJsonLd({ phone: '+919000000000', email: 'care@majesticcart.in' })]) {
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(graph)));
    assert.equal((graph as any)['@context'], 'https://schema.org');
  }
});

/* ------------------------------------------------------ income-claim lint */

test('income claims on public copy are caught', () => {
  const offenders = [
    'Earn ₹50,000 per month with Majestic Cart',
    'Join now and make Rs 25,000 a month from home',
    'Guaranteed income for every new member',
    'Build passive income with our beauty range',
    'Double your money in six months',
    'কমাই করুন ₹40,000 প্রতি মাসে',
  ];
  for (const copy of offenders) {
    assert.ok(findIncomeClaims(copy).length > 0, `missed: ${copy}`);
    assert.throws(() => assertNoIncomeClaims(copy, 'homepage'), /Income claims must not appear/);
  }
});

test('ordinary product and price copy is not flagged', () => {
  const fine = [
    'Rose Gold Radiance Body Lotion, ₹599 including GST',
    'Free delivery on orders above ₹999',
    'Members earn business volume on every delivered order',
    '300 BV per unit',
    'Registering is free. No registration fee.',
  ];
  for (const copy of fine) {
    assert.deepEqual(findIncomeClaims(copy), [], `false positive: ${copy}`);
    assert.doesNotThrow(() => assertNoIncomeClaims(copy, 'product page'));
  }
});

test('the lint names what it found so the fix is obvious', () => {
  const [finding] = findIncomeClaims('Earn ₹50,000 per month');
  assert.match(finding.note, /earnings figure/);
  assert.ok(finding.match.length > 0);
});

/* ------------------------------------------------------ segment config */

/**
 * `export const revalidate` has to be a literal Next can read without running
 * the module, so the value is written out in each page instead of imported
 * from lib/catalog. Duplicated constants drift; this is what stops it.
 */
test('every page revalidate matches CATALOG_REVALIDATE', () => {
  const routes = ['/', '/shop', '/category/[slug]', '/product/[slug]'];

  for (const route of routes) {
    const file = pageFileFor(route);
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    const m = /export const revalidate = (\d+)/.exec(src);
    assert.ok(m, `${file} must declare a revalidate`);
    assert.equal(
      Number(m![1]), CATALOG_REVALIDATE,
      `${file} revalidates every ${m![1]}s but CATALOG_REVALIDATE is ${CATALOG_REVALIDATE}`,
    );
  }
});

test('indexable pages carry no income claims', () => {
  // The per-page assertions run at module load and only cover the pages that
  // declare their copy as data. This sweeps the rendered JSX of every public
  // page as well, so copy written inline cannot slip past.
  const files = [
    ...['/', '/shop', '/join', '/faq', '/about', '/contact', '/category/[slug]'].map(pageFileFor),
    'lib/catalog.ts',
  ];

  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    const findings = findIncomeClaims(src);
    assert.deepEqual(
      findings, [],
      `${file} contains ${findings.map((f) => `${f.note} ("${f.match}")`).join(', ')}`,
    );
  }
});

/* ---------------------------------------------------------- route audit */

/**
 * Every route in the app, against the three lists that decide what leaks.
 *
 * This is the test that would have caught a member page shipped without
 * `noindex` — the kind of mistake with no visible symptom until a wallet
 * balance turns up in a search result, by which time it is in a cache that is
 * not ours to clear.
 *
 * It walks the filesystem rather than a hand-kept list, so a new page is
 * audited by existing, not by someone remembering to add it.
 */
/**
 * Every route in the app, mapped to the file that defines it.
 *
 * Walks the tree rather than taking a list, so route groups can be
 * rearranged — as they were, when the admin console needed a root layout of
 * its own — without these tests going stale and passing vacuously.
 */
function appPages(): Map<string, string> {
  const root = join(process.cwd(), 'app');
  const pages = new Map<string, string>();

  const walk = (dir: string, urlPrefix: string, filePrefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Route groups "(name)" are a file-system concern and never appear in
        // the URL, so they advance the file path and not the route.
        const isGroup = entry.name.startsWith('(');
        walk(
          join(dir, entry.name),
          urlPrefix + (isGroup ? '' : `/${entry.name}`),
          `${filePrefix}/${entry.name}`,
        );
      } else if (entry.name === 'page.tsx') {
        pages.set(urlPrefix === '' ? '/' : urlPrefix, `${filePrefix}/page.tsx`);
      }
    }
  };

  walk(root, '', 'app');
  return pages;
}

const appRoutes = (): string[] => [...appPages().keys()].sort();

/** The file defining a route, or a failed assertion naming the route. */
function pageFileFor(route: string): string {
  const file = appPages().get(route);
  assert.ok(file, `no page.tsx defines ${route}`);
  return file!;
}

/** Routes that must never be indexed. Matched against PRIVATE_PREFIXES. */
const MUST_BE_PRIVATE = [
  '/account', '/wallet', '/wallet/withdraw', '/orders', '/orders/[id]',
  '/network', '/recharge', '/cart', '/checkout', '/id-card', '/statement', '/share', '/autoship', '/support',
  // The console, including its own sign-in page. An indexed admin login is an
  // invitation to credential-stuff it.
  '/admin', '/admin/login',
];

test('every member route is noindex, nofollow', () => {
  for (const route of MUST_BE_PRIVATE) {
    const r = robotsFor(route) as { index: boolean; follow: boolean };
    assert.equal(r.index, false, `${route} must not be indexed`);
    assert.equal(r.follow, false, `${route} must not be followed`);
    assert.ok(isPrivatePath(route), `${route} must match a private prefix`);
  }
});

test('every route in the app is classified, none left to default', () => {
  // A page that is neither public nor private is one nobody decided about.
  const PUBLIC = new Set([
    '/', '/shop', '/about', '/contact', '/faq', '/join', '/signup', '/login',
    '/forgot-password', '/category/[slug]', '/product/[slug]', '/legal/[slug]',
    '/offline',
  ]);

  for (const route of appRoutes()) {
    const classified = PUBLIC.has(route) || isPrivatePath(route) || isNoindexFollowPath(route);
    assert.ok(
      classified,
      `${route} is a new route that nothing classifies — add it to PUBLIC here, or to PRIVATE_PREFIXES in lib/seo.ts`,
    );
  }
});

test('no member route is a static prefix of a public one', () => {
  // "/accountability" must not be caught by the "/account" rule, and
  // "/orders-guide" must not be either. Both directions matter.
  assert.equal(isPrivatePath('/accountability'), false);
  assert.equal(isPrivatePath('/orders-guide'), false);
  assert.equal(isPrivatePath('/cartography'), false);
  assert.equal(isPrivatePath('/networking'), false);

  // ...while the real ones and everything under them still match.
  assert.equal(isPrivatePath('/account'), true);
  assert.equal(isPrivatePath('/orders/abc123'), true);
  assert.equal(isPrivatePath('/wallet?kind=income'), true);
});

test('the service worker never caches a private route', () => {
  // The metadata rule and the service worker rule are written in different
  // files, in different languages, by different mechanisms. This is what keeps
  // them saying the same thing.
  const sw = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
  const block = /const NEVER_CACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, 'NEVER_CACHE list not found in the service worker');

  const patterns = [...block![1].matchAll(/\/\^\\\/([a-z-]+)\\?\/?/g)].map((m) => `/${m[1]}`);

  for (const route of MUST_BE_PRIVATE) {
    const top = `/${route.split('/')[1]}`;
    assert.ok(
      patterns.includes(top),
      `${top} is noindex but the service worker would cache it — add it to NEVER_CACHE in public/sw.js`,
    );
  }
});

test('the sitemap never lists a private route', () => {
  const sitemap = readFileSync(join(process.cwd(), 'app', 'sitemap.ts'), 'utf8');
  for (const prefix of MUST_BE_PRIVATE) {
    assert.ok(
      !sitemap.includes(`'${prefix}'`) && !sitemap.includes(`"${prefix}"`),
      `${prefix} appears in the sitemap and must not`,
    );
  }
});

/* ------------------------------------------------------- admin console */

/**
 * The console's role map against the roles the API actually enforces.
 *
 * `AdminShell` hides nav items and refuses to render a page the current role
 * cannot use. That is a convenience — every route carries its own
 * `@AdminOnly(...)` server-side — but a map that drifts from the server is
 * worse than no map: it either shows a FINANCE user a plan editor that 403s on
 * save, or hides the recharge queue from someone who can in fact use it.
 */
test('the admin nav offers exactly the roles the API accepts', () => {
  const shell = readFileSync(join(process.cwd(), 'components', 'admin', 'AdminShell.tsx'), 'utf8');
  const controller = readFileSync(
    join(process.cwd(), '..', 'backend', 'src', 'api', 'admin.controller.ts'),
    'utf8',
  );

  // Pull `@AdminOnly('A', 'B') @Controller('admin/x')` pairs off the API. A
  // bare @AdminOnly() means any signed-in admin.
  const serverRoles = new Map<string, string[]>();
  const re = /@AdminOnly\(([^)]*)\)\s*@Controller\('([^']+)'\)/g;
  for (const [, roleList, route] of controller.matchAll(re)) {
    const roles = [...roleList.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
    serverRoles.set(`/${route}`, roles.length ? roles : ['ADMIN', 'FINANCE', 'SUPPORT']);
  }
  assert.ok(serverRoles.size > 0, 'found no @AdminOnly controllers to compare against');

  // And the console's own NAV table.
  const navBlock = /const NAV:[^=]*=\s*\[([\s\S]*?)\n\];/.exec(shell);
  assert.ok(navBlock, 'could not find the NAV table in AdminShell');

  const navRoles = new Map<string, string[]>();
  for (const [, href, roleList] of navBlock![1].matchAll(
    /\{\s*href:\s*'([^']+)'[^}]*roles:\s*\[([^\]]*)\]/g,
  )) {
    navRoles.set(href, [...roleList.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]));
  }
  assert.ok(navRoles.size > 0, 'parsed no nav entries');

  for (const [href, offered] of navRoles) {
    // '/admin' maps to the dashboard controller; the rest map by their segment.
    const apiRoute = href === '/admin' ? '/admin/dashboard' : href.replace('/admin/', '/admin/');
    const server = serverRoles.get(apiRoute) ?? serverRoles.get(`${apiRoute}es`) ?? null;
    if (!server) continue; // a nav entry with no single controller behind it

    assert.deepEqual(
      [...offered].sort(), [...server].sort(),
      `${href} is offered to ${offered.join('/')} but the API accepts ${server.join('/')}`,
    );
  }
});

test('every admin page exists under the admin route group', () => {
  // The console needs its own root layout — without it the storefront's header,
  // footer, cart provider and PWA install prompt wrap every admin page, and a
  // cart badge over an approval queue is a page that can be mistaken for the
  // shop.
  const adminPages = [...appPages().entries()].filter(([route]) => route.startsWith('/admin'));
  assert.ok(adminPages.length >= 6, `expected the console's pages, found ${adminPages.length}`);

  for (const [route, file] of adminPages) {
    assert.match(file, /^app\/\(admin\)\//, `${route} is outside the (admin) group, so it inherits the shop layout`);
  }
});

test('the admin group has its own root layout', () => {
  const layout = readFileSync(join(process.cwd(), 'app', '(admin)', 'layout.tsx'), 'utf8');
  assert.match(layout, /<html/, 'the admin group needs a root layout with its own <html>');
  assert.match(layout, /index:\s*false/, 'the admin root layout must set noindex as a second line of defence');

  // And it must not pull in any of the storefront's chrome.
  for (const forbidden of ['Chrome', 'CartProvider', 'InstallPrompt', 'PwaRegister']) {
    assert.ok(
      !layout.includes(forbidden),
      `the admin layout imports ${forbidden}, which belongs to the storefront`,
    );
  }
});
