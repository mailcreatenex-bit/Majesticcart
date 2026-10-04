import { paiseReviver } from './paise';
import { DEFAULT_ENTITY, type EntityInfo } from './legal';

/**
 * Blog, pages and theme settings — editorial content, not the catalogue.
 * Same fail-soft contract as lib/catalog.ts: a content-API outage renders an
 * empty blog or the default theme, never a 500 on the page a crawler hits.
 */

export interface BlogListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: string;
}

export interface BlogPost extends BlogListItem {
  contentHtml: string;
  author: { name: string } | null;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  contentHtml: string;
  updatedAt: string;
}

export interface ThemeSettings {
  colors: { ink: string; accent: string; gold: string };
  logoUrl: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
    imageUrls: string[];
  };
  announcement: {
    enabled: boolean;
    text: string;
    linkLabel: string;
    linkHref: string;
    couponCode: string;
    startsOn: string;
    endsOn: string;
  };
  promoBanner: {
    enabled: boolean;
    images: string[];
    heading: string;
    ctaLabel: string;
    ctaHref: string;
  };
  promoStrip: { images: string[] };
  homeSections: {
    categoriesBg: PlayColorKey;
    categoriesHeading: string;
    featuredBg: PlayColorKey;
    featuredHeading: string;
    aboutBg: PlayColorKey;
    exploreBg: PlayColorKey;
    exploreHeading: string;
    exploreSubtitle: string;
  };
  trustRibbon: [string, string, string];
  trustBadges: [TitleBody, TitleBody, TitleBody];
  pinkBadges: [TitleBody, TitleBody, TitleBody];
  exploreTiles: [TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody];
  aboutUs: { title: string; body: string; images: [string, string] };
  /**
   * The full /about, /join and /faq pages. Admin-editable per the client's
   * explicit choice after being shown the trade-off: these three were kept
   * as hardcoded, lint-checked TypeScript specifically so a build-time check
   * (assertNoIncomeClaims below) could fail the build over an income claim —
   * the same check now runs server-side on every save instead (see
   * backend/src/settings/settings.service.ts's setTheme()), which is the
   * actual enforcement point now that this is runtime-editable.
   */
  aboutPage: {
    lead: string;
    story: string[];
    howItWorks: TitleBody[];
    notThisTitle: string;
    notThis: string[];
  };
  joinPage: {
    lead: string;
    steps: TitleBody[];
    rules: TitleBody[];
    honestTitle: string;
    honestPoints: string[];
    eligibility: string;
  };
  faqPage: { q: string; a: string }[];
  authCopy: {
    introEyebrow: string; introHeading: string; introBody: string;
    loginLead: string;
    signupLead: string; signupDisclaimer: string;
    forgotPasswordLead: string;
  };
  contactPageCopy: { lead: string; careBody: string; grievanceIntro: string; slaText: string; writeBody: string };
  blogPageCopy: { intro: string; emptyState: string };
  memberStorefrontCopy: { body: string; cta: string; rangeHeading: string };
  brandPageCopy: { lead: string; emptyTitle: string; emptyBody: string };
  cartCopy: { emptyState: string; pricingNote: string };
  checkoutCopy: { walletNote: string; incomeWalletNote: string };
  networkCopy: {
    levelsExplainer: string; emptyTitle: string; emptyBody: string;
    incomeDisclaimer: string; inviteIntro: string; storefrontPitch: string;
    shareMessageTemplate: string;
  };
  walletCopy: { shoppingWalletBody: string; incomeWalletBody: string; shoppingEmptyBody: string; incomeEmptyBody: string };
  withdrawCopy: { successNote: string; processingNote: string; goodToKnow: [string, string, string] };
  accountCopy: { payoutNote: string; payoutDisclaimer: string };
  supportCopy: { intro: string };
  idCardCopy: { welcome: string; tagline: string };
  statementCopy: { rejectedNote: string };
  shadeFinderCopy: { intro: string; privacyNote: string };
  autoshipCopy: { intro: string; deliveryNote: string };
  mobileRechargeCopy: { successNote: string; processingNote: string; goodToKnow: [string, string, string] };
  trainingVideos: { title: string; url: string; blurb: string }[];
}

