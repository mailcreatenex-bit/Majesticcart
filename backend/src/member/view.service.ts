import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type WalletKind } from '@prisma/client';
import { money, volume } from '../common/serialization';
import { isoPeriod } from '../common/period';
import { downlinePrefix } from './genealogy';
import { parsePlan, type PlanConfig } from '../plan/plan.config';

/**
 * Read models for the member app.
 *
 * Separate from the services that write, because the rules are different. A
 * write path cares about locking and idempotency; a read path cares about
 * scoping and about not handing the browser a query that gets slower as the
 * member's team grows.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. **Every query is scoped by the caller's own id**, taken from the access
 *      token — never from a parameter. There is no method here that can be
 *      pointed at another member's row by changing a value in the URL.
 *   2. **Everything is paged.** A member with 10,000 people below them must not
 *      be able to ask for all of them, and neither must their browser by
 *      accident. Depth and page size are capped here rather than trusted from
 *      the query string.
 */

/** Deliberately small. A phone on 3G renders 25 rows fine and 500 rows badly. */
const PAGE = 25;
const MAX_PAGE = 100;
const MAX_TREE_DEPTH = 10;

const clampPage = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return PAGE;
  return Math.min(Math.floor(v), MAX_PAGE);
};

@Injectable()
export class MemberViewService {
  constructor(private readonly prisma: PrismaClient) {}

  /* ------------------------------------------------------------ dashboard */

  /**
   * The home screen after login: who they are, what they hold, where they
   * stand this month.
   *
   * One round trip rather than the five separate calls the screen would
   * otherwise make, because this is the request that runs on every app open
   * and the audience is mid-range Android on mobile data.
   */
  async dashboard(memberId: string) {
    const period = isoPeriod(new Date());

    const [member, wallets, monthly, plan, pendingRecharges, pendingWithdrawals, unread] =
      await Promise.all([
        this.prisma.member.findUniqueOrThrow({
          where: { id: memberId },
          select: {
            id: true, memberCode: true, name: true, phone: true, email: true,
            status: true, rankIndex: true, selfBvCenti: true, groupBvCenti: true,
            joinedAt: true, sponsorId: true, photoKey: true, city: true, state: true,
          },
        }),
        this.prisma.wallet.findMany({
          where: { memberId },
          select: { kind: true, balancePaise: true },
        }),
        this.prisma.monthlyVolume.findUnique({
          where: { memberId_period: { memberId, period } },
          select: { selfBvCenti: true, groupBvCenti: true },
        }),
        // The live plan is the highest version, matching every other caller.
        this.prisma.planVersion.findFirst({
          orderBy: { version: 'desc' },
          select: { id: true, config: true },
        }),
        this.prisma.recharge.count({ where: { memberId, status: 'PENDING' } }),
        this.prisma.withdrawal.count({ where: { memberId, status: 'PENDING' } }),
        this.prisma.notification.count({ where: { memberId, readAt: null } }),
      ]);

    const directCount = await this.prisma.member.count({ where: { sponsorId: memberId } });

    const parsed = safeParsePlan(plan?.config);
    const ranks = parsed?.ranks ?? [];
    const current = ranks[member.rankIndex] ?? null;
    const next = ranks[member.rankIndex + 1] ?? null;

    // Which volume the ladder is measured against is itself a plan setting, so
    // the progress bar has to read it rather than assume group BV.
    const rankBv = parsed?.rankBasis === 'TEAM_BV'
      ? Number(member.groupBvCenti) - Number(member.selfBvCenti)
      : Number(member.groupBvCenti);

    return {
      member: {
        id: member.id,
        code: member.memberCode,
        name: member.name,
        phone: member.phone,
        email: member.email,
        status: member.status,
        joinedAt: member.joinedAt,
        // Turned into a public URL by the controller; the key itself is not sent on.
        photoKey: member.photoKey,
        location: [member.city, member.state].filter(Boolean).join(', ') || null,
      },
      rank: {
        index: member.rankIndex,
        name: current?.name ?? 'Member',
        // What it takes to reach the next one, so the screen can show progress
        // without the client knowing the plan. Null at the top rank.
        next: next
          ? {
              name: next.name,
              requiredBv: volume(next.minBvCenti),
              remainingBv: volume(Math.max(0, next.minBvCenti - rankBv)),
              // The member's own number against the requirement, what the ladder is counted on,
              // and what the next rank pays - so the screen can say what is still needed, in full.
              currentBv: volume(rankBv),
              basis: parsed?.rankBasis ?? 'GROUP_BV',
              selfPct: next.selfPctBp / 100,
              teamPct: next.teamPctBp / 100,
              currentSelfPct: (current?.selfPctBp ?? 0) / 100,
              currentTeamPct: (current?.teamPctBp ?? 0) / 100,
            }
          : null,
      },
      wallets: {
        shopping: money(wallets.find((w) => w.kind === 'SHOPPING')?.balancePaise ?? 0n),
        income: money(wallets.find((w) => w.kind === 'INCOME')?.balancePaise ?? 0n),
      },
      volume: {
        lifetimeSelf: volume(Number(member.selfBvCenti)),
        lifetimeGroup: volume(Number(member.groupBvCenti)),
        period,
        periodSelf: volume(monthly?.selfBvCenti ?? 0),
        periodGroup: volume(monthly?.groupBvCenti ?? 0),
      },
      team: { direct: directCount },
      // The monthly purchase a member is expected to make, read from the live plan so nothing
      // that shows it (the ID card's target design) has its own copy of the number.
      repurchase: parsed?.repurchase.enabled ? { targetBv: volume(parsed.repurchase.monthlyBvCenti) } : null,
      pending: { recharges: pendingRecharges, withdrawals: pendingWithdrawals, notifications: unread },
    };
  }

