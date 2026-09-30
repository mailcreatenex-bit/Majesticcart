import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encryptField, decryptField, ctx } from '../common/crypto';
import { upiQrSvg, VPA_RE } from '../recharge/upi-qr';
import { assertNoIncomeClaims } from '../common/income-claims';

/**
 * Generic settings the store owner configures rather than a developer —
 * currently just the AI shade-finder's key, but `StoreSetting` (key/value,
 * already in the schema, never previously written to) is meant for more than
 * one of these.
 *
 * The Gemini key is the client's own, entered from the admin console, not
 * ours: we never ship a bundled key. Storing it encrypted, the same way a
 * member's bank details are stored, isn't optional for an API key sitting in
 * the database — the encryption machinery already existed for exactly this
 * class of secret, so this reuses it rather than inventing a second way to
 * keep a secret at rest.
 */

const SETTING_KEY = 'ai';
const PAYMENT_SETTING_KEY = 'payment';
const THEME_SETTING_KEY = 'theme';

interface AiSettingValue {
  geminiKeyEncrypted: string;
  /** Last 4 characters only, so the console can show *something* without the admin ever seeing the key again after saving it. */
  last4: string;
  updatedById: string;
}

/**
 * What a member sees on the recharge screen: RechargeService.payInfo() reads
 * exactly these field names off `StoreSetting` key `'payment'`. Not a secret
 * — a UPI ID is already shown to every member who opens that page — so
 * unlike the Gemini key this is stored in plain JSON, not encrypted.
 */
export interface PaymentSettingValue {
  upiId: string;
  payeeName: string;
  minRechargePaise: string;
  maxRechargePaise: string;
  note: string;
}

const DEFAULT_PAYMENT: PaymentSettingValue = {
  upiId: '',
  payeeName: 'Majestic Cart',
  minRechargePaise: '50000',
  maxRechargePaise: '10000000',
  note: 'Scan the QR with any UPI app and pay the exact amount. Then enter the 12-digit UTR and upload the payment screenshot.',
};

/**
 * What "edit any colour, text or image on the frontend" actually is: a fixed
 * set of the site's own brand colours and its homepage hero copy/image,
 * editable from the console and read by the storefront at request time —
 * not a live WYSIWYG overlay on the page itself. That would mean tracking
 * arbitrary DOM edits back to source, which is a different (and much
 * larger) project; this gets an owner real control over the handful of
 * things that actually vary between "look at our site" conversations
 * (colours, the hero, the logo) without it.
 */
export interface ThemeSettingValue {
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
    /** Auto-rotating on the homepage when there's more than one; empty falls back to the storefront's own stock photos. */
    imageUrls: string[];
  };
  /** A strip across the top of the storefront for a festival or an offer. Off until an admin turns it on. */
  announcement: {
    enabled: boolean;
    text: string;
    linkLabel: string;
    linkHref: string;
    /** Optional coupon code shown as a chip, so the offer and its code sit together. */
    couponCode: string;
    /** ISO dates (YYYY-MM-DD) bounding when it shows; blank means no bound. */
    startsOn: string;
    endsOn: string;
  };
  /** The full-width photo banner between the brand grid and the featured products. */
  promoBanner: {
    enabled: boolean;
    images: string[];
    heading: string;
    ctaLabel: string;
    ctaHref: string;
  };
  /** The row of up to four square lifestyle banners just under the brand carousel. */
  promoStrip: {
    images: string[];
  };
  /**
   * One of the site's five-then-seven "playful" accent colours (see
   * web/app/globals.css) — a closed set rather than a free hex field, so a
   * section always lands on a colour the rest of the palette already uses —
   * plus each section's own heading text.
   */
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
  /** The three short labels on the solid-colour strip just under the category grid. Plain marketing copy, not a claim about the business, so it carries no income-claim risk. */
  trustRibbon: [string, string, string];
  /** The three cards on the dark "how this works" strip near the footer. Icon and colour per card are fixed in the frontend; only the words are editable here. */
  trustBadges: [TitleBody, TitleBody, TitleBody];
  /** The pink circular badges above the fraud notice. Only the first three are editable — the fourth always shows the catalogue's live brand/product counts, never a typed-in number. */
  pinkBadges: [TitleBody, TitleBody, TitleBody];
  /** The seven photo tiles under "Explore Majestic Cart". Each tile's link is fixed in the frontend (they point at real app pages) — only the words and photo are editable. */
  exploreTiles: [TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody];
  /** The "About Majestic Cart" strip: two photos beside a heading and a paragraph. */
  aboutUs: {
    title: string;
    body: string;
    images: [string, string];
  };
  /**
   * The full /about, /join and /faq pages. These were the site's three
   * highest legal-risk pages — hardcoded specifically so a build-time check
   * (web/lib/seo.ts's assertNoIncomeClaims) could fail the build if an
   * income claim ever crept in, which is what India's Direct Selling Rules
   * require these particular pages to stay clean of. Making them
   * admin-editable moves that check to save time instead (see setTheme()
   * below) — the client's explicit choice, made after being shown the
   * trade-off, since the alternative is these three pages staying
   * code-only forever while everything else is admin-editable.
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
}

interface TitleBody {
  title: string;
  body: string;
  /** Only meaningful on the "About" tiles' cover photos; ignored elsewhere. */
  image?: string;
}

