import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { money } from '../common/serialization';

/**
 * Anonymous storefront analytics: the funnel from visit to order, what people
 * look at and add, and where checkout stalls.
 *
 * Deliberately light on what it keeps. An event is a random per-tab session id,
 * a type, and at most a product slug or a reason. No IP address, no cookie, no
 * member id, no user agent: it can say "37 sessions reached checkout and 11
 * stopped because the wallet was short", and nothing about who they were. Events
 * older than 120 days are deleted.
 *
 * The funnel counts *distinct sessions* at each step, not events, so a shopper
 * who adds five things counts once.
 */

export const EVENT_TYPES = [
  'visit', 'view_product', 'add_to_bag', 'view_cart', 'begin_checkout', 'checkout_blocked', 'order_placed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The ordered steps of the funnel (blocked is a side-exit, not a step). */
export const FUNNEL: { type: EventType; label: string }[] = [
  { type: 'visit', label: 'Visited the store' },
  { type: 'view_product', label: 'Looked at a product' },
  { type: 'add_to_bag', label: 'Added to bag' },
  { type: 'view_cart', label: 'Opened the bag' },
  { type: 'begin_checkout', label: 'Started checkout' },
  { type: 'order_placed', label: 'Placed an order' },
];

const RETENTION_DAYS = 120;

/** Pure: from distinct-session counts per step to the funnel with drop-off. Exported for tests. */
export function buildFunnel(counts: Partial<Record<EventType, number>>) {
  const first = counts.visit ?? 0;
  return FUNNEL.map((step, i) => {
    const sessions = counts[step.type] ?? 0;
    const prev = i === 0 ? sessions : (counts[FUNNEL[i - 1].type] ?? 0);
    return {
      type: step.type,
      label: step.label,
      sessions,
      // Of those who reached the step before, how many carried on; of everyone who visited, how many got here.
      fromPreviousPct: i === 0 ? 100 : prev > 0 ? Math.round((sessions / prev) * 1000) / 10 : 0,
      fromVisitPct: first > 0 ? Math.round((sessions / first) * 1000) / 10 : 0,
      lost: i === 0 ? 0 : Math.max(0, prev - sessions),
    };
  });
}

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnalyticsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    const purge = () => void this.purge().catch(() => undefined);
    const first = setTimeout(purge, 5 * 60 * 1000);
    first.unref?.();
    this.timer = setInterval(purge, 24 * 60 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async record(e: { sid: string; type: EventType; slug?: string; reason?: string }): Promise<void> {
    await this.prisma.analyticsEvent.create({
      data: { sid: e.sid, type: e.type, slug: e.slug?.slice(0, 120) ?? null, reason: e.reason?.slice(0, 40) ?? null },
    });
  }

  async purge(): Promise<number> {
    const r = await this.prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } });
    if (r.count) this.log.log(`purged ${r.count} old analytics events`);
    return r.count;
  }

  async report(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);

    const [stepRows, topSeen, blockers, abandoned, daily, topSold, orderTotals] = await Promise.all([
      this.prisma.$queryRaw<{ type: string; sessions: number }[]>`
        SELECT type, COUNT(DISTINCT sid)::int AS sessions FROM "AnalyticsEvent"
        WHERE "createdAt" >= ${since} GROUP BY type`,
      this.prisma.$queryRaw<{ slug: string; type: string; sessions: number }[]>`
        SELECT slug, type, COUNT(DISTINCT sid)::int AS sessions FROM "AnalyticsEvent"
        WHERE "createdAt" >= ${since} AND slug IS NOT NULL AND type IN ('view_product', 'add_to_bag')
        GROUP BY slug, type`,
      this.prisma.$queryRaw<{ reason: string; sessions: number }[]>`
        SELECT COALESCE(reason, 'other') AS reason, COUNT(DISTINCT sid)::int AS sessions FROM "AnalyticsEvent"
        WHERE "createdAt" >= ${since} AND type = 'checkout_blocked' GROUP BY 1 ORDER BY 2 DESC`,
      // Sessions that put something in the bag and never placed an order.
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(DISTINCT a.sid)::int AS n FROM "AnalyticsEvent" a
        WHERE a."createdAt" >= ${since} AND a.type = 'add_to_bag'
          AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" o WHERE o.sid = a.sid AND o.type = 'order_placed' AND o."createdAt" >= ${since})`,
      this.prisma.$queryRaw<{ day: string; visits: number; orders: number }[]>`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               COALESCE(v.n, 0)::int AS visits, COALESCE(o.n, 0)::int AS orders
        FROM generate_series(date_trunc('day', ${since}::timestamptz AT TIME ZONE 'Asia/Kolkata'),
                             date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata'), interval '1 day') AS d(day)
        LEFT JOIN (SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kolkata') AS day, COUNT(DISTINCT sid) AS n
                   FROM "AnalyticsEvent" WHERE type = 'visit' AND "createdAt" >= ${since} GROUP BY 1) v ON v.day = d.day
        LEFT JOIN (SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kolkata') AS day, COUNT(*) AS n
                   FROM "Order" WHERE status <> 'CANCELLED' AND "createdAt" >= ${since} GROUP BY 1) o ON o.day = d.day
        ORDER BY d.day`,
      this.prisma.$queryRaw<{ productId: string; name: string; units: number; revenue: bigint }[]>`
        SELECT oi."productId", MAX(oi."nameSnapshot") AS name, SUM(oi.quantity)::int AS units,
               SUM(oi."pricePaise" * oi.quantity) AS revenue
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= ${since} AND o.status <> 'CANCELLED'
        GROUP BY oi."productId" ORDER BY revenue DESC LIMIT 10`,
      this.prisma.$queryRaw<{ orders: number; revenue: bigint | null }[]>`
        SELECT COUNT(*)::int AS orders, SUM("totalPaise") AS revenue FROM "Order"
        WHERE status <> 'CANCELLED' AND "createdAt" >= ${since}`,
    ]);

    const counts: Partial<Record<EventType, number>> = {};
    for (const r of stepRows) counts[r.type as EventType] = r.sessions;
    const funnel = buildFunnel(counts);

    // Product names for the slugs people viewed, in one read.
    const bySlug = new Map<string, { views: number; adds: number }>();
    for (const r of topSeen) {
      const row = bySlug.get(r.slug) ?? { views: 0, adds: 0 };
      if (r.type === 'view_product') row.views = r.sessions; else row.adds = r.sessions;
      bySlug.set(r.slug, row);
    }
    const slugs = [...bySlug.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 10).map(([s]) => s);
    const names = slugs.length
      ? await this.prisma.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } })
      : [];
    const nameOf = new Map(names.map((n) => [n.slug, n.name]));

    const visits = counts.visit ?? 0;
    const orders = orderTotals[0]?.orders ?? 0;
    return {
      days,
      since,
      funnel,
      summary: {
        visits,
        orders,
        revenue: money(orderTotals[0]?.revenue ?? 0n),
        // Of sessions that visited, how many placed an order.
        conversionPct: visits > 0 ? Math.round(((counts.order_placed ?? 0) / visits) * 1000) / 10 : 0,
        abandonedBags: abandoned[0]?.n ?? 0,
      },
      checkoutBlockers: blockers.map((b) => ({ reason: b.reason, sessions: b.sessions })),
      mostViewed: slugs.map((s) => {
        const v = bySlug.get(s)!;
        return { slug: s, name: nameOf.get(s) ?? s, views: v.views, adds: v.adds, addRatePct: v.views > 0 ? Math.round((v.adds / v.views) * 1000) / 10 : 0 };
      }),
      topSellers: topSold.map((t) => ({ productId: t.productId, name: t.name, units: t.units, revenue: money(t.revenue) })),
      daily,
    };
  }
}
