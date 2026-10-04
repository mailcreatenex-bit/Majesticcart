import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encryptField, decryptField, ctx } from '../common/crypto';

/**
 * Outside services the store talks to, configured by an admin from the console
 * instead of by editing server settings: the delivery company, SMS, WhatsApp,
 * email, and where error alerts go.
 *
 * Secrets (API keys, tokens, passwords) are encrypted at rest with the same
 * field encryption as members' bank details, and are never sent back to the
 * browser: the console can confirm a key ending in ...1a2b is set, not show it.
 * Whatever is entered here wins; for anything left blank the server's own
 * environment variables (the old way) still apply, so nothing configured earlier
 * stops working.
 */

type FieldSpec = { key: string; secret?: boolean; kind?: 'url' | 'email' | 'text' };

export const SECTIONS = {
  courier: [
    { key: 'delhiveryToken', secret: true },
    { key: 'shiprocketEmail', kind: 'email' },
    { key: 'shiprocketPassword', secret: true },
    { key: 'webhookSecret', secret: true },
    // Shown on the product page next to the pincode check, e.g. "3 to 7 working days".
    { key: 'etaText' },
  ],
  sms: [
    { key: 'endpoint', kind: 'url' },
    { key: 'apiKey', secret: true },
    { key: 'senderId' },
    { key: 'templateId' },
  ],
  whatsapp: [
    { key: 'endpoint', kind: 'url' },
    { key: 'token', secret: true },
    { key: 'template' },
  ],
  email: [
    { key: 'apiKey', secret: true },
    { key: 'from' },
  ],
  alerts: [
    { key: 'email', kind: 'email' },
  ],
} as const satisfies Record<string, readonly FieldSpec[]>;

export type SectionName = keyof typeof SECTIONS;
export const SECTION_NAMES = Object.keys(SECTIONS) as [SectionName, ...SectionName[]];

type Stored = Partial<Record<SectionName, Record<string, string | { enc: string; last4: string }>>>;

export interface ResolvedConfig {
  courier: { delhiveryToken: string; shiprocketEmail: string; shiprocketPassword: string; webhookSecret: string; etaText: string };
  sms: { endpoint: string; apiKey: string; senderId: string; templateId: string; enabled: boolean };
  whatsapp: { endpoint: string; token: string; template: string; enabled: boolean };
  email: { apiKey: string; from: string; enabled: boolean };
  alerts: { email: string };
}

const KEY = 'integrations';
const CACHE_MS = 20_000;

const env = (name: string) => process.env[name] ?? '';