export interface TitleBody {
  title: string;
  body: string;
  image?: string;
}

export const PLAY_COLORS = ['coral', 'teal', 'violet', 'lime', 'pink', 'yellow', 'sky'] as const;
export type PlayColorKey = (typeof PLAY_COLORS)[number];

const DEFAULT_ANNOUNCEMENT: ThemeSettings['announcement'] = {
  enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '',
};

const DEFAULT_PROMO_BANNER: ThemeSettings['promoBanner'] = {
  enabled: true, images: [], heading: '', ctaLabel: '', ctaHref: '/shop',
};

const DEFAULT_PROMO_STRIP: ThemeSettings['promoStrip'] = {
  images: ['/home/promo-banner-1.jpg', '/home/promo-banner-2.jpg', '/home/promo-banner-3.jpg', '/home/promo-banner-4.jpg'],
};

const DEFAULT_HOME_SECTIONS: ThemeSettings['homeSections'] = {
  categoriesBg: 'pink', categoriesHeading: 'Shop by category',
  featuredBg: 'yellow', featuredHeading: 'New this season',
  aboutBg: 'violet',
  exploreBg: 'sky', exploreHeading: 'Explore Majestic Cart',
  exploreSubtitle: 'A quick map of the site — everything below has its own page with more detail.',
};

const DEFAULT_TRUST_RIBBON: ThemeSettings['trustRibbon'] = [
  'Secure wallet payments', 'Authentic brands only', 'Delivered pan-India',
];