export const PLAY_COLORS = ['coral', 'teal', 'violet', 'lime', 'pink', 'yellow', 'sky'] as const;
export type PlayColorKey = (typeof PLAY_COLORS)[number];

const DEFAULT_ANNOUNCEMENT: ThemeSettingValue['announcement'] = {
  enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '',
};

const DEFAULT_PROMO_BANNER: ThemeSettingValue['promoBanner'] = {
  enabled: true, images: [], heading: '', ctaLabel: '', ctaHref: '/shop',
};

const DEFAULT_PROMO_STRIP: ThemeSettingValue['promoStrip'] = {
  images: ['/home/promo-banner-1.jpg', '/home/promo-banner-2.jpg', '/home/promo-banner-3.jpg', '/home/promo-banner-4.jpg'],
};

const DEFAULT_HOME_SECTIONS: ThemeSettingValue['homeSections'] = {
  categoriesBg: 'pink', categoriesHeading: 'Shop by category',
  featuredBg: 'yellow', featuredHeading: 'New this season',
  aboutBg: 'violet',
  exploreBg: 'sky', exploreHeading: 'Explore Majestic Cart',
  exploreSubtitle: 'A quick map of the site — everything below has its own page with more detail.',
};

const DEFAULT_TRUST_RIBBON: ThemeSettingValue['trustRibbon'] = [
  'Secure wallet payments', 'Authentic brands only', 'Delivered pan-India',
];

const DEFAULT_TRUST_BADGES: ThemeSettingValue['trustBadges'] = [
  { title: 'Brands you already know', body: 'Everything we sell is made by other established beauty brands. We do not manufacture products or sell under our own brand name.' },
  { title: 'Wallet-based ordering', body: 'Add funds to your wallet by UPI, and every order draws from that balance — or recharge your own mobile number if you change your mind about shopping. No card details ever touch the site.' },
  { title: 'Delivered across India', body: 'Tracking on every order, and a returns window set out in full in the refund policy.' },
];

const DEFAULT_PINK_BADGES: ThemeSettingValue['pinkBadges'] = [
  { title: 'Pan-India Delivery', body: 'Tracking on every order, wherever you are.' },
  { title: 'Authentic Products', body: 'Sourced directly from brands and authorised distributors.' },
  { title: 'Easy Returns', body: 'A return window set out in full in the refund policy.' },
];

