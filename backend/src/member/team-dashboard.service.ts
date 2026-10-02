import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { volume } from '../common/serialization';
import { isoPeriod, previousPeriod } from '../common/period';
import { safeParsePlan } from './view.service';

/**
 * The member's business dashboard: how big the team is, how this month is
 * going against the monthly purchase target, how far the next rank is, and which
 * of their direct team could use a nudge.
 *
 * It deliberately carries no income, commission or earnings figure of any kind
 * (a compliance rule for anything a member might screenshot and share). Volume
 * and counts only. It also ships no phone numbers or surnames of the team: a
 * nudge goes through the platform, as a message from the member, not through
 * the member's contact list.
 */

const NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 20;
const NEW_MEMBER_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

export type NudgeReason = 'BELOW_TARGET' | 'NO_ORDER_THIS_MONTH' | 'NEVER_ORDERED';

const REASON_ORDER: Record<NudgeReason, number> = { BELOW_TARGET: 0, NO_ORDER_THIS_MONTH: 1, NEVER_ORDERED: 2 };

/** Pure: who needs a nudge, most promising first. Exported for tests. */
export function pickNudges(
  directs: { id: string; name: string; code: string; status: string; joinedAt: Date; monthBvCenti: number; orders: number; lastOrderAt: Date | null }[],
  targetBvCenti: number | null,
  now: Date,
  recentlyNudged: Set<string>,
): { id: string; name: string; code: string; reason: NudgeReason; monthBvCenti: number; gapBvCenti: number | null; lastOrderAt: Date | null; nudgedRecently: boolean }[] {
  const out = [];
  for (const d of directs) {
    if (d.status !== 'ACTIVE') continue;
    let reason: NudgeReason | null = null;
    if (d.orders === 0) {
      if (now.getTime() - d.joinedAt.getTime() >= NEW_MEMBER_GRACE_MS) reason = 'NEVER_ORDERED';
    } else if (d.monthBvCenti === 0) {
      reason = 'NO_ORDER_THIS_MONTH';
    } else if (targetBvCenti !== null && d.monthBvCenti < targetBvCenti) {
      reason = 'BELOW_TARGET';
    }
    if (!reason) continue;
    out.push({
      id: d.id, name: d.name, code: d.code, reason, monthBvCenti: d.monthBvCenti,
      gapBvCenti: targetBvCenti !== null ? Math.max(0, targetBvCenti - d.monthBvCenti) : null,
      lastOrderAt: d.lastOrderAt, nudgedRecently: recentlyNudged.has(d.id),
    });
  }
  // Closest to the line first (a small push goes furthest), then the lapsed, then the never-started.
  return out.sort((a, b) =>
    REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
    (a.gapBvCenti ?? 0) - (b.gapBvCenti ?? 0) ||
    a.name.localeCompare(b.name),
  );
}

