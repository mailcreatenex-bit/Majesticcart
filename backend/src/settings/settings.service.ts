import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encryptField, decryptField, ctx } from '../common/crypto';
import { upiQrSvg, VPA_RE } from '../recharge/upi-qr';

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
    imageUrl: string;
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
}

const DEFAULT_ANNOUNCEMENT: ThemeSettingValue['announcement'] = {
  enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '',
};

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
    imageUrl: '',
  },
  announcement: DEFAULT_ANNOUNCEMENT,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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