const DEFAULT_EXPLORE_TILES: ThemeSettingValue['exploreTiles'] = [
  { title: 'Shop the range', body: 'Makeup, skin care, body care and fragrance — the full catalogue, or browse by category.', image: '/home/explore-shop.jpg' },
  { title: 'AI shade finder', body: 'Upload a selfie and get shade suggestions from the current makeup range.', image: '/home/explore-shade-finder.jpg' },
  { title: 'Wallet & recharge', body: 'Add funds by UPI, track both wallets, or recharge a mobile number instead of buying right now.', image: '/home/explore-wallet.jpg' },
  { title: 'Become a member', body: 'Free to register. What it costs, what is expected, and what you are paid on.', image: '/home/explore-join.jpg' },
  { title: 'Your network', body: 'Your team and your referral link, once you are a member.', image: '/home/explore-network.jpg' },
  { title: 'Your account', body: 'Rank, volume, payout details and order history in one place.', image: '/home/explore-account.jpg' },
  { title: 'Help & policies', body: 'Ordering, delivery, returns and membership — answered plainly, with every policy linked below.', image: '/home/explore-faq.jpg' },
];

const DEFAULT_ABOUT_US: ThemeSettingValue['aboutUs'] = {
  title: 'About Majestic Cart',
  body: 'Majestic Cart brings beauty and personal-care products from established brands together in one place, and sells them through a network of independent sellers rather than retail shelves. We do not make products or sell under a brand of our own. Here’s how the business works, and just as importantly, what it does not do.',
  images: ['/home/about-1.jpg', '/home/editorial-3.jpg'],
};

