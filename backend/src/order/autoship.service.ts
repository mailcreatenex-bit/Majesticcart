import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OrderService } from './order.service';
import { isoPeriod } from '../common/period';
import { money, volume } from '../common/serialization';

/**
 * Autoship: a standing monthly order.
 *
 * A member picks products and a day of the month (1 to 28, so every month has it).
 * On that day the order is placed through the normal checkout - same pricing, same
 * stock check, paid from the shopping wallet - so it is an ordinary order in every
 * respect and earns the same volume toward the monthly target.
 *
 * Three rules keep it safe:
 *
 *   • One order per member per month. The order carries a request id built from the plan
 *     and the period, and checkout is idempotent on it, so a retry, a second server
 *     or a restart at the wrong moment can never place a second one.
 *   • A failure never charges. If the wallet is short or an item is out of stock the
 *     checkout refuses as a whole; the plan records why, tells the member once that
 *     month, and tries again the next time the runner wakes until the month ends.
 *   • Setting it up late in the month does not fire at once. If the chosen day has
 *     already passed, the first order is next month's.
 *
 * The runner is a timer inside the API process. On a hosting plan that sleeps the
 * process when idle it can only run while the API is awake, which is why a due order
 * may be placed later in the day rather than at midnight.
 */

export interface AutoshipLine { productId: string; quantity: number }

const MAX_LINES = 20;
const MAX_QTY = 20;
const RUN_EVERY_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;