@Injectable()
export class IntegrationsService {
  private cache: { at: number; value: ResolvedConfig } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  private async stored(): Promise<Stored> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key: KEY } });
    return (row?.value ?? {}) as Stored;
  }

  private plain(stored: Stored, section: SectionName, field: string): string {
    const v = stored[section]?.[field];
    if (!v) return '';
    return typeof v === 'string' ? v : decryptField(v.enc, ctx.storeSetting(KEY));
  }

  /** The working configuration: what an admin entered, else the server's environment. */
  async resolve(): Promise<ResolvedConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const s = await this.stored();
    const p = (section: SectionName, field: string, fallback: string) => this.plain(s, section, field) || fallback;

    const sms = {
      endpoint: p('sms', 'endpoint', env('SMS_ENDPOINT')),
      apiKey: p('sms', 'apiKey', env('SMS_API_KEY')),
      senderId: p('sms', 'senderId', env('SMS_SENDER_ID')),
      templateId: p('sms', 'templateId', env('SMS_OTP_TEMPLATE_ID')),
    };
    const whatsapp = {
      endpoint: p('whatsapp', 'endpoint', env('WHATSAPP_ENDPOINT')),
      token: p('whatsapp', 'token', env('WHATSAPP_TOKEN')),
      template: p('whatsapp', 'template', env('WHATSAPP_TEMPLATE')),
    };
    const email = {
      apiKey: p('email', 'apiKey', env('RESEND_API_KEY')),
      from: p('email', 'from', env('EMAIL_FROM') || 'Majestic Cart <onboarding@resend.dev>'),
    };
    const value: ResolvedConfig = {
      courier: {
        delhiveryToken: p('courier', 'delhiveryToken', env('DELHIVERY_API_TOKEN')),
        shiprocketEmail: p('courier', 'shiprocketEmail', env('SHIPROCKET_EMAIL')),
        shiprocketPassword: p('courier', 'shiprocketPassword', env('SHIPROCKET_PASSWORD')),
        webhookSecret: p('courier', 'webhookSecret', env('COURIER_WEBHOOK_SECRET')),
        etaText: p('courier', 'etaText', ''),
      },
      // A provider counts as on only when both halves are present, so a half-filled form never half-works.
      sms: { ...sms, enabled: !!(sms.endpoint && sms.apiKey) && (this.plain(s, 'sms', 'apiKey') !== '' || env('SMS_PROVIDER') !== 'console') },
      whatsapp: { ...whatsapp, enabled: !!(whatsapp.endpoint && whatsapp.token) },
      email: { ...email, enabled: !!email.apiKey && (this.plain(s, 'email', 'apiKey') !== '' || (env('EMAIL_PROVIDER') || 'console') !== 'console') },
      alerts: { email: p('alerts', 'email', env('ALERT_EMAIL')) },
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** What the console shows: which things are set, non-secret values, and the last four characters of secrets. */
  async status() {
    const s = await this.stored();
    const out: Record<string, Record<string, { set: boolean; value?: string; last4?: string }>> = {};
    for (const [section, fields] of Object.entries(SECTIONS) as [SectionName, readonly FieldSpec[]][]) {
      out[section] = {};
      for (const f of fields) {
        const v = s[section]?.[f.key];
        if (f.secret) {
          out[section][f.key] = { set: !!v, last4: v && typeof v !== 'string' ? v.last4 : undefined };
        } else {
          out[section][f.key] = { set: !!v, value: typeof v === 'string' ? v : '' };
        }
      }
    }
    return out;
  }

  /**
   * Save fields of one section. A secret left out is kept; `null` clears it. A
   * plain field set to an empty string is cleared. Nothing is logged but the names
   * of the fields that changed.
   */
  async update(section: SectionName, patch: Record<string, string | null | undefined>, adminId: string): Promise<void> {
    const specs = SECTIONS[section] as readonly FieldSpec[];
    const current = await this.stored();
    const next: Record<string, string | { enc: string; last4: string }> = { ...(current[section] ?? {}) };
    const changed: string[] = [];

    for (const [name, raw] of Object.entries(patch)) {
      const spec = specs.find((f) => f.key === name);
      if (!spec) throw new BadRequestException(`Unknown field "${name}".`);
      if (raw === undefined) continue;
      const value = raw === null ? '' : String(raw).trim();

      if (value === '') {
        if (name in next) { delete next[name]; changed.push(name); }
        continue;
      }
      if (spec.kind === 'url' && !/^https:\/\/[^\s]+$/i.test(value)) throw new BadRequestException(`${label(name)} must be a web address starting with https://`);
      if (spec.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new BadRequestException(`${label(name)} must be an email address.`);
      if (value.length > 600) throw new BadRequestException(`${label(name)} is too long.`);
      if (spec.secret && /\s/.test(value)) throw new BadRequestException(`${label(name)} cannot contain spaces.`);

      next[name] = spec.secret ? { enc: encryptField(value, ctx.storeSetting(KEY)), last4: value.slice(-4) } : value;
      changed.push(name);
    }

    const value = { ...current, [section]: next };
    await this.prisma.storeSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: value as never },
      update: { value: value as never },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'settings.integrations.update', detail: { section, fields: changed } },
    });
    this.cache = null;
  }

  /** WhatsApp Business through whichever gateway the store uses: a JSON POST with a bearer token. */
  async sendWhatsapp(phone: string, text: string): Promise<void> {
    const { whatsapp } = await this.resolve();
    if (!whatsapp.enabled) throw new Error('WhatsApp is not set up.');
    const res = await fetch(whatsapp.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${whatsapp.token}` },
      body: JSON.stringify({ to: `91${phone}`, type: 'text', text: { body: text }, template: whatsapp.template || undefined }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  }
}

const label = (field: string) => field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