const DEFAULT_ABOUT_PAGE: ThemeSettingValue['aboutPage'] = {
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

const DEFAULT_JOIN_PAGE: ThemeSettingValue['joinPage'] = {
  lead: 'Sell products you use yourself. Registering is free. Your first order has a minimum value, and a small monthly purchase keeps your income withdrawable.',
  steps: [
    { title: 'Sign up with a sponsor ID', body: 'Someone already selling shares their member ID with you. You sign up with it, verify your mobile number, and you are a member. It takes about two minutes and registering costs nothing.' },
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

const DEFAULT_FAQ_PAGE: ThemeSettingValue['faqPage'] = [
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

const DEFAULT_THEME: ThemeSettingValue = {
  colors: { ink: '#341316', accent: '#B84654', gold: '#D9B25A' },
  logoUrl: '',
  hero: {
    eyebrow: 'Made in India',
    title: 'Luxury beauty,\nformulated for Indian skin',
    subtitle: 'Colour cosmetics, skin care, body care and fragrance — developed for Indian undertones and Indian weather, and delivered direct to your door.',
    primaryCtaLabel: 'Shop the range',
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
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Merges a saved array over its default item-by-item, so a row saved before a tile existed still yields the right length instead of `undefined` entries. */
function mergeTuple<N extends readonly TitleBody[]>(defaults: N, stored: readonly Partial<TitleBody>[] | undefined): N {
  return defaults.map((d, i) => ({ ...d, ...stored?.[i] })) as unknown as N;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Safe to return to the console: never the key itself. */
  async aiStatus(): Promise<{ configured: boolean; last4: string | null }> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: SETTING_KEY } });
    const value = row?.value as AiSettingValue | undefined;
    return { configured: !!value?.geminiKeyEncrypted, last4: value?.last4 ?? null };
  }

  async setGeminiKey(apiKey: string, adminId: string): Promise<void> {
    const key = apiKey.trim();
    // Loose shape check only — Google's own key format isn't a stable public
    // contract to validate against, and the real test is the first live call.
    if (key.length < 20 || /\s/.test(key)) {
      throw new BadRequestException('That doesn\'t look like a Gemini API key.');
    }
    const value: AiSettingValue = {
      geminiKeyEncrypted: encryptField(key, ctx.storeSetting(SETTING_KEY)),
      last4: key.slice(-4),
      updatedById: adminId,
    };
    await this.prisma.storeSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: value as never },
      update: { value: value as never },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'settings.ai.setKey', detail: { last4: value.last4 } },
    });
  }

  async clearGeminiKey(adminId: string): Promise<void> {
    await this.prisma.storeSetting.deleteMany({ where: { key: SETTING_KEY } });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'settings.ai.clearKey', detail: {} },
    });
  }

  /**
   * Internal use only — never exposed on any controller response. Throws
   * rather than returning null so every caller is forced to handle "no key
   * configured" as an explicit case instead of quietly calling Gemini with
   * `undefined` and getting a confusing HTTP error back from Google instead.
   */
  async requireGeminiKey(): Promise<string> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: SETTING_KEY } });
    const value = row?.value as AiSettingValue | undefined;
    if (!value?.geminiKeyEncrypted) {
      throw new BadRequestException('AI features are not set up yet. Ask an admin to add a Gemini API key under Settings.');
    }
    return decryptField(value.geminiKeyEncrypted, ctx.storeSetting(SETTING_KEY));
  }

  /** What the console's Payment settings form shows and edits. */
  async paymentSettings(): Promise<PaymentSettingValue> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: PAYMENT_SETTING_KEY } });
    return { ...DEFAULT_PAYMENT, ...(row?.value as Partial<PaymentSettingValue> | undefined) };
  }

  /**
   * The exact QR a member would be shown right now, so the admin can check it
   * scans correctly before anyone relies on it — same renderer
   * RechargeService.payInfo() uses, not a lookalike built separately.
   */
  async paymentQrPreview(): Promise<string | null> {
    const s = await this.paymentSettings();
    if (!s.upiId || !VPA_RE.test(s.upiId)) return null;
    return `data:image/svg+xml;base64,${Buffer.from(await upiQrSvg({ vpa: s.upiId, name: s.payeeName })).toString('base64')}`;
  }

  async setPaymentSettings(input: PaymentSettingValue, adminId: string): Promise<void> {
    const upiId = input.upiId.trim();
    // Same pattern RechargeService's QR generation checks — validating here
    // with anything looser would let an admin save an ID that renders fine on
    // this form and then fails the moment a member's screen tries to build
    // the actual QR from it.
    if (!VPA_RE.test(upiId)) {
      throw new BadRequestException('Enter a valid UPI ID, e.g. yourname@bank.');
    }
    const payeeName = input.payeeName.trim();
    if (!payeeName) throw new BadRequestException('Enter the name members should see next to the QR.');

    const minRechargePaise = BigInt(input.minRechargePaise);
    const maxRechargePaise = BigInt(input.maxRechargePaise);
    if (minRechargePaise <= 0n || maxRechargePaise <= 0n || minRechargePaise > maxRechargePaise) {
      throw new BadRequestException('Check the minimum and maximum recharge amounts.');
    }

    const value: PaymentSettingValue = {
      upiId, payeeName, note: input.note.trim(),
      minRechargePaise: minRechargePaise.toString(),
      maxRechargePaise: maxRechargePaise.toString(),
    };
    await this.prisma.storeSetting.upsert({
      where: { key: PAYMENT_SETTING_KEY },
      create: { key: PAYMENT_SETTING_KEY, value: value as never },
      update: { value: value as never },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'settings.payment.set', detail: { upiId, payeeName } },
    });
  }

  /* --------------------------------------------------------------- theme */

  /** Deep-merged over the default so a partial save (or a setting added after this row was first written) never loses the rest. */
  async theme(): Promise<ThemeSettingValue> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: THEME_SETTING_KEY } });
    const stored = row?.value as Partial<ThemeSettingValue> | undefined;
    return {
      colors: { ...DEFAULT_THEME.colors, ...stored?.colors },
      logoUrl: stored?.logoUrl ?? DEFAULT_THEME.logoUrl,
      hero: { ...DEFAULT_THEME.hero, ...stored?.hero },
      announcement: { ...DEFAULT_ANNOUNCEMENT, ...stored?.announcement },
      promoBanner: { ...DEFAULT_PROMO_BANNER, ...stored?.promoBanner },
      promoStrip: { ...DEFAULT_PROMO_STRIP, ...stored?.promoStrip },
      homeSections: { ...DEFAULT_HOME_SECTIONS, ...stored?.homeSections },
      trustRibbon: DEFAULT_TRUST_RIBBON.map((d, i) => stored?.trustRibbon?.[i] ?? d) as ThemeSettingValue['trustRibbon'],
      // Fixed-length tuples: a saved array shorter than the default (e.g. from
      // a settings row written before a tile was added) would otherwise leave
      // `undefined` holes instead of falling back per-item.
      trustBadges: mergeTuple(DEFAULT_TRUST_BADGES, stored?.trustBadges),
      pinkBadges: mergeTuple(DEFAULT_PINK_BADGES, stored?.pinkBadges),
      exploreTiles: mergeTuple(DEFAULT_EXPLORE_TILES, stored?.exploreTiles),
      aboutUs: { ...DEFAULT_ABOUT_US, ...stored?.aboutUs },
      // Variable-length lists (an admin adds/removes items, not just edits
      // one in place), so a saved value replaces the default wholesale
      // rather than merging item-by-item.
      aboutPage: { ...DEFAULT_ABOUT_PAGE, ...stored?.aboutPage },
      joinPage: { ...DEFAULT_JOIN_PAGE, ...stored?.joinPage },
      faqPage: stored?.faqPage && stored.faqPage.length > 0 ? stored.faqPage : DEFAULT_FAQ_PAGE,
    };
  }

  async setTheme(input: ThemeSettingValue, adminId: string): Promise<void> {
    for (const [name, hex] of Object.entries(input.colors)) {
      if (!HEX_RE.test(hex)) throw new BadRequestException(`"${name}" needs a hex colour like #B84654.`);
    }
    if (!input.hero.title.trim()) throw new BadRequestException('The homepage headline cannot be empty.');
    if (input.announcement.enabled && !input.announcement.text.trim()) {
      throw new BadRequestException('Write the banner text, or switch the banner off.');
    }
    const day = /^(\d{4}-\d{2}-\d{2})?$/;
    if (!day.test(input.announcement.startsOn) || !day.test(input.announcement.endsOn)) {
      throw new BadRequestException('Banner dates must look like 2026-10-20, or be left blank.');
    }
    if (input.announcement.startsOn && input.announcement.endsOn && input.announcement.startsOn > input.announcement.endsOn) {
      throw new BadRequestException('The banner cannot end before it starts.');
    }

    // These three pages are the ones a regulator reads first when asking
    // whether the business is actually a money-circulation scheme — see the
    // interface comment above. Once this content lived only in code, a
    // build-time check (web/lib/seo.ts's assertNoIncomeClaims) was the
    // enforcement point; now that it is admin-edited at runtime, this save
    // is that enforcement point instead. A BadRequestException here surfaces
    // directly as the admin's save error, naming the exact phrase to fix.
    try {
      assertNoIncomeClaims(
        [
          input.aboutPage.lead, ...input.aboutPage.story,
          ...input.aboutPage.howItWorks.map((s) => `${s.title} ${s.body}`),
          input.aboutPage.notThisTitle, ...input.aboutPage.notThis,
        ].join(' '),
        'The About page',
      );
      assertNoIncomeClaims(
        [
          input.joinPage.lead,
          ...input.joinPage.steps.map((s) => `${s.title} ${s.body}`),
          ...input.joinPage.rules.map((s) => `${s.title} ${s.body}`),
          input.joinPage.honestTitle, ...input.joinPage.honestPoints,
          input.joinPage.eligibility,
        ].join(' '),
        'The Join page',
      );
      assertNoIncomeClaims(input.faqPage.map((f) => `${f.q} ${f.a}`).join(' '), 'The FAQ page');
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    await this.prisma.storeSetting.upsert({
      where: { key: THEME_SETTING_KEY },
      create: { key: THEME_SETTING_KEY, value: input as never },
      update: { value: input as never },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'settings.theme.set', detail: {} },
    });
  }
}