  /* --------------------------------------------------------------- wallet */

  /**
   * A wallet statement.
   *
   * `balanceAfter` is stored on every entry, so a statement is one indexed read
   * with no running total to recompute — and the number a member sees on a row
   * is the number that was true at that moment, not one derived now from a
   * different set of rows.
   */
  async statement(memberId: string, kind: WalletKind, opts: { cursor?: string; take?: unknown } = {}) {
    const take = clampPage(opts.take);

    const wallet = await this.prisma.wallet.findUnique({
      where: { memberId_kind: { memberId, kind } },
      select: { id: true, balancePaise: true, updatedAt: true },
    });
    // A member who has never transacted has no wallet row yet. That is an empty
    // statement, not an error.
    if (!wallet) {
      return { kind, balance: money(0n), entries: [], nextCursor: null };
    }

    const rows = await this.prisma.ledgerEntry.findMany({
      where: { memberId, walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: take + 1, // one extra to detect a further page without a count()
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true, direction: true, amountPaise: true, category: true,
        balanceAfter: true, refType: true, refId: true, note: true, createdAt: true,
      },
    });

    const page = rows.slice(0, take);

    return {
      kind,
      balance: money(wallet.balancePaise),
      updatedAt: wallet.updatedAt,
      entries: page.map((e) => ({
        id: e.id,
        direction: e.direction,
        amount: money(e.amountPaise),
        balanceAfter: money(e.balanceAfter),
        category: e.category,
        label: CATEGORY_LABELS[e.category] ?? e.category,
        ref: e.refType && e.refId ? { type: e.refType, id: e.refId } : null,
        note: e.note,
        at: e.createdAt,
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /** Recharge history, so a pending request is visible while it waits. */
  async recharges(memberId: string, opts: { cursor?: string; take?: unknown } = {}) {
    const take = clampPage(opts.take);
    const rows = await this.prisma.recharge.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true, claimedPaise: true, creditedPaise: true, utr: true,
        status: true, reviewNote: true, reviewedAt: true, createdAt: true,
      },
    });
    const page = rows.slice(0, take);

    return {
      requests: page.map((r) => ({
        id: r.id,
        claimed: money(r.claimedPaise),
        // Null until a decision. An admin may approve a different amount from
        // the one claimed, and the member should see which.
        credited: r.creditedPaise == null ? null : money(r.creditedPaise),
        utr: r.utr,
        status: r.status,
        // The review note reaches the member: a rejection they cannot explain
        // becomes a support call, and in an MLM it becomes an accusation.
        note: r.reviewNote,
        reviewedAt: r.reviewedAt,
        at: r.createdAt,
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /* --------------------------------------------------------------- orders */

  async orders(memberId: string, opts: { cursor?: string; take?: unknown } = {}) {
    const take = clampPage(opts.take);
    const rows = await this.prisma.order.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true, orderNo: true, status: true, totalPaise: true, totalBvCenti: true,
        invoiceNo: true, createdAt: true, deliveredAt: true,
        items: { select: { nameSnapshot: true, quantity: true }, take: 3 },
        _count: { select: { items: true } },
      },
    });
    const page = rows.slice(0, take);

    return {
      orders: page.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        total: money(o.totalPaise),
        businessVolume: volume(o.totalBvCenti),
        // Present only once delivered — an invoice number is assigned at supply,
        // so its absence is what tells the UI not to offer a download.
        invoiceNo: o.invoiceNo,
        placedAt: o.createdAt,
        deliveredAt: o.deliveredAt,
        summary: o.items.map((i: { nameSnapshot: string; quantity: number }) => `${i.nameSnapshot} × ${i.quantity}`),
        itemCount: o._count.items,
      })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  /**
   * One order in full.
   *
   * Scoped by `memberId` in the WHERE clause rather than fetched and then
   * checked, so there is no branch that can be forgotten and no timing
   * difference between "not yours" and "does not exist".
   */
  async order(memberId: string, orderId: string) {
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, memberId },
      select: {
        id: true, orderNo: true, status: true,
        subtotalPaise: true, gstPaise: true, totalPaise: true, totalBvCenti: true,
        shipName: true, shipPhone: true, shipLine: true, shipCity: true,
        shipState: true, shipPincode: true,
        invoiceNo: true, invoicedAt: true, createdAt: true, deliveredAt: true,
        items: {
          select: {
            nameSnapshot: true, pricePaise: true, mrpPaise: true,
            bvCenti: true, gstBp: true, quantity: true,
            product: { select: { slug: true, imageUrl: true } },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { status: true, note: true, createdAt: true },
        },
      },
    });
    if (!o) throw new NotFoundException('Order not found');

    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      totals: {
        subtotal: money(o.subtotalPaise),
        gst: money(o.gstPaise),
        total: money(o.totalPaise),
        businessVolume: volume(o.totalBvCenti),
      },
      shipping: {
        name: o.shipName, phone: o.shipPhone, line: o.shipLine,
        city: o.shipCity, state: o.shipState, pincode: o.shipPincode,
      },
      items: o.items.map((i: OrderItemRow) => ({
        name: i.nameSnapshot,
        slug: i.product?.slug ?? null,
        imageUrl: i.product?.imageUrl ?? null,
        price: money(i.pricePaise),
        mrp: money(i.mrpPaise),
        businessVolume: volume(i.bvCenti),
        gstPercent: i.gstBp / 100,
        quantity: i.quantity,
        lineTotal: money(i.pricePaise * BigInt(i.quantity)),
      })),
      timeline: o.events.map((e: OrderEventRow) => ({ status: e.status, note: e.note, at: e.createdAt })),
      invoice: o.invoiceNo ? { number: o.invoiceNo, at: o.invoicedAt } : null,
      placedAt: o.createdAt,
      deliveredAt: o.deliveredAt,
    };
  }

  /* -------------------------------------------------------------- network */

  /**
   * The team, as counts per level plus the direct list.
   *
   * Counts come from one grouped prefix query on `ancestorPath`, not from
   * walking the tree — a 10,000-member downline is a single indexed range scan
   * here, and was the difference between 4ms and a timeout in the load test.
   *
   * The full tree is deliberately not an endpoint. A member can expand a branch
   * at a time; nothing returns everyone below them in one response.
   */
  /** This month's own purchase volume for a set of members, as a lookup by member id. */
  private async monthlyBv(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.monthlyVolume.findMany({
      where: { memberId: { in: ids }, period: isoPeriod(new Date()) },
      select: { memberId: true, selfBvCenti: true },
    });
    return new Map(rows.map((r) => [r.memberId, Number(r.selfBvCenti)]));
  }

  /** What the team screens need from the live plan: rank names and the monthly purchase target. */
  private async teamPlanFacts() {
    const plan = await this.prisma.planVersion.findFirst({ orderBy: { version: 'desc' }, select: { config: true } });
    const parsed = safeParsePlan(plan?.config);
    return {
      rankNames: (parsed?.ranks ?? []).map((r) => r.name),
      target: parsed?.repurchase.enabled ? volume(parsed.repurchase.monthlyBvCenti) : null,
    };
  }

  async network(memberId: string, opts: { depth?: unknown } = {}) {
    const me = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { id: true, memberCode: true, ancestorPath: true, depth: true },
    });

