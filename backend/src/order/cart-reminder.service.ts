import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * A gentle nudge for a bag a member filled and then left.
 *
 * The browser keeps the bag; for a signed-in member it also tells the server what is in it
 * (just product and quantity, replaced each time it changes). A few hours later, if they
 * have not ordered, they get one notification, in the app and on their phone if they allowed
 * it. Never by SMS or WhatsApp: that costs money per message and is the wrong place for a
 * marketing nudge. At most one every three days per member, and none if they have ordered since.
 */

const QUIET_FOR_MS = 3 * 60 * 60 * 1000; // wait this long after the last change
const GIVE_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // an older bag is not worth bringing up
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 15 * 60 * 1000;

export interface SnapshotRow {
  memberId: string;
  count: number;
  firstName: string | null;
  updatedAt: Date;
  remindedAt: Date | null;
}

/** Pure: which snapshots should get a reminder now. Exported for tests. */
export function pickReminders(
  rows: SnapshotRow[],
  now: Date,
  orderedSince: Set<string>,
  remindedRecently: Set<string>,
): SnapshotRow[] {
  return rows.filter((r) => {
    const age = now.getTime() - r.updatedAt.getTime();
    if (r.count <= 0) return false;
    if (age < QUIET_FOR_MS || age > GIVE_UP_AFTER_MS) return false;
    if (r.remindedAt && r.remindedAt >= r.updatedAt) return false; // already told about this very bag
    if (orderedSince.has(r.memberId)) return false;
    if (remindedRecently.has(r.memberId)) return false;
    return true;
  });
}

@Injectable()
export class CartReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CartReminderService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    const first = setTimeout(() => void this.sweep().catch(() => undefined), 2 * 60 * 1000);
    first.unref?.();
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Replace the saved copy of a member's bag; an empty bag removes it. */
  async save(memberId: string, items: { slug: string; qty: number }[]): Promise<void> {
    const clean = items.filter((i) => i.qty > 0).slice(0, 50);
    if (clean.length === 0) {
      await this.prisma.cartSnapshot.deleteMany({ where: { memberId } });
      return;
    }
    const count = clean.reduce((n, i) => n + i.qty, 0);
    await this.prisma.cartSnapshot.upsert({
      where: { memberId },
      create: { memberId, items: clean as never, count },
      update: { items: clean as never, count, updatedAt: new Date() },
    });
  }

  async sweep(): Promise<number> {
    const now = new Date();
    const rows = await this.prisma.cartSnapshot.findMany({
      where: {
        count: { gt: 0 },
        updatedAt: { lte: new Date(now.getTime() - QUIET_FOR_MS), gte: new Date(now.getTime() - GIVE_UP_AFTER_MS) },
      },
      take: 200,
      select: { memberId: true, count: true, items: true, updatedAt: true, remindedAt: true, member: { select: { name: true, status: true } } },
    });
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.memberId);

    const [orders, recent] = await Promise.all([
      this.prisma.order.findMany({ where: { memberId: { in: ids }, createdAt: { gte: new Date(now.getTime() - GIVE_UP_AFTER_MS) } }, select: { memberId: true, createdAt: true } }),
      this.prisma.notification.findMany({ where: { memberId: { in: ids }, kind: 'CART', createdAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } }, select: { memberId: true } }),
    ]);
    const updated = new Map(rows.map((r) => [r.memberId, r.updatedAt]));
    const orderedSince = new Set(orders.filter((o) => o.createdAt >= updated.get(o.memberId)!).map((o) => o.memberId));

    const due = pickReminders(
      rows.filter((r) => r.member.status === 'ACTIVE').map((r) => ({ memberId: r.memberId, count: r.count, firstName: r.member.name.split(' ')[0], updatedAt: r.updatedAt, remindedAt: r.remindedAt })),
      now,
      orderedSince,
      new Set(recent.map((n) => n.memberId)),
    );

    let sent = 0;
    for (const d of due) {
      // Claim first, so two servers cannot both send it.
      const claimed = await this.prisma.cartSnapshot.updateMany({ where: { memberId: d.memberId, updatedAt: d.updatedAt, remindedAt: d.remindedAt }, data: { remindedAt: now } });
      if (claimed.count !== 1) continue;
      const first = (rows.find((r) => r.memberId === d.memberId)!.items as { slug: string }[])[0];
      const product = first ? await this.prisma.product.findFirst({ where: { slug: first.slug }, select: { name: true } }) : null;
      const body = product
        ? d.count > 1 ? `${product.name} and ${d.count - 1} more ${d.count - 1 === 1 ? 'item is' : 'items are'} waiting in your bag.` : `${product.name} is waiting in your bag.`
        : `${d.count} ${d.count === 1 ? 'item is' : 'items are'} waiting in your bag.`;
      await this.prisma.notification.create({ data: { memberId: d.memberId, kind: 'CART', title: 'You left something in your bag', body } });
      sent++;
    }
    if (sent) this.log.log(`bag reminders: ${sent}`);
    return sent;
  }
}
