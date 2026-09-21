import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { money, volume, MoneyView, VolumeView } from '../common/serialization';
import { isoPeriod } from '../common/period';

/**
 * Dashboard aggregates.
 *
 * Written as raw SQL rather than Prisma aggregates for two reasons: date
 * bucketing with a gap-free series is not expressible through the query
 * builder, and SUM over a BigInt column comes back as NUMERIC, which needs an
 * explicit cast or it arrives as a lossy float.
 *
 * Every query here is read-only and safe to run against a replica.
 */

export interface DashboardSummary {
  revenue: MoneyView;
  commissionPaid: MoneyView;
  /** Commission as a share of revenue — the number that decides solvency. */
  payoutRatioBp: number;
  businessVolume: VolumeView;
  walletFloat: MoneyView;
  orderCount: number;
  memberCount: number;
  activeMemberCount: number;
  pendingRecharges: number;
  pendingWithdrawals: number;
  openAlerts: number;
  ordersToShip: number;
  lowStockCount: number;
}

export interface SeriesPoint {
  day: string;
  revenue: MoneyView;
  orders: number;
  commission: MoneyView;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async summary(): Promise<DashboardSummary> {
    // One round trip. The admin dashboard is the most-hit authenticated page in
    // the product, and eleven sequential queries there is a visible stall.
    const [row] = await this.prisma.$queryRaw<
      {
        revenue: bigint; bv: bigint; orderCount: bigint; commission: bigint; walletFloat: bigint;
        memberCount: bigint; activeMembers: bigint; pendingRecharges: bigint; pendingWithdrawals: bigint;
        openAlerts: bigint; toShip: bigint; lowStock: bigint;
      }[]
    >`
      SELECT
        COALESCE((SELECT SUM("totalPaise")   FROM "Order" WHERE status <> 'CANCELLED'), 0)::bigint AS "revenue",
        COALESCE((SELECT SUM("totalBvCenti") FROM "Order" WHERE status <> 'CANCELLED'), 0)::bigint AS "bv",
        (SELECT COUNT(*) FROM "Order" WHERE status <> 'CANCELLED')                                 AS "orderCount",
        COALESCE((SELECT SUM("amountPaise")  FROM "Commission"), 0)::bigint                        AS "commission",
        COALESCE((SELECT SUM("balancePaise") FROM "Wallet"), 0)::bigint                            AS "walletFloat",
        (SELECT COUNT(*) FROM "Member" WHERE "isCompany" = false)                                  AS "memberCount",
        (SELECT COUNT(*) FROM "Member" WHERE "isCompany" = false AND status = 'ACTIVE')            AS "activeMembers",
        (SELECT COUNT(*) FROM "Recharge" WHERE status = 'PENDING')                                 AS "pendingRecharges",
        (SELECT COUNT(*) FROM "Withdrawal" WHERE status = 'PENDING')                               AS "pendingWithdrawals",
        (SELECT COUNT(*) FROM "SecurityAlert" WHERE resolved = false)                              AS "openAlerts",
        (SELECT COUNT(*) FROM "Order" WHERE status IN ('PLACED','PACKED'))                         AS "toShip",
        (SELECT COUNT(*) FROM "Product" WHERE "isActive" = true AND stock <= 10)                   AS "lowStock"
    `;

    const revenue = row.revenue;
    const commission = row.commission;

    return {
      revenue: money(revenue),
      commissionPaid: money(commission),
      // Integer maths: no float ratio anywhere near the money figures.
      payoutRatioBp: revenue > 0n ? Number((commission * 10_000n) / revenue) : 0,
      businessVolume: volume(Number(row.bv)),
      walletFloat: money(row.walletFloat),
      orderCount: Number(row.orderCount),
      memberCount: Number(row.memberCount),
      activeMemberCount: Number(row.activeMembers),
      pendingRecharges: Number(row.pendingRecharges),
      pendingWithdrawals: Number(row.pendingWithdrawals),
      openAlerts: Number(row.openAlerts),
      ordersToShip: Number(row.toShip),
      lowStockCount: Number(row.lowStock),
    };
  }