@Injectable()
export class AutoshipService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AutoshipService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    if (process.env.AUTOSHIP_ENABLED === 'false') return;
    const first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    const every = setInterval(() => void this.tick(), RUN_EVERY_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /* ---------------------------------------------------------------- member */

  async get(memberId: string) {
    const plan = await this.prisma.autoshipPlan.findUnique({ where: { memberId } });
    if (!plan) return { plan: null };

    const lines = (plan.lines as unknown as AutoshipLine[]) ?? [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true, name: true, slug: true, pricePaise: true, bvCenti: true, isActive: true, imageUrl: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let totalPaise = 0n;
    let totalBv = 0;
    const items = lines.map((l) => {
      const p = byId.get(l.productId);
      if (p) {
        totalPaise += p.pricePaise * BigInt(l.quantity);
        totalBv += Number(p.bvCenti) * l.quantity;
      }
      return {
        productId: l.productId,
        quantity: l.quantity,
        name: p?.name ?? 'No longer sold',
        slug: p?.slug ?? null,
        imageUrl: p?.imageUrl ?? null,
        available: !!p?.isActive,
        price: money(p?.pricePaise ?? 0n),
      };
    });

    return {
      plan: {
        active: plan.active,
        dayOfMonth: plan.dayOfMonth,
        items,
        // Shelf prices, GST included; the order itself is priced at checkout, so this is an estimate
        // only if a price changes between now and the day.
        estimatedTotal: money(totalPaise),
        estimatedBv: volume(totalBv),
        lastOrderNo: plan.lastOrderNo,
        lastResult: plan.lastResult,
        lastAttemptAt: plan.lastAttemptAt,
        nextPeriod: this.nextRunLabel(plan),
      },
    };
  }

  async save(memberId: string, input: { dayOfMonth: number; lines: AutoshipLine[] }) {
    const day = Math.floor(input.dayOfMonth);
    if (!(day >= 1 && day <= 28)) throw new BadRequestException('Choose a day between 1 and 28.');

    // Merge duplicate products, keep a sane size.
    const merged = new Map<string, number>();
    for (const l of input.lines) merged.set(l.productId, Math.min(MAX_QTY, (merged.get(l.productId) ?? 0) + l.quantity));
    const lines = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
    if (lines.length === 0) throw new BadRequestException('Add at least one product.');
    if (lines.length > MAX_LINES) throw new BadRequestException(`An autoship order can hold up to ${MAX_LINES} products.`);

    const products = await this.prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, isActive: true }, select: { id: true } });
    if (products.length !== lines.length) throw new BadRequestException('One of those products is no longer sold.');

    await this.requireAddress(memberId);

    const period = isoPeriod(new Date());
    // A day that has already passed this month means the first order is next month's.
    const skipThisMonth = new Date().getDate() >= day;
    const data = {
      dayOfMonth: day,
      lines: lines as never,
      active: true,
      lastRunPeriod: skipThisMonth ? period : null,
      lastResult: null,
      failNotifiedPeriod: null,
    };
    await this.prisma.autoshipPlan.upsert({ where: { memberId }, create: { memberId, ...data }, update: data });
    return this.get(memberId);
  }

  async setActive(memberId: string, active: boolean) {
    const plan = await this.prisma.autoshipPlan.findUnique({ where: { memberId } });
    if (!plan) throw new NotFoundException('You have not set up autoship yet.');
    const period = isoPeriod(new Date());
    await this.prisma.autoshipPlan.update({
      where: { memberId },
      data: {
        active,
        // Resuming after the day has passed waits for next month rather than ordering out of the blue.
        ...(active && new Date().getDate() >= plan.dayOfMonth ? { lastRunPeriod: period } : {}),
      },
    });
    return this.get(memberId);
  }

  async remove(memberId: string) {
    await this.prisma.autoshipPlan.deleteMany({ where: { memberId } });
    return { ok: true as const };
  }

  /* ---------------------------------------------------------------- runner */

  /** One pass over every plan that is due. Safe to call at any time and from several servers. */
  async tick(now = new Date()): Promise<{ placed: number; failed: number }> {
    if (this.running) return { placed: 0, failed: 0 };
    this.running = true;
    let placed = 0;
    let failed = 0;
    try {
      const period = isoPeriod(now);
      const today = now.getDate();
      const due = await this.prisma.autoshipPlan.findMany({
        where: { active: true, dayOfMonth: { lte: today }, OR: [{ lastRunPeriod: null }, { lastRunPeriod: { not: period } }] },
        take: 200,
      });
      for (const plan of due) {
        const ok = await this.runOne(plan.id, period).catch((e) => {
          this.log.error(`autoship ${plan.id} crashed: ${e instanceof Error ? e.message : e}`);
          return false;
        });
        if (ok) placed++; else failed++;
      }
      if (due.length) this.log.log(`autoship pass: ${placed} placed, ${failed} not placed`);
    } finally {
      this.running = false;
    }
    return { placed, failed };
  }

  private async runOne(planId: string, period: string): Promise<boolean> {
    const plan = await this.prisma.autoshipPlan.findUnique({ where: { id: planId }, include: { member: { select: { id: true, name: true, phone: true, addressLine: true, city: true, state: true, pincode: true } } } });
    if (!plan || !plan.active || plan.lastRunPeriod === period) return false;
    const m = plan.member;

    try {
      if (!m.addressLine || !m.city || !m.state || !m.pincode) throw new BadRequestException('Add your delivery address in your account.');
      const order = await this.orders.checkout({
        memberId: m.id,
        lines: plan.lines as unknown as AutoshipLine[],
        shipping: { name: m.name, phone: m.phone, line: m.addressLine, city: m.city, state: m.state, pincode: m.pincode },
        // Fixed per plan and month: the checkout's idempotency makes a second attempt a no-op.
        requestId: `autoship-${plan.id}-${period}`,
      });
      await this.prisma.autoshipPlan.update({
        where: { id: plan.id },
        data: { lastRunPeriod: period, lastOrderNo: order.orderNo, lastResult: 'Order placed', lastAttemptAt: new Date() },
      });
      await this.notify(m.id, 'Your autoship order was placed', `Order ${order.orderNo} was placed from your shopping wallet.`);
      return true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'The order could not be placed.';
      const first = plan.failNotifiedPeriod !== period;
      await this.prisma.autoshipPlan.update({
        where: { id: plan.id },
        data: { lastResult: reason, lastAttemptAt: new Date(), ...(first ? { failNotifiedPeriod: period } : {}) },
      });
      // Tell the member once a month, not every hour.
      if (first) {
        await this.notify(m.id, 'Your autoship order could not be placed', `${reason} We will try again automatically - nothing was charged.`);
      }
      return false;
    }
  }

  /* ---------------------------------------------------------------- helpers */

  private async requireAddress(memberId: string): Promise<void> {
    const m = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { addressLine: true, city: true, state: true, pincode: true } });
    if (!m.addressLine || !m.city || !m.state || !m.pincode) {
      throw new BadRequestException('Save your delivery address first (place an order once, or add it in your account). Autoship delivers there.');
    }
  }

  private nextRunLabel(plan: { active: boolean; dayOfMonth: number; lastRunPeriod: string | null }): string | null {
    if (!plan.active) return null;
    const now = new Date();
    const period = isoPeriod(now);
    const thisMonthPending = plan.lastRunPeriod !== period;
    const d = new Date(now.getFullYear(), now.getMonth() + (thisMonthPending ? 0 : 1), plan.dayOfMonth);
    // Local date parts: toISOString() is UTC, which shifts a midnight-IST date back a day.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async notify(memberId: string, title: string, body: string): Promise<void> {
    await this.prisma.notification.create({ data: { memberId, title, body, kind: 'AUTOSHIP' } }).catch(() => undefined);
  }
}