const DEFAULT_TRUST_BADGES: ThemeSettings['trustBadges'] = [
  { title: 'Brands you already know', body: 'Everything we sell is made by other established beauty brands. We do not manufacture products or sell under our own brand name.' },
  { title: 'Wallet-based ordering', body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.' },
  { title: 'Delivered across India', body: 'Tracking on every order, and a returns window set out in full in the refund policy.' },
];

const DEFAULT_PINK_BADGES: ThemeSettings['pinkBadges'] = [
  { title: 'Pan-India Delivery', body: 'Tracking on every order, wherever you are.' },
  { title: 'Authentic Products', body: 'Sourced directly from brands and authorised distributors.' },
  { title: 'Easy Returns', body: 'A return window set out in full in the refund policy.' },
];

const DEFAULT_EXPLORE_TILES: ThemeSettings['exploreTiles'] = [
  { title: 'Shop the range', body: 'Makeup, skin care, body care and fragrance — the full catalogue, or browse by category.', image: '/home/explore-shop.jpg' },
  { title: 'AI shade finder', body: 'Upload a selfie and get shade suggestions from the current makeup range.', image: '/home/explore-shade-finder.jpg' },
  { title: 'Wallet & recharge', body: 'Add funds by UPI, track both wallets, or recharge a mobile number instead of buying right now.', image: '/home/explore-wallet.jpg' },
  { title: 'Become a member', body: 'Free to register. What it costs, what is expected, and what you are paid on.', image: '/home/explore-join.jpg' },
  { title: 'Your network', body: 'Your team and your referral link, once you are a member.', image: '/home/explore-network.jpg' },
  { title: 'Your account', body: 'Rank, volume, payout details and order history in one place.', image: '/home/explore-account.jpg' },
  { title: 'Help & policies', body: 'Ordering, delivery, returns and membership — answered plainly, with every policy linked below.', image: '/home/explore-faq.jpg' },
];

const DEFAULT_ABOUT_US: ThemeSettings['aboutUs'] = {
  title: 'About Majestic Cart',
  body: 'Majestic Cart brings beauty and personal-care products from established brands together in one place, and sells them through a network of independent sellers rather than retail shelves. We do not make products or sell under a brand of our own. Here’s how the business works, and just as importantly, what it does not do.',
  images: ['/home/about-1.jpg', '/home/editorial-3.jpg'],
};

const DEFAULT_ABOUT_PAGE: ThemeSettings['aboutPage'] = {
  lead: 'A beauty store built around independent sellers who use the products themselves.',
  story: [
    'Majestic Cart sells beauty and personal-care products made by other established brands — we do not manufacture products or sell under a brand of our own. We sell direct, through members who use the products themselves, because a recommendation from someone who has actually used a serum through a Kolkata summer is worth more than a shelf tag.',
    'Every product carries a business volume, and members earn on what they sell and what their team sells, once the order is delivered. That is the whole model.',
  ],
  howItWorks: [
    { title: 'Joining is free', body: 'No registration fee, no renewal fee, no payment of any kind to become a member. Anyone over 18 resident in India can join.' },
    { title: 'Income comes from selling products', body: 'Nobody earns anything for recruiting a member. Income is paid on products that are sold and delivered, and on nothing else.' },
    { title: 'The plan is published in full', body: 'Every rate, rank and qualification rule is visible in your account. No part of it is discretionary and no part of it is hidden.' },
    { title: 'You can return what you do not sell', body: 'Members can return unsold, resaleable stock under the buy-back policy. Nobody should be left holding inventory they cannot move.' },
  ],
  notThisTitle: 'What this is not',
  notThis: [
    'It is not an investment. Money in a shopping wallet buys products; it earns no interest and is not a deposit.',
    'It is not a way to earn without selling. If nothing is sold, nothing is paid.',
    'There is no guarantee of income. What you make depends on what you and your team actually sell.',
  ],
};

const DEFAULT_JOIN_PAGE: ThemeSettings['joinPage'] = {
  lead: 'Sell products you use yourself. Registering is free. Your first order has a minimum value, and a small monthly purchase keeps your income withdrawable.',
  steps: [
    { title: 'Sign up with a referral ID', body: 'Someone already selling sends you their invite link, or shares their Referral ID. You sign up with it, verify your mobile number, and you are a member. It takes about two minutes and registering costs nothing.' },
    { title: 'Add money to your shopping wallet', body: 'Orders are paid from a shopping wallet, not a card. You transfer by UPI to the account shown on the recharge page, upload the payment reference, and the amount is credited once our team has checked it against the bank statement.' },
    { title: 'Order products and sell them', body: 'You buy at member price and sell to your own customers. Every product carries a business volume, shown on its page before you buy.' },
    { title: 'Build a team, if you want to', body: 'You can sponsor other sellers. Sponsors earn a direct income when someone they sponsored makes a first product purchase, and further income on the products their team buys. Nothing is paid just for signing someone up.' },
  ],
  rules: [
    { title: 'Joining is free, and always will be', body: 'Registering is free: no registration fee, no renewal fee, no training fee, no compulsory kit. If anyone asks you to pay to join or to stay a member, report it to the grievance officer — it is a breach of our policy and of the Direct Selling Rules.' },
    { title: 'Nobody is paid for recruiting', body: 'Nothing is paid for signing someone up. Every payment in the plan is calculated on products that have been purchased. A member who never sponsors anyone can still be paid in full on their own purchases.' },
    { title: 'A minimum first order, and a monthly purchase to withdraw', body: 'To earn, a member places a first order of at least the minimum value in the plan. The monthly repurchase target applies only to withdrawing income; it never removes you or your team. Both are stated in the plan in your account, and both are purchases of products you keep, never fees.' },
    { title: 'Unsold stock can be returned', body: 'Resaleable stock in its original condition can be returned under the buy-back policy within the stated window. You should never be left holding inventory you cannot move.' },
    { title: 'You can leave whenever you like', body: 'Membership can be cancelled at any time, in writing, with no penalty and no notice period.' },
  ],
  honestTitle: 'What this is not',
  honestPoints: [
    'It is not an investment. Money in a shopping wallet buys products. It earns no interest, it is not a deposit, and it is not returnable as cash.',
    'It is not income without selling. If nothing is sold, nothing is paid — to you or to anyone above you.',
    'It is not guaranteed. What a member makes depends entirely on what they and their team sell, and most people who join direct selling sell very little.',
    'It is not full-time work. Treat it as something you do alongside what you already do, not instead of it.',
  ],
  eligibility: 'You must be 18 or over and resident in India. You will need a mobile number, a PAN for payouts above the TDS threshold, and a bank account or UPI ID in your own name. Payouts are only ever made to an account in the member’s own name.',
};

const DEFAULT_FAQ_PAGE: ThemeSettings['faqPage'] = [
  { q: 'Why can I not pay by card at checkout?', a: 'Orders are paid from your shopping wallet rather than card by card. You add money to the wallet once by UPI, our team verifies the payment against the bank statement, and the balance is then available for any order. It means no card details are ever stored on the site, and it gives every member a single statement of what they have put in and what they have spent.' },
  { q: 'How do I add money to my wallet?', a: 'Open the recharge page, transfer the amount by UPI to the account shown there, and submit the UTR reference number from your UPI app together with a screenshot of the payment. You will see the request marked as pending until it is checked.' },
  { q: 'How long does a wallet recharge take to be approved?', a: 'Most are checked within a few working hours. Every request is verified by hand against the bank statement before it is credited, so it is never instant. If yours is still pending after one working day, contact customer care with the UTR.' },
  { q: 'What happens if my recharge is rejected?', a: 'Nothing is deducted — a rejected request never credits the wallet, and the money stays where it was. The reason is shown on the request itself. The usual causes are a UTR that does not match any payment received, an amount different from the one claimed, or a screenshot that has already been used.' },
  { q: 'Can I take money back out of my shopping wallet?', a: 'No. The shopping wallet buys products and cannot be withdrawn as cash. Income earned on sales goes to a separate income wallet, and that one can be withdrawn to your bank account. Only add to the shopping wallet what you intend to spend on products.' },
  { q: 'When will my order arrive?', a: 'Orders are dispatched within two working days and usually arrive within three to seven working days depending on the PIN code. You will get a tracking reference once it ships, and the order page shows every status change.' },
  { q: 'Can I return a product?', a: 'Sealed, unused products can be returned within the window set out in the refund policy. Opened cosmetics cannot be returned for hygiene reasons unless they arrived damaged or are faulty, in which case we replace or refund them. Damaged deliveries should be reported within 48 hours with photographs.' },
  { q: 'Does it cost anything to become a member?', a: 'Registering is free, and there is no renewal fee. To earn, you place a first order of at least the minimum value in the compensation plan; that is a purchase of products you keep, never a fee. If anyone asks you to pay to join, report it to the grievance officer.' },
  { q: 'Do I get paid for signing people up?', a: 'No. Nothing in the plan pays for recruitment. Every payment is calculated on products that have been sold and delivered.' },
  { q: 'Where can I see the compensation plan?', a: 'In full inside your account, once you have signed up. Every rate, rank and qualification rule is published there, along with the income distribution across all members.' },
  { q: 'How do I cancel my membership?', a: 'Write to us from your registered email or contact customer care. There is no penalty and no notice period. Any balance in your income wallet can be withdrawn subject to the conditions in the plan.' },
  { q: 'Who do I contact if something goes wrong?', a: 'Contact customer care by phone or email, shown in the footer of every page. If a complaint is not resolved to your satisfaction, the grievance officer’s details are also in the footer and a response is due within 48 hours.' },
];

function mergeTuple<N extends readonly TitleBody[]>(defaults: N, stored: readonly Partial<TitleBody>[] | undefined): N {
  return defaults.map((d, i) => ({ ...d, ...stored?.[i] })) as unknown as N;
}

const DEFAULT_AUTH_COPY: ThemeSettings['authCopy'] = {
  introEyebrow: 'Beauty from brands you know',
  introHeading: 'Beauty brands you love,\nunder one roof',
  introBody: 'Shop makeup, skin care, body care and fragrance from brands you already trust — Lakmé, Lotus Herbals, Pond’s, Dot & Key, Himalaya and more — delivered to your door.',
  loginLead: 'Log in to shop from your wallet and follow your team.',
  signupLead: 'Free to register. No registration fee.',
  signupDisclaimer: 'Income is earned only on products sold and delivered. We make no guarantee of earnings.',
  forgotPasswordLead: 'We will send a one-time code to your registered email address.',
};

const DEFAULT_CONTACT_PAGE_COPY: ThemeSettings['contactPageCopy'] = {
  lead: 'Real people, reachable during business hours. Every complaint gets an acknowledgement.',
  careBody: 'Orders, delivery, returns and wallet questions.',
  grievanceIntro: 'If customer care has not resolved your issue, escalate here.',
  slaText: 'Acknowledged within 48 hours and resolved within one month, as required by the Consumer Protection (E-Commerce) Rules, 2020.',
  writeBody: 'Ask a question or raise a complaint. You get a reference number, and we acknowledge it within 48 hours. Members can also do this from the Support tab in their account, where the replies appear.',
};

const DEFAULT_BLOG_PAGE_COPY: ThemeSettings['blogPageCopy'] = {
  intro: 'Skin care guidance, ingredient explainers and product updates from Majestic Cart.',
  emptyState: 'Nothing published yet. Check back soon.',
};

const DEFAULT_MEMBER_STOREFRONT_COPY: ThemeSettings['memberStorefrontCopy'] = {
  body: 'Every order placed here is on {name}’s recommendation. Wallet, delivery and returns work exactly as they do anywhere else on the site.',
  cta: 'Want to sell like {name}? See how to join →',
  rangeHeading: 'The full range',
};

const DEFAULT_BRAND_PAGE_COPY: ThemeSettings['brandPageCopy'] = {
  lead: 'The full {name} range, sold direct through Majestic Cart.',
  emptyTitle: '{name} products are on their way',
  emptyBody: 'We carry {name}, but nothing is listed just yet. Have a look at the rest of the range.',
};

const DEFAULT_CART_COPY: ThemeSettings['cartCopy'] = {
  emptyState: 'Nothing here yet. Have a look at what is in stock.',
  pricingNote: 'GST and delivery are calculated at checkout, once the delivery address is chosen. Prices shown are from when each item was added and are confirmed again before you pay.',
};

const DEFAULT_CHECKOUT_COPY: ThemeSettings['checkoutCopy'] = {
  walletNote: 'Orders are paid from your shopping wallet. There is no card payment on this site.',
  incomeWalletNote: 'Income wallet: {amount} — withdrawable to your bank, not spendable here.',
};

const DEFAULT_NETWORK_COPY: ThemeSettings['networkCopy'] = {
  levelsExplainer: 'Level 1 is the people you sponsored. Level 2 is the people they sponsored, and so on.',
  emptyTitle: 'Nobody yet',
  emptyBody: 'Share your referral link with anyone who wants to sell the products. They will appear here once they sign up.',
  incomeDisclaimer: 'Earnings are not shown here — neither yours nor anyone else’s. Your own income is in your wallet statement; what the people in your team earn is theirs to share or not.',
  inviteIntro: 'Anyone who signs up through your link or with your ID joins your team. Joining is free.',
  storefrontPitch: 'A full page with your name on it, not just a tracked link — better for a WhatsApp status or a bio link.',
  shareMessageTemplate: 'Join Majestic Cart and shop with me — sign up with my ID {code}',
};

const DEFAULT_WALLET_COPY: ThemeSettings['walletCopy'] = {
  shoppingWalletBody: 'Funded by UPI payments you submit for approval. Spends on orders — or on a mobile recharge, if you’d rather not shop right now. Cannot be withdrawn as cash.',
  incomeWalletBody: 'Earned on orders that have been delivered. Withdraws to your bank account, or moves into your shopping wallet.',
  shoppingEmptyBody: 'Once a recharge is approved it will appear here, along with every order it pays for.',
  incomeEmptyBody: 'Income appears here once an order you or your team placed has been delivered.',
};

const DEFAULT_WITHDRAW_COPY: ThemeSettings['withdrawCopy'] = {
  successNote: '{amount} will be transferred to your account. The amount has been held from your income wallet already, so it cannot be spent twice while the transfer is processed.',
  processingNote: 'Withdrawals are checked and paid by our team. The amount is held from your wallet as soon as you request it, so it cannot be spent twice while it is processed.',
  goodToKnow: [
    'Payouts go only to an account in your own name.',
    'Your shopping wallet cannot be withdrawn — it buys products only.',
    'TDS is deducted where it applies, and shown on your statement.',
  ],
};

const DEFAULT_ACCOUNT_COPY: ThemeSettings['accountCopy'] = {
  payoutNote: 'Where income withdrawals are sent. Must be an account in your own name.',
  payoutDisclaimer: 'Payouts are only made to an account in the member’s own name. An account that already belongs to another member will be refused.',
};

const DEFAULT_SUPPORT_COPY: ThemeSettings['supportCopy'] = {
  intro: 'Ask a question or raise a complaint. We acknowledge every ticket within 48 hours and aim to resolve it within a month.',
};

const DEFAULT_ID_CARD_COPY: ThemeSettings['idCardCopy'] = {
  welcome: 'Welcome to Majestic Cart! Add your photo below and your ID card is ready to print.',
  tagline: 'Unlocked by what you have achieved.',
};

const DEFAULT_STATEMENT_COPY: ThemeSettings['statementCopy'] = {
  rejectedNote: 'Rejected withdrawals are returned to your wallet and are not counted in the totals.',
};

const DEFAULT_SHADE_FINDER_COPY: ThemeSettings['shadeFinderCopy'] = {
  intro: 'A clear photo in good light — front-facing, no filter — works best.',
  privacyNote: 'Your photo is analysed and then discarded; it is never saved.',
};

const DEFAULT_AUTOSHIP_COPY: ThemeSettings['autoshipCopy'] = {
  intro: 'Pick what you buy every month and the day you want it. On that day the order is placed from your shopping wallet, exactly like an order you place yourself - so it counts toward your monthly target{targetClause}. If your wallet is short, nothing is charged and we let you know.',
  deliveryNote: 'Delivered to your saved address. Prices include GST; the order is priced on the day. Add money to your shopping wallet before the day so the order can be paid.',
};

const DEFAULT_MOBILE_RECHARGE_COPY: ThemeSettings['mobileRechargeCopy'] = {
  successNote: '{amount} has been held from your shopping wallet to recharge {number}. It usually completes within a few hours — you’ll get a notification either way.',
  processingNote: 'The amount is held from your shopping wallet the moment you submit. If we can’t complete the recharge, it goes straight back to your wallet.',
  goodToKnow: [
    'This spends your shopping wallet — the same balance an order would spend.',
    '₹10 minimum, ₹5,000 maximum per recharge, one in progress at a time.',
    'Recharges are fulfilled by our team, usually within a few hours.',
  ],
};

const DEFAULT_THEME: ThemeSettings = {
  colors: { ink: '#341316', accent: '#B84654', gold: '#D9B25A' },
  logoUrl: '',
  hero: {
    eyebrow: 'Beauty from brands you know',
    title: 'Beauty brands you love,\nunder one roof',
    subtitle: 'Shop makeup, skin care, body care and fragrance from brands you already trust — Lakmé, Lotus Herbals, Pond’s, Dot & Key, Himalaya and more — delivered to your door.',
    primaryCtaLabel: 'Shop Now',
    primaryCtaHref: '/shop',
    secondaryCtaLabel: 'Become a member',
    secondaryCtaHref: '/join',
    imageUrls: [],
  },
  announcement: DEFAULT_ANNOUNCEMENT,
  promoBanner: DEFAULT_PROMO_BANNER,
  promoStrip: DEFAULT_PROMO_STRIP,
  homeSections: DEFAULT_HOME_SECTIONS,
  trustRibbon: DEFAULT_TRUST_RIBBON,
  trustBadges: DEFAULT_TRUST_BADGES,
  pinkBadges: DEFAULT_PINK_BADGES,
  exploreTiles: DEFAULT_EXPLORE_TILES,
  aboutUs: DEFAULT_ABOUT_US,
  aboutPage: DEFAULT_ABOUT_PAGE,
  joinPage: DEFAULT_JOIN_PAGE,
  faqPage: DEFAULT_FAQ_PAGE,
  authCopy: DEFAULT_AUTH_COPY,
  contactPageCopy: DEFAULT_CONTACT_PAGE_COPY,
  blogPageCopy: DEFAULT_BLOG_PAGE_COPY,
  memberStorefrontCopy: DEFAULT_MEMBER_STOREFRONT_COPY,
  brandPageCopy: DEFAULT_BRAND_PAGE_COPY,
  cartCopy: DEFAULT_CART_COPY,
  checkoutCopy: DEFAULT_CHECKOUT_COPY,
  networkCopy: DEFAULT_NETWORK_COPY,
  walletCopy: DEFAULT_WALLET_COPY,
  withdrawCopy: DEFAULT_WITHDRAW_COPY,
  accountCopy: DEFAULT_ACCOUNT_COPY,
  supportCopy: DEFAULT_SUPPORT_COPY,
  idCardCopy: DEFAULT_ID_CARD_COPY,
  statementCopy: DEFAULT_STATEMENT_COPY,
  shadeFinderCopy: DEFAULT_SHADE_FINDER_COPY,
  autoshipCopy: DEFAULT_AUTOSHIP_COPY,
  mobileRechargeCopy: DEFAULT_MOBILE_RECHARGE_COPY,
  trainingVideos: [],
};

const API = () => {
  const origin = process.env.API_ORIGIN;
  return origin ? `${origin}/api` : '';
};

const REVALIDATE = 3600;

async function getJson<T>(path: string): Promise<T | null> {
  const origin = API();
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}${path}`, { next: { revalidate: REVALIDATE, tags: ['content'] } });
    if (!res.ok) return null;
    return JSON.parse(await res.text(), paiseReviver) as T;
  } catch {
    return null;
  }
}

export async function listBlogPosts(): Promise<BlogListItem[]> {
  const data = await getJson<{ items: BlogListItem[] }>('/blog');
  return data?.items ?? [];
}

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  return getJson<BlogPost>(`/blog/${encodeURIComponent(slug)}`);
}

export async function getCmsPage(slug: string): Promise<CmsPage | null> {
  return getJson<CmsPage>(`/pages/${encodeURIComponent(slug)}`);
}

/** Always resolves — falls back to the built-in copy so the homepage never has a "theme API is down" state. */
export async function getTheme(): Promise<ThemeSettings> {
  const t = await getJson<ThemeSettings>('/theme');
  if (!t) return DEFAULT_THEME;
  const hero = { ...DEFAULT_THEME.hero, ...t.hero };

  // The console's Theme page was saved with the original launch copy, which
  // describes Majestic Cart as the maker of its own products. It sells other
  // brands' products and makes none, so that wording is treated as unset and
  // the current default shows instead. Anything an admin writes afterwards is
  // left exactly as saved.
  const stale = {
    eyebrow: /^made in india$/i,
    title: /formulated for indian skin/i,
    subtitle: /glow botanics|urban skin co|formulated|developed for indian/i,
  } as const;
  for (const key of ['eyebrow', 'title', 'subtitle'] as const) {
    if (stale[key].test(hero[key])) hero[key] = DEFAULT_THEME.hero[key];
  }

  return {
    colors: { ...DEFAULT_THEME.colors, ...t.colors },
    logoUrl: t.logoUrl ?? '',
    hero,
    announcement: { ...DEFAULT_ANNOUNCEMENT, ...t.announcement },
    promoBanner: { ...DEFAULT_PROMO_BANNER, ...t.promoBanner },
    // Defensively merged the same way as the fields above: a backend that
    // hasn't been redeployed with these newer settings yet returns a `theme`
    // payload with these keys simply missing, not present-but-empty.
    promoStrip: { ...DEFAULT_PROMO_STRIP, ...t.promoStrip },
    homeSections: { ...DEFAULT_HOME_SECTIONS, ...t.homeSections },
    trustRibbon: DEFAULT_TRUST_RIBBON.map((d, i) => t.trustRibbon?.[i] ?? d) as ThemeSettings['trustRibbon'],
    trustBadges: mergeTuple(DEFAULT_TRUST_BADGES, t.trustBadges),
    pinkBadges: mergeTuple(DEFAULT_PINK_BADGES, t.pinkBadges),
    exploreTiles: mergeTuple(DEFAULT_EXPLORE_TILES, t.exploreTiles),
    aboutUs: { ...DEFAULT_ABOUT_US, ...t.aboutUs },
    aboutPage: { ...DEFAULT_ABOUT_PAGE, ...t.aboutPage },
    joinPage: { ...DEFAULT_JOIN_PAGE, ...t.joinPage },
    faqPage: t.faqPage && t.faqPage.length > 0 ? t.faqPage : DEFAULT_FAQ_PAGE,
    authCopy: { ...DEFAULT_AUTH_COPY, ...t.authCopy },
    contactPageCopy: { ...DEFAULT_CONTACT_PAGE_COPY, ...t.contactPageCopy },
    blogPageCopy: { ...DEFAULT_BLOG_PAGE_COPY, ...t.blogPageCopy },
    memberStorefrontCopy: { ...DEFAULT_MEMBER_STOREFRONT_COPY, ...t.memberStorefrontCopy },
    brandPageCopy: { ...DEFAULT_BRAND_PAGE_COPY, ...t.brandPageCopy },
    cartCopy: { ...DEFAULT_CART_COPY, ...t.cartCopy },
    checkoutCopy: { ...DEFAULT_CHECKOUT_COPY, ...t.checkoutCopy },
    networkCopy: { ...DEFAULT_NETWORK_COPY, ...t.networkCopy },
    walletCopy: { ...DEFAULT_WALLET_COPY, ...t.walletCopy },
    withdrawCopy: {
      ...DEFAULT_WITHDRAW_COPY, ...t.withdrawCopy,
      goodToKnow: DEFAULT_WITHDRAW_COPY.goodToKnow.map((d, i) => t.withdrawCopy?.goodToKnow?.[i] ?? d) as ThemeSettings['withdrawCopy']['goodToKnow'],
    },
    accountCopy: { ...DEFAULT_ACCOUNT_COPY, ...t.accountCopy },
    supportCopy: { ...DEFAULT_SUPPORT_COPY, ...t.supportCopy },
    idCardCopy: { ...DEFAULT_ID_CARD_COPY, ...t.idCardCopy },
    statementCopy: { ...DEFAULT_STATEMENT_COPY, ...t.statementCopy },
    shadeFinderCopy: { ...DEFAULT_SHADE_FINDER_COPY, ...t.shadeFinderCopy },
    autoshipCopy: { ...DEFAULT_AUTOSHIP_COPY, ...t.autoshipCopy },
    mobileRechargeCopy: {
      ...DEFAULT_MOBILE_RECHARGE_COPY, ...t.mobileRechargeCopy,
      goodToKnow: DEFAULT_MOBILE_RECHARGE_COPY.goodToKnow.map((d, i) => t.mobileRechargeCopy?.goodToKnow?.[i] ?? d) as ThemeSettings['mobileRechargeCopy']['goodToKnow'],
    },
    trainingVideos: Array.isArray(t.trainingVideos) ? t.trainingVideos : [],
  };
}

/**
 * The business's legal identity and support/grievance contact details —
 * admin-editable (Settings > Company), read by the contact page, the
 * footer, the FAQ, the homepage's structured data, and the Terms/Privacy
 * legal documents. Falls back to the same DEFAULT_ENTITY the legal-document
 * build-time audit checks, so a content-API outage never breaks a page that
 * is legally required to show this information.
 */
export async function getCompanyInfo(): Promise<EntityInfo> {
  const c = await getJson<EntityInfo>('/company');
  if (!c) return DEFAULT_ENTITY;
  return {
    ...DEFAULT_ENTITY,
    ...c,
    grievanceOfficer: { ...DEFAULT_ENTITY.grievanceOfficer, ...c.grievanceOfficer },
  };
}