    const maxDepth = Math.min(
      Math.max(1, Number(opts.depth) || MAX_TREE_DEPTH),
      MAX_TREE_DEPTH,
    );

    // Prefix match on the materialised path: "/a/b/" + id + "/". The trailing
    // slash is load-bearing — without it "/a/b/12/" also matches member "123".
    const prefix = downlinePrefix(me);

    const rows = await this.prisma.member.findMany({
      where: {
        ancestorPath: { startsWith: prefix },
        depth: { lte: me.depth + maxDepth },
      },
      select: { depth: true, status: true },
    });

    const levels = new Map<number, { total: number; active: number }>();
    for (const r of rows) {
      const level = r.depth - me.depth;
      const bucket = levels.get(level) ?? { total: 0, active: 0 };
      bucket.total += 1;
      if (r.status === 'ACTIVE') bucket.active += 1;
      levels.set(level, bucket);
    }

    const directs = await this.prisma.member.findMany({
      where: { sponsorId: memberId },
      orderBy: { joinedAt: 'desc' },
      take: MAX_PAGE,
      select: {
        id: true, memberCode: true, name: true, status: true, rankIndex: true,
        groupBvCenti: true, joinedAt: true,
        _count: { select: { downline: true } },
      },
    });

    const [monthBv, facts] = await Promise.all([this.monthlyBv(directs.map((d) => d.id)), this.teamPlanFacts()]);

