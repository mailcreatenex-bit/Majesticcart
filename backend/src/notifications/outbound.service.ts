import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SMS_SENDER, type SmsSender } from './sms.service';

/**
 * Sends the in-app notifications a member should also hear about outside the app:
 * an order placed, shipped or delivered, money credited to the wallet, a withdrawal
 * paid, a security change, an autoship result.
 *
 * Every one of those events already writes a Notification row. This service reads
 * the new rows and relays them by SMS and WhatsApp, so no order, wallet or withdrawal
 * code has to know that a message goes out - and turning it on or off is a matter of
 * configuration, not code.
 *
 *   • SMS goes out only when a real provider is configured (SMS_PROVIDER other than
 *     "console"); WhatsApp only when WHATSAPP_ENDPOINT and WHATSAPP_TOKEN are set.
 *     Neither is set by default, so nothing is sent (and nothing is charged) until
 *     the client has chosen providers and registered their message templates.
 *   • A row is claimed before it is sent, so two servers cannot both send it. If the
 *     send fails it is recorded and not retried: a duplicate message is worse than
 *     a missed one for a member's phone, and the in-app notification is still there.
 *   • A member can switch outside messages off in their account.
 *   • Only recent rows are considered, so switching a provider on does not text
 *     people about last month's orders.
 */

const RELAYED_KINDS = ['ORDER', 'WALLET', 'WITHDRAWAL', 'AUTOSHIP', 'SECURITY'];
const RUN_EVERY_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 45 * 1000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class OutboundNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboundNotifier.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  private get smsEnabled(): boolean {
    return (process.env.SMS_PROVIDER ?? 'console') !== 'console';
  }
  private get whatsappEnabled(): boolean {
    return !!process.env.WHATSAPP_ENDPOINT && !!process.env.WHATSAPP_TOKEN;
  }

  onModuleInit(): void {
    if (process.env.OUTBOUND_NOTIFICATIONS === 'false') return;
    const first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    const every = setInterval(() => void this.tick(), RUN_EVERY_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(): Promise<number> {
    // With no provider there is nothing to relay; leave the rows alone so switching one on later
    // still only reaches genuinely recent events.
    if (!this.smsEnabled && !this.whatsappEnabled) return 0;
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const rows = await this.prisma.notification.findMany({
        where: {
          outboundAt: null,
          kind: { in: RELAYED_KINDS },
          createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
          member: { notifyExternal: true },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, title: true, body: true, member: { select: { phone: true } } },
      });
      for (const n of rows) {
        // Claim first: only one server gets count 1.
        const claimed = await this.prisma.notification.updateMany({ where: { id: n.id, outboundAt: null }, data: { outboundAt: new Date() } });
        if (claimed.count !== 1) continue;
        const text = `Majestic Cart: ${n.title}. ${n.body}`.slice(0, 300);
        const errors: string[] = [];
        if (this.smsEnabled) await this.sms.send(n.member.phone, text).catch((e) => errors.push(`sms: ${e instanceof Error ? e.message : e}`));
        if (this.whatsappEnabled) await this.whatsapp(n.member.phone, text).catch((e) => errors.push(`whatsapp: ${e instanceof Error ? e.message : e}`));
        if (errors.length) {
          await this.prisma.notification.update({ where: { id: n.id }, data: { outboundError: errors.join('; ').slice(0, 300) } });
        } else {
          sent++;
        }
      }
    } catch (e) {
      this.log.error(`outbound pass failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
    return sent;
  }

  /** WhatsApp Business through whichever gateway the client uses: a JSON POST with a bearer token. */
  private async whatsapp(phone: string, text: string): Promise<void> {
    const res = await fetch(process.env.WHATSAPP_ENDPOINT as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: JSON.stringify({ to: `91${phone}`, type: 'text', text: { body: text }, template: process.env.WHATSAPP_TEMPLATE || undefined }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  }
}
