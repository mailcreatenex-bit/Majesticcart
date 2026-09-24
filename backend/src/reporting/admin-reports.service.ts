import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Four fixed operating reports for the admin console.
 *
 * Kept apart from the configurable report compiler (reporting/compiler.ts) on purpose:
 * these are the questions an owner asks every week, they need shapes the generic
 * query builder does not offer (a daily series, a "has not ordered since" filter), and
 * a fixed query is easier to trust for a report that gets acted on.
 *
 * Money is returned as rupee numbers and rows are already plain values, so the console
 * renders and exports them without knowing anything about the schema.
 */

export interface ReportResult {
  key: string;
  title: string;
  description: string;
  columns: { key: string; label: string; kind?: 'money' | 'percent' | 'number' | 'date' | 'text' }[];
  rows: Record<string, string | number | null>[];
  note?: string;
}

const INCOME_CATEGORIES = ['SELF_INCOME', 'DIRECT_INCOME', 'TEAM_INCOME', 'GENERATION_BONUS', 'ROYALTY'];
const rupees = (paise: unknown): number => Math.round(Number(paise ?? 0)) / 100;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaClient) {}

  list() {
    return [
      { key: 'payout-vs-sales', title: 'Payout against sales' },
      { key: 'top-sponsors', title: 'Top sponsors' },
      { key: 'new-joins', title: 'New joins per day' },
      { key: 'inactive-members', title: 'Inactive members' },
    ];
  }

  async run(key: string, opts: { days?: number } = {}): Promise<ReportResult> {
    switch (key) {
      case 'payout-vs-sales': return this.payoutVsSales();
      case 'top-sponsors': return this.topSponsors();
      case 'new-joins': return this.newJoins();
      case 'inactive-members': return this.inactive(opts.days);
      default: throw new NotFoundException('Unknown report');
    }
  }

  /** What the plan paid out each month, against what was sold. The ratio is the number to watch. */
  private async payoutVsSales(): Promise<ReportResult> {
    const [sales, payouts] = await Promise.all([
      this.prisma.$queryRaw<{ m: Date; total: bigint; bv: bigint; orders: bigint }[]>`
        SELECT date_trunc('month', "deliveredAt") AS m, SUM("totalPaise") AS total, SUM("totalBvCenti")::bigint AS bv, COUNT(*) AS orders
        FROM "Order" WHERE status = 'DELIVERED' AND "deliveredAt" IS NOT NULL AND "deliveredAt" > now() - interval '12 months'
        GROUP BY 1 ORDER BY 1 DESC`,
      this.prisma.$queryRaw<{ m: Date; total: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS m, SUM("amountPaise") AS total
        FROM "LedgerEntry" WHERE direction = 'CREDIT' AND category::text = ANY(${INCOME_CATEGORIES}) AND "createdAt" > now() - interval '12 months'
        GROUP BY 1`,
    ]);
    const paid = new Map(payouts.map((p) => [dayKey(p.m).slice(0, 7), Number(p.total)]));
    const months = new Set([...sales.map((s) => dayKey(s.m).slice(0, 7)), ...paid.keys()]);
    const bySales = new Map(sales.map((s) => [dayKey(s.m).slice(0, 7), s]));

    const rows = [...months].sort().reverse().map((month) => {
      const s = bySales.get(month);
      const salesPaise = Number(s?.total ?? 0);
      const payPaise = paid.get(month) ?? 0;
      return {
        month,
        orders: Number(s?.orders ?? 0),
        sales: rupees(salesPaise),
        bv: Number(s?.bv ?? 0) / 100,
        payout: rupees(payPaise),
        ratio: salesPaise > 0 ? Math.round((payPaise / salesPaise) * 1000) / 10 : null,
      };
    });
    return {
      key: 'payout-vs-sales',
      title: 'Payout against sales',
      description: 'Income credited to members each month, against the value of orders delivered that month.',
      columns: [
        { key: 'month', label: 'Month', kind: 'text' },
        { key: 'orders', label: 'Delivered orders', kind: 'number' },
        { key: 'sales', label: 'Sales (Rs)', kind: 'money' },
        { key: 'bv', label: 'Business volume', kind: 'number' },
        { key: 'payout', label: 'Income paid (Rs)', kind: 'money' },
        { key: 'ratio', label: 'Payout % of sales', kind: 'percent' },
      ],
      rows,
      note: 'Payout can land in a different month from the sale that earned it (it follows delivery), so read a few months together.',
    };
  }

  /** Sponsors ranked by how many people they brought in, with the size of what sits below them. */
  private async topSponsors(): Promise<ReportResult> {
    const groups = await this.prisma.member.groupBy({
      by: ['sponsorId'],
      where: { sponsorId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { sponsorId: 'desc' } },
      take: 25,
    });
    const ids = groups.map((g) => g.sponsorId as string);
    const [members, monthAgo] = await Promise.all([
      this.prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, memberCode: true, name: true, rankIndex: true, groupBvCenti: true, status: true } }),
      this.prisma.member.groupBy({ by: ['sponsorId'], where: { sponsorId: { in: ids }, joinedAt: { gt: new Date(Date.now() - 30 * 86400_000) } }, _count: { _all: true } }),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));
    const recent = new Map(monthAgo.map((g) => [g.sponsorId as string, g._count._all]));
    const rows = groups.map((g) => {
      const m = byId.get(g.sponsorId as string);
      return {
        code: m?.memberCode ?? '',
        name: m?.name ?? '',
        status: m?.status ?? '',
        rank: m?.rankIndex ?? 0,
        direct: g._count._all,
        last30: recent.get(g.sponsorId as string) ?? 0,
        groupBv: Number(m?.groupBvCenti ?? 0) / 100,
      };
    });
    return {
      key: 'top-sponsors',
      title: 'Top sponsors',
      description: 'The 25 members with the most direct sign-ups.',
      columns: [
        { key: 'code', label: 'Member ID', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'status', label: 'Status', kind: 'text' },
        { key: 'rank', label: 'Rank #', kind: 'number' },
        { key: 'direct', label: 'Direct sign-ups', kind: 'number' },
        { key: 'last30', label: 'Last 30 days', kind: 'number' },
        { key: 'groupBv', label: 'Group BV', kind: 'number' },
      ],
      rows,
    };
  }

  private async newJoins(): Promise<ReportResult> {
    const raw = await this.prisma.$queryRaw<{ d: Date; n: bigint }[]>`
      SELECT date_trunc('day', "joinedAt") AS d, COUNT(*) AS n FROM "Member"
      WHERE "joinedAt" > now() - interval '30 days' AND "isCompany" = false GROUP BY 1`;
    const counts = new Map(raw.map((r) => [dayKey(r.d), Number(r.n)]));
    // Every day in the window, including the quiet ones - a gap is information.
    const rows: ReportResult['rows'] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - i * 86400_000);
      const k = dayKey(d);
      rows.push({ date: k, joins: counts.get(k) ?? 0 });
    }
    return {
      key: 'new-joins',
      title: 'New joins per day',
      description: 'Members who registered, for each of the last 30 days.',
      columns: [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'joins', label: 'New members', kind: 'number' }],
      rows,
      note: `${rows.reduce((a, r) => a + Number(r.joins), 0)} new members in the last 30 days.`,
    };
  }

  /** Active accounts that have not bought anything for a while: the people to reach out to. */
  private async inactive(daysInput?: number): Promise<ReportResult> {
    const days = Math.min(365, Math.max(7, Math.floor(daysInput ?? 60) || 60));
    const cutoff = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.$queryRaw<{ code: string; name: string; phone: string; joined: Date; last_order: Date | null; sponsor: string | null }[]>(Prisma.sql`
      SELECT m."memberCode" AS code, m.name, m.phone, m."joinedAt" AS joined,
             (SELECT MAX(o."createdAt") FROM "Order" o WHERE o."memberId" = m.id AND o.status <> 'CANCELLED') AS last_order,
             s."memberCode" AS sponsor
      FROM "Member" m LEFT JOIN "Member" s ON s.id = m."sponsorId"
      WHERE m.status = 'ACTIVE' AND m."isCompany" = false AND m."joinedAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."memberId" = m.id AND o.status <> 'CANCELLED' AND o."createdAt" >= ${cutoff})
      ORDER BY last_order ASC NULLS FIRST LIMIT 200`);
    return {
      key: 'inactive-members',
      title: 'Inactive members',
      description: `Active members who joined more than ${days} days ago and have not placed an order in the last ${days} days.`,
      columns: [
        { key: 'code', label: 'Member ID', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'phone', label: 'Phone', kind: 'text' },
        { key: 'sponsor', label: 'Sponsor', kind: 'text' },
        { key: 'joined', label: 'Joined', kind: 'date' },
        { key: 'lastOrder', label: 'Last order', kind: 'date' },
      ],
      rows: rows.map((r) => ({ code: r.code, name: r.name, phone: r.phone, sponsor: r.sponsor, joined: dayKey(r.joined), lastOrder: r.last_order ? dayKey(r.last_order) : null })),
      note: rows.length === 200 ? 'Showing the first 200, the longest-inactive first.' : undefined,
    };
  }
}
