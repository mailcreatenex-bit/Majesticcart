import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { encryptField, decryptField, ctx } from '../common/crypto';

/**
 * Notifications to a member's phone through the installed app (web push). It costs nothing
 * per message, unlike SMS or WhatsApp, and works only for members who tapped "Allow" on this
 * device. Every notification the member would see in the app is sent, once, a few seconds
 * after it is created.
 *
 * The server's signing keys (VAPID) are made the first time they are needed and kept
 * encrypted in the settings table, so there is nothing to configure.
 */

const SETTING_KEY = 'push';
const SWEEP_EVERY_MS = 20_000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const KINDS = ['ORDER', 'WALLET', 'WITHDRAWAL', 'AUTOSHIP', 'SECURITY', 'SUPPORT', 'STOCK', 'NUDGE', 'CART'];

/** Where tapping a notification of this kind should go. Exported for tests. */
export function destinationFor(kind: string): string {
  switch (kind) {
    case 'ORDER': return '/orders';
    case 'WALLET': case 'WITHDRAWAL': return '/wallet';
    case 'STOCK': return '/wishlist';
    case 'CART': return '/cart';
    case 'SUPPORT': return '/support';
    case 'AUTOSHIP': return '/autoship';
    default: return '/account';
  }
}

interface Keys { publicKey: string; privateKey: string }

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PushService.name);
  private keys: Keys | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    if (process.env.OUTBOUND_NOTIFICATIONS === 'false') return;
    const first = setTimeout(() => void this.sweep().catch(() => undefined), 30_000);
    first.unref?.();
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The signing keys, made on first use. Two servers starting together may each make a pair; the first saved wins and both then read it. */
  private async loadKeys(): Promise<Keys> {
    if (this.keys) return this.keys;
    const row = await this.prisma.storeSetting.findUnique({ where: { key: SETTING_KEY } });
    const stored = row?.value as { publicKey: string; privateKeyEnc: string } | undefined;
    if (stored?.publicKey && stored.privateKeyEnc) {
      this.keys = { publicKey: stored.publicKey, privateKey: decryptField(stored.privateKeyEnc, ctx.storeSetting(SETTING_KEY)) };
      return this.keys;
    }
    const made = webpush.generateVAPIDKeys();
    await this.prisma.storeSetting.createMany({
      data: [{ key: SETTING_KEY, value: { publicKey: made.publicKey, privateKeyEnc: encryptField(made.privateKey, ctx.storeSetting(SETTING_KEY)) } as never }],
      skipDuplicates: true,
    });
    const again = (await this.prisma.storeSetting.findUnique({ where: { key: SETTING_KEY } }))!.value as { publicKey: string; privateKeyEnc: string };
    this.keys = { publicKey: again.publicKey, privateKey: decryptField(again.privateKeyEnc, ctx.storeSetting(SETTING_KEY)) };
    return this.keys;
  }

  async publicKey(): Promise<string> {
    return (await this.loadKeys()).publicKey;
  }

  async subscribe(memberId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      // The same device signing in as someone else takes the subscription with it.
      create: { memberId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
      update: { memberId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(memberId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { memberId, endpoint } });
  }

  async count(memberId: string): Promise<number> {
    return this.prisma.pushSubscription.count({ where: { memberId } });
  }

  /** Send one message to every device a member has allowed. Returns how many devices took it. */
  async sendToMember(memberId: string, msg: { title: string; body: string; url: string }): Promise<number> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { memberId } });
    if (subs.length === 0) return 0;
    const keys = await this.loadKeys();
    const payload = JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 200), url: msg.url });
    let delivered = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { vapidDetails: { subject: process.env.PUSH_CONTACT ?? 'mailto:care@majesticcart.in', publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600 },
        );
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the member removed it or the browser dropped it. Forget it rather than try forever.
        if (status === 404 || status === 410) await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        else this.log.warn(`push failed (${status ?? 'error'})`);
      }
    }
    return delivered;
  }

  /** Push the notifications created since the last pass, to members who have a device registered. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const rows = await this.prisma.notification.findMany({
        where: {
          pushedAt: null,
          kind: { in: KINDS },
          createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
          member: { pushSubscriptions: { some: {} } },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, memberId: true, kind: true, title: true, body: true },
      });
      for (const n of rows) {
        // Claim first: only one server gets count 1.
        const claimed = await this.prisma.notification.updateMany({ where: { id: n.id, pushedAt: null }, data: { pushedAt: new Date() } });
        if (claimed.count !== 1) continue;
        sent += await this.sendToMember(n.memberId, { title: n.title, body: n.body, url: destinationFor(n.kind) }).catch(() => 0);
      }
    } catch (e) {
      this.log.error(`push pass failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
    return sent;
  }
}