@Injectable()
export class TeamDashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async dashboard(memberId: string) {
    const now = new Date();
    const period = isoPeriod(now);
    const me = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { id: true, ancestorPath: true, depth: true, rankIndex: true, selfBvCenti: true, groupBvCenti: true },
    });
    const prefix = `${me.ancestorPath}${me.id}/`;

    const [plan, team, directs, monthly] = await Promise.all([
      this.prisma.planVersion.findFirst({ orderBy: { version: 'desc' }, select: { config: true } }),
      this.prisma.member.findMany({
        where: { ancestorPath: { startsWith: prefix } },
        select: { status: true, joinedAt: true },
      }),
      this.prisma.member.findMany({
        where: { sponsorId: memberId },
        select: { id: true, name: true, memberCode: true, status: true, joinedAt: true },
        take: 500,
      }),
      this.prisma.monthlyVolume.findMany({
        where: { memberId, period: { in: lastPeriods(period, 6) } },
        select: { period: true, selfBvCenti: true, groupBvCenti: true },
      }),
    ]);

    const parsed = safeParsePlan(plan?.config);
    const target = parsed?.repurchase.enabled ? parsed.repurchase.monthlyBvCenti : null;
    const ranks = parsed?.ranks ?? [];
    const current = ranks[me.rankIndex] ?? null;
    const next = ranks[me.rankIndex + 1] ?? null;
    const rankBv = parsed?.rankBasis === 'TEAM_BV' ? Number(me.groupBvCenti) - Number(me.selfBvCenti) : Number(me.groupBvCenti);

    const thisMonth = monthly.find((m) => m.period === period);
    const own = thisMonth?.selfBvCenti ?? 0;

    // Directs: this month's volume and order history, in two grouped reads rather than one per person.
    const ids = directs.map((d) => d.id);
    const [monthRows, orderRows, nudges] = ids.length
      ? await Promise.all([
          this.prisma.monthlyVolume.findMany({ where: { memberId: { in: ids }, period }, select: { memberId: true, selfBvCenti: true } }),
          this.prisma.order.groupBy({
            by: ['memberId'],
            where: { memberId: { in: ids }, status: { not: 'CANCELLED' } },
            _count: { _all: true },
            _max: { createdAt: true },
          }),
          this.prisma.notification.findMany({
            where: { memberId: { in: ids }, kind: 'NUDGE', createdAt: { gte: new Date(now.getTime() - NUDGE_COOLDOWN_MS) } },
            select: { memberId: true },
          }),
        ])
      : [[], [], []];
    const monthBv = new Map(monthRows.map((r) => [r.memberId, r.selfBvCenti]));
    const orders = new Map(orderRows.map((r) => [r.memberId, { n: r._count._all, last: r._max.createdAt }]));
    const nudged = new Set(nudges.map((n) => n.memberId));

    const needs = pickNudges(
      directs.map((d) => ({
        id: d.id, name: d.name.split(' ')[0], code: d.memberCode, status: d.status, joinedAt: d.joinedAt,
        monthBvCenti: monthBv.get(d.id) ?? 0, orders: orders.get(d.id)?.n ?? 0, lastOrderAt: orders.get(d.id)?.last ?? null,
      })),
      target, now, nudged,
    );

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const reachedTarget = target !== null ? directs.filter((d) => (monthBv.get(d.id) ?? 0) >= target).length : null;

    return {
      period,
      daysLeft: daysInMonth - now.getDate(),
      team: {
        total: team.length,
        active: team.filter((t) => t.status === 'ACTIVE').length,
        direct: directs.length,
        joinedThisMonth: team.filter((t) => t.joinedAt >= monthStart).length,
      },
      month: {
        own: volume(own),
        group: volume(thisMonth?.groupBvCenti ?? 0),
        target: target !== null ? volume(target) : null,
        targetPct: target ? Math.min(100, Math.round((own / target) * 100)) : null,
        remaining: target !== null ? volume(Math.max(0, target - own)) : null,
        directsOnTarget: reachedTarget,
      },
      history: lastPeriods(period, 6).reverse().map((p) => {
        const m = monthly.find((x) => x.period === p);
        return { period: p, own: volume(m?.selfBvCenti ?? 0), group: volume(m?.groupBvCenti ?? 0) };
      }),
      rank: {
        name: current?.name ?? 'Member',
        next: next
          ? {
              name: next.name,
              requiredBv: volume(next.minBvCenti),
              currentBv: volume(rankBv),
              remainingBv: volume(Math.max(0, next.minBvCenti - rankBv)),
              pct: Math.min(100, Math.round((rankBv / Math.max(1, next.minBvCenti)) * 100)),
            }
          : null,
      },
      needsNudge: needs.slice(0, LIST_LIMIT).map((n) => ({
        id: n.id, name: n.name, code: n.code, reason: n.reason,
        monthBv: volume(n.monthBvCenti),
        gapBv: n.gapBvCenti !== null ? volume(n.gapBvCenti) : null,
        lastOrderAt: n.lastOrderAt,
        nudgedRecently: n.nudgedRecently,
      })),
      needsNudgeTotal: needs.length,
    };
  }

  /**
   * Send one of the member's direct team a friendly reminder, as an in-app
   * notification (relayed by SMS/WhatsApp like the others). Limited to once
   * every three days per person, so a sponsor cannot pester anyone, and
   * limited to people who are actually behind, so it cannot be used to message
   * someone for no reason. The wording is fixed and carries no earnings talk.
   */
  async nudge(memberId: string, childId: string) {
    const [me, child] = await Promise.all([
      this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { name: true, memberCode: true } }),
      this.prisma.member.findFirst({ where: { id: childId, sponsorId: memberId }, select: { id: true, name: true, status: true } }),
    ]);
    if (!child) throw new NotFoundException('That member is not on your direct team.');
    if (child.status !== 'ACTIVE') throw new BadRequestException('That member is not active.');

    const now = new Date();
    const recent = await this.prisma.notification.findFirst({
      where: { memberId: childId, kind: 'NUDGE', createdAt: { gte: new Date(now.getTime() - NUDGE_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) throw new ConflictException('You reminded them recently. Give it a few days.');

    const dash = await this.dashboard(memberId);
    const entry = dash.needsNudge.find((n) => n.id === childId);
    if (!entry) throw new BadRequestException('They are on track, so there is nothing to remind them about.');

    const sponsor = me.name.split(' ')[0];
    const first = child.name.split(' ')[0];
    const text =
      entry.reason === 'NEVER_ORDERED'
        ? `Hi ${first}, ${sponsor} here. Your first order is waiting for you on Majestic Cart.`
        : entry.reason === 'NO_ORDER_THIS_MONTH'
          ? `Hi ${first}, ${sponsor} here. You have not ordered this month yet. Your monthly purchase is still open.`
          : `Hi ${first}, ${sponsor} here. You are close to your monthly purchase target this month. ${entry.gapBv?.display ?? ''} to go.`.replace('  ', ' ');
    await this.prisma.notification.create({
      data: { memberId: childId, kind: 'NUDGE', title: `A note from ${sponsor}`, body: text },
    });
    return { sent: true };
  }
}

function lastPeriods(from: string, n: number): string[] {
  const out = [from];
  while (out.length < n) out.push(previousPeriod(out[out.length - 1]));
  return out;
}