    return {
      me: { code: me.memberCode, depth: me.depth },
      period: isoPeriod(new Date()),
      rankNames: facts.rankNames,
      target: facts.target,
      levels: [...levels.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, v]) => ({ level, ...v })),
      totals: {
        team: rows.length,
        active: rows.filter((r) => r.status === 'ACTIVE').length,
        direct: directs.length,
      },
      directs: directs.map((d) => ({
        id: d.id,
        code: d.memberCode,
        // First name only. A downline list is a list of real people's contact
        // details, and there is no reason to ship more of it than the screen
        // needs.
        name: d.name.split(' ')[0],
        status: d.status,
        rankIndex: d.rankIndex,
        groupBv: volume(Number(d.groupBvCenti)),
        monthBv: volume(monthBv.get(d.id) ?? 0),
        directCount: d._count.downline,
        joinedAt: d.joinedAt,
      })),
      truncated: directs.length === MAX_PAGE,
    };
  }

  /**
   * One branch, expanded. The children of a member the caller can actually see.
   *
   * The ownership check is the prefix comparison: `childId`'s ancestorPath must
   * start with the caller's own subtree prefix. Anyone outside it is a 404.
   */
  async branch(memberId: string, childId: string) {
    const [me, child] = await Promise.all([
      this.prisma.member.findUniqueOrThrow({
        where: { id: memberId },
        select: { id: true, ancestorPath: true, depth: true },
      }),
      this.prisma.member.findUnique({
        where: { id: childId },
        select: { id: true, ancestorPath: true, memberCode: true },
      }),
    ]);

    if (!child || !child.ancestorPath.startsWith(downlinePrefix(me))) {
      throw new NotFoundException('Member not found in your team');
    }

    const children = await this.prisma.member.findMany({
      where: { sponsorId: childId },
      orderBy: { joinedAt: 'desc' },
      take: MAX_PAGE,
      select: {
        id: true, memberCode: true, name: true, status: true, rankIndex: true,
        joinedAt: true, _count: { select: { downline: true } },
      },
    });

    const monthBv = await this.monthlyBv(children.map((c) => c.id));

    return {
      parent: child.memberCode,
      children: children.map((c) => ({
        id: c.id,
        code: c.memberCode,
        name: c.name.split(' ')[0],
        status: c.status,
        rankIndex: c.rankIndex,
        monthBv: volume(monthBv.get(c.id) ?? 0),
        directCount: c._count.downline,
        joinedAt: c.joinedAt,
      })),
    };
  }

  /**
   * Find someone in your own team by first name or member ID.
   *
   * Scoped exactly like `branch()`: only members whose ancestor path sits under the
   * caller's subtree prefix can match, so it cannot be used to look up anyone outside
   * the team. It returns the same minimal fields as the tree - first name, code, rank,
   * this month's purchase volume - and how many levels down the person is.
   */
  async searchTeam(memberId: string, q: unknown) {
    const term = String(q ?? '').trim();
    if (term.length < 2) return { results: [] };

    const me = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { id: true, ancestorPath: true, depth: true },
    });
    const rows = await this.prisma.member.findMany({
      where: {
        ancestorPath: { startsWith: downlinePrefix(me) },
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { memberCode: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ depth: 'asc' }, { joinedAt: 'desc' }],
      take: 20,
      select: {
        id: true, memberCode: true, name: true, status: true, rankIndex: true,
        joinedAt: true, depth: true, _count: { select: { downline: true } },
      },
    });
    const monthBv = await this.monthlyBv(rows.map((r) => r.id));
    return {
      results: rows.map((r) => ({
        id: r.id,
        code: r.memberCode,
        name: r.name.split(' ')[0],
        status: r.status,
        rankIndex: r.rankIndex,
        monthBv: volume(monthBv.get(r.id) ?? 0),
        directCount: r._count.downline,
        joinedAt: r.joinedAt,
        level: r.depth - me.depth,
      })),
    };
  }

  /* -------------------------------------------------------- notifications */

  async notifications(memberId: string, opts: { cursor?: string; take?: unknown } = {}) {
    const take = clampPage(opts.take);
    const rows = await this.prisma.notification.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { id: true, title: true, body: true, kind: true, readAt: true, createdAt: true },
    });
    const page = rows.slice(0, take);
    return {
      notifications: page.map((n) => ({ ...n, at: n.createdAt })),
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
    };
  }

  async markNotificationsRead(memberId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { memberId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: count };
  }
}

