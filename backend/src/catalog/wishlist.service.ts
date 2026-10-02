import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * A member's saved products, and "tell me when it is back".
 *
 * Saving an out-of-stock product also asks to be told when it returns, because
 * nobody saves something they cannot buy for any other reason. The restock
 * check is a sweep rather than a hook on every place stock can change (admin
 * edit, import, a cancelled or returned order restocking): one query that finds
 * wished-for products now in stock cannot miss a path, and a few minutes' delay
 * on a "back in stock" message does not matter.
 */

const MAX_ITEMS = 200;
const SWEEP_EVERY_MS = 5 * 60 * 1000;
const FIRST_SWEEP_MS = 90 * 1000;

@Injectable()
export class WishlistService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WishlistService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    const first = setTimeout(() => void this.sweep().catch(() => undefined), FIRST_SWEEP_MS);
    const every = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** The slugs a member has saved, with which of them are waiting on stock. */
  async slugs(memberId: string) {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { memberId },
      select: { alertWhenBack: true, product: { select: { slug: true } } },
    });
    return {
      slugs: rows.map((r) => r.product.slug),
      alerts: rows.filter((r) => r.alertWhenBack).map((r) => r.product.slug),
    };
  }

  async list(memberId: string) {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { memberId, product: { isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS,
      include: { product: { include: { category: true, brand: true } } },
    });
    return rows.map((r) => ({ product: r.product, alertWhenBack: r.alertWhenBack }));
  }

  async add(memberId: string, slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, isActive: true }, select: { id: true, stock: true } });
    if (!product) throw new NotFoundException('Product not found');
    const key = { memberId_productId: { memberId, productId: product.id } };
    const existing = await this.prisma.wishlistItem.findUnique({ where: key });
    if (!existing && (await this.prisma.wishlistItem.count({ where: { memberId } })) >= MAX_ITEMS) {
      throw new BadRequestException('Your wishlist is full.');
    }
    const alertWhenBack = product.stock <= 0;
    await this.prisma.wishlistItem.upsert({
      where: key,
      create: { memberId, productId: product.id, alertWhenBack },
      update: { alertWhenBack: alertWhenBack || (existing?.alertWhenBack ?? false) },
    });
    return { saved: true, alert: alertWhenBack };
  }

  async remove(memberId: string, slug: string) {
    await this.prisma.wishlistItem.deleteMany({ where: { memberId, product: { slug } } });
    return { saved: false };
  }

  /** Tell members, once, that something they asked about is back. Returns how many were told. */
  async sweep(): Promise<number> {
    const due = await this.prisma.wishlistItem.findMany({
      where: { alertWhenBack: true, product: { stock: { gt: 0 }, isActive: true } },
      take: 200,
      select: { id: true, memberId: true, product: { select: { name: true } } },
    });
    let told = 0;
    for (const item of due) {
      // Claim first, so two servers cannot both send it.
      const claimed = await this.prisma.wishlistItem.updateMany({
        where: { id: item.id, alertWhenBack: true },
        data: { alertWhenBack: false },
      });
      if (claimed.count !== 1) continue;
      await this.prisma.notification.create({
        data: {
          memberId: item.memberId,
          kind: 'STOCK',
          title: 'Back in stock',
          body: `${item.product.name} is back in stock. Grab it before it sells out again.`,
        },
      });
      told++;
    }
    if (told) this.log.log(`back-in-stock: told ${told} member(s)`);
    return told;
  }
}