  /**
   * Daily series for the dashboard charts.
   *
   * generate_series supplies the days, so a day with no orders comes back as a
   * zero rather than being missing. A chart that silently skips empty days
   * misrepresents a slow week as a straight line.
   */
  async dailySeries(days = 14): Promise<SeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<{ day: Date; revenue: bigint; orders: bigint; commission: bigint }[]>`
      WITH span AS (
        SELECT generate_series(
          date_trunc('day', NOW() - MAKE_INTERVAL(days => ${days - 1})),
          date_trunc('day', NOW()),
          '1 day'
        ) AS day
      )
      SELECT
        span.day,
        COALESCE(o.revenue, 0)::bigint    AS "revenue",
        COALESCE(o.orders, 0)             AS "orders",
        COALESCE(c.commission, 0)::bigint AS "commission"
      FROM span
      LEFT JOIN (
        SELECT date_trunc('day', "createdAt") AS day,
               SUM("totalPaise") AS revenue,
               COUNT(*)          AS orders
        FROM "Order"
        WHERE status <> 'CANCELLED'
        GROUP BY 1
      ) o ON o.day = span.day
      LEFT JOIN (
        SELECT date_trunc('day', "createdAt") AS day,
               SUM("amountPaise") AS commission
        FROM "Commission"
        GROUP BY 1
      ) c ON c.day = span.day
      ORDER BY span.day ASC
    `;

    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      revenue: money(r.revenue),
      orders: Number(r.orders),
      commission: money(r.commission),
    }));
  }

  /** Income split by type, for the "where the money goes" panel. */
  async commissionBreakdown(): Promise<{ type: string; total: MoneyView; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ type: string; total: bigint; count: bigint }[]>`
      SELECT type::text AS "type", SUM("amountPaise")::bigint AS "total", COUNT(*) AS "count"
      FROM "Commission"
      GROUP BY type
      ORDER BY SUM("amountPaise") DESC
    `;
    return rows.map((r) => ({ type: r.type, total: money(r.total), count: Number(r.count) }));
  }

  async topEarners(limit = 10) {
    const rows = await this.prisma.$queryRaw<
      { id: string; memberCode: string; name: string; rankIndex: number; total: bigint }[]
    >`
      SELECT m.id, m."memberCode", m.name, m."rankIndex", SUM(c."amountPaise")::bigint AS "total"
      FROM "Commission" c
      JOIN "Member" m ON m.id = c."memberId"
      GROUP BY m.id, m."memberCode", m.name, m."rankIndex"
      ORDER BY SUM(c."amountPaise") DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, memberCode: r.memberCode, name: r.name, rankIndex: r.rankIndex, earned: money(r.total),
    }));
  }

  async topProducts(limit = 10) {
    const rows = await this.prisma.$queryRaw<
      { id: string; sku: string; name: string; units: bigint; revenue: bigint; stock: number }[]
    >`
      SELECT p.id, p.sku, p.name, p.stock,
             COALESCE(SUM(oi.quantity), 0)                          AS "units",
             COALESCE(SUM(oi."pricePaise" * oi.quantity), 0)::bigint AS "revenue"
      FROM "Product" p
      LEFT JOIN "OrderItem" oi ON oi."productId" = p.id
      LEFT JOIN "Order" o ON o.id = oi."orderId" AND o.status <> 'CANCELLED'
      GROUP BY p.id, p.sku, p.name, p.stock
      ORDER BY COALESCE(SUM(oi."pricePaise" * oi.quantity), 0) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, sku: r.sku, name: r.name, stock: r.stock, unitsSold: Number(r.units), revenue: money(r.revenue),
    }));
  }

  /**
   * Members who have not met this month's repurchase target.
   *
   * Drives both the admin follow-up list and the answer to "why can't I
   * withdraw" before it reaches support.
   */
  async repurchaseShortfall(targetBvCenti: number, limit = 50) {
    const period = isoPeriod();
    const rows = await this.prisma.$queryRaw<
      { id: string; memberCode: string; name: string; bought: number; incomePaise: bigint }[]
    >`
      SELECT m.id, m."memberCode", m.name,
             COALESCE(mv."selfBvCenti", 0) AS "bought",
             COALESCE(w."balancePaise", 0)::bigint AS "incomePaise"
      FROM "Member" m
      LEFT JOIN "MonthlyVolume" mv ON mv."memberId" = m.id AND mv.period = ${period}
      LEFT JOIN "Wallet" w ON w."memberId" = m.id AND w.kind = 'INCOME'
      WHERE m."isCompany" = false
        AND m.status = 'ACTIVE'
        AND COALESCE(mv."selfBvCenti", 0) < ${targetBvCenti}
        AND COALESCE(w."balancePaise", 0) > 0
      ORDER BY w."balancePaise" DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, memberCode: r.memberCode, name: r.name,
      bought: volume(r.bought),
      shortfall: volume(targetBvCenti - r.bought),
      lockedIncome: money(r.incomePaise),
    }));
  }

  /**
   * Nightly reconciliation: every wallet whose stored balance disagrees with
   * its own ledger.
   *
   * This should always return zero rows. Anything else means something wrote to
   * Wallet outside LedgerService, and that is an incident, not a report.
   */
  async ledgerDrift() {
    const rows = await this.prisma.$queryRaw<
      { walletId: string; memberCode: string; kind: string; stored: bigint; derived: bigint; drift: bigint }[]
    >`
      SELECT w.id AS "walletId", m."memberCode", w.kind::text AS "kind",
             w."balancePaise"::bigint AS "stored",
             COALESCE(l.derived, 0)::bigint AS "derived",
             (w."balancePaise" - COALESCE(l.derived, 0))::bigint AS "drift"
      FROM "Wallet" w
      JOIN "Member" m ON m.id = w."memberId"
      LEFT JOIN (
        SELECT "walletId",
               SUM(CASE WHEN direction = 'CREDIT' THEN "amountPaise" ELSE -"amountPaise" END) AS derived
        FROM "LedgerEntry"
        GROUP BY "walletId"
      ) l ON l."walletId" = w.id
      WHERE w."balancePaise" <> COALESCE(l.derived, 0)
    `;
    return rows.map((r) => ({
      walletId: r.walletId, memberCode: r.memberCode, kind: r.kind,
      stored: money(r.stored), derived: money(r.derived), drift: money(r.drift),
    }));
  }
}