/* ------------------------------------------------------------- helpers */

/**
 * The shapes the two nested `select`s above project.
 *
 * Written out because this repository builds against a Prisma stub (the real
 * engines come from a blocked host), so nested relations infer as `any` here.
 * Once `prisma generate` has run these are checked against the schema rather
 * than trusted, which is the point of declaring them at all: a column renamed
 * in the schema fails the build here instead of silently returning undefined.
 */
interface OrderItemRow {
  nameSnapshot: string;
  pricePaise: bigint;
  mrpPaise: bigint;
  bvCenti: number;
  gstBp: number;
  quantity: number;
  product: { slug: string; imageUrl: string | null } | null;
}

interface OrderEventRow {
  status: string;
  note: string | null;
  createdAt: Date;
}

/** Ledger categories as a member would describe them, not as the enum spells them. */
const CATEGORY_LABELS: Record<string, string> = {
  RECHARGE: 'Wallet recharge',
  ORDER_PAYMENT: 'Order payment',
  ORDER_REFUND: 'Order refund',
  SELF_INCOME: 'Self purchase income',
  DIRECT_INCOME: 'Direct income',
  TEAM_INCOME: 'Team income',
  GENERATION_BONUS: 'Generation bonus',
  ROYALTY: 'Royalty',
  WITHDRAWAL_HOLD: 'Withdrawal',
  WITHDRAWAL_REVERSAL: 'Withdrawal reversed',
  WALLET_TRANSFER: 'Wallet transfer',
  ADMIN_ADJUSTMENT: 'Adjustment',
  MOBILE_RECHARGE_HOLD: 'Mobile recharge',
  MOBILE_RECHARGE_REVERSAL: 'Mobile recharge reversed',
};

/**
 * The stored plan, or null if it will not parse.
 *
 * Everywhere that pays money uses `parsePlan` and lets it throw — a payout
 * computed from a plan that failed validation would be worse than no payout.
 * This is the one caller that must not: the dashboard is the request every app
 * open makes, and a plan the client has just edited into an invalid state
 * should degrade to "no rank shown" rather than lock every member out of their
 * own wallet balance.
 */
function safeParsePlan(config: unknown): PlanConfig | null {
  if (config == null) return null;
  try {
    return parsePlan(config);
  } catch {
    return null;
  }
}
