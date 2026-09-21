import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaClient, CommissionType, Member } from '@prisma/client';
import { LedgerService, Tx, idempotencyKey } from '../ledger/ledger.service';
import { PlanConfig, parsePlan, rankAt, rankIndexFor } from '../plan/plan.config';
import { commissionOn, splitPool, Paise, BvCenti } from '../common/money';
import { isoPeriod } from '../common/period';

/**
 * Commission engine.
 *
 * Runs exactly once per order, when that order is marked DELIVERED. Paying on
 * DELIVERED rather than PLACED is deliberate: a cancelled or returned order
 * would otherwise need a clawback across an entire genealogy, and clawbacks
 * against already-withdrawn income are close to unrecoverable.
 *
 * The run is driven entirely by a PlanVersion document, which is pinned onto
 * the order at delivery. A plan edit next month therefore cannot change what
 * this order paid, and every historical payout can still explain itself.
 *
 * Safe to retry. Each payout row is unique on (orderId, memberId, type,
 * generationLevel) and each ledger posting carries a deterministic key, so a
 * replayed BullMQ job writes nothing the second time.
 */

interface Payout {
  memberId: string;
  type: CommissionType;
  pctBp: number;
  amountPaise: Paise;
  remainderPaise: Paise;
  generationLevel?: number;
  uplineDepth?: number;
  note: string;
}

export interface CommissionRunResult {
  orderId: string;
  planVersionId: string;
  payouts: Payout[];
  totalPaise: Paise;
  skipped: boolean;
  reason?: string;
}

@Injectable()
export class CommissionService {
  private readonly log = new Logger(CommissionService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Upline chain, nearest sponsor first.
   *
   * Reads the materialised ancestorPath instead of walking sponsorId one row at
   * a time — a 20-deep genealogy is one query rather than twenty round trips.
   */
  private async uplineChain(tx: Tx, member: Member): Promise<Member[]> {
    const ids = member.ancestorPath.split('/').filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await tx.member.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((m) => [m.id, m]));
    // ancestorPath runs root-first; commission walks upward from the buyer.
    return ids
      .map((id) => byId.get(id))
      .filter((m): m is Member => !!m)
      .reverse();
  }

  private eligible(m: Member): boolean {
    return !m.isCompany && m.status === 'ACTIVE';
  }

  /**
   * Decide who earns what. Pure: no writes, no side effects, so this is the
   * function the unit tests hammer with genealogy fixtures.
   */
  computePayouts(args: {
    plan: PlanConfig;
    buyer: Member;
    chain: Member[];
    bvCenti: BvCenti;
    isFirstPurchase: boolean;
    orderNo: string;
  }): Payout[] {
    const { plan, buyer, chain, bvCenti, isFirstPurchase, orderNo } = args;
    const payouts: Payout[] = [];

    const add = (m: Member, pctBp: number, type: CommissionType, note: string, extra: Partial<Payout> = {}) => {
      if (!this.eligible(m) || pctBp <= 0) return;
      const { amountPaise, remainderPaise } = commissionOn(bvCenti, pctBp);
      if (amountPaise <= 0n) return;
      payouts.push({ memberId: m.id, type, pctBp, amountPaise, remainderPaise, note, ...extra });
    };

    // 1. Self income — the buyer's own rank rate on their own order.
    const buyerSelfBp = rankAt(plan, buyer.rankIndex).selfPctBp;
    if (plan.self.enabled) {
      add(buyer, buyerSelfBp, 'SELF', `${buyerSelfBp / 100}% self income on ${orderNo}`);
    }

    const sponsor = chain[0];

    // 2. Direct joining income. WALLET_RECHARGE is not handled here — that
    //    variant pays at recharge approval, not on a product sale.
    if (plan.direct.enabled && sponsor) {
      const due =
        plan.direct.basis === 'EVERY_PURCHASE' ||
        (plan.direct.basis === 'FIRST_PURCHASE' && isFirstPurchase);
      if (due) {
        add(sponsor, plan.direct.pctBp, 'DIRECT', `${plan.direct.pctBp / 100}% direct income on ${orderNo}`, { uplineDepth: 1 });
      }
    }

    // 3. Team income.
    if (plan.team.enabled) {
      if (plan.team.mode === 'DIRECT_ONLY') {
        if (sponsor) {
          add(sponsor, rankAt(plan, sponsor.rankIndex).teamPctBp, 'TEAM', `Team income on ${orderNo}`, { uplineDepth: 1 });
        }
      } else if (plan.team.mode === 'FLAT') {
        const depth = plan.team.depth > 0 ? plan.team.depth : chain.length;
        chain.slice(0, depth).forEach((u, i) => {
          add(u, rankAt(plan, u.rankIndex).teamPctBp, 'TEAM', `Level ${i + 1} team income on ${orderNo}`, { uplineDepth: i + 1 });
        });
      } else {
        // GAP: walking up, each upline earns only the difference between their
        // self rate and the best rate already paid below them. Total self+team
        // across the whole line therefore never exceeds the top rank's rate.
        const topBp = Math.max(...plan.ranks.map((r) => r.selfPctBp));
        let paidBp = plan.self.enabled ? buyerSelfBp : 0;
        for (const [i, u] of chain.entries()) {
          if (paidBp >= topBp) break;
          if (!this.eligible(u)) continue;
          const uplineBp = rankAt(plan, u.rankIndex).selfPctBp;
          if (uplineBp > paidBp) {
            add(u, uplineBp - paidBp, 'TEAM', `${(uplineBp - paidBp) / 100}% gap on ${orderNo}`, { uplineDepth: i + 1 });
            paidBp = uplineBp;
          }
        }
      }
    }

    // 4. Generation bonus — for uplines at or above a chosen rank.
    const gen = plan.generation;
    if (gen.enabled && gen.levelsBp.length > 0) {
      let level = 0;
      for (const [i, u] of chain.entries()) {
        if (level >= gen.levelsBp.length) break;
        const qualified = u.rankIndex >= gen.minRankIndex;
        if (!qualified) {
          // onlyQualified: non-qualifying uplines are invisible, so the first
          // three who do qualify are generations 1, 2 and 3.
          // Otherwise the slot is consumed and simply goes unpaid.
          if (!gen.onlyQualified) level += 1;
          continue;
        }
        add(u, gen.levelsBp[level], 'GENERATION', `Generation ${level + 1} bonus on ${orderNo}`, {
          generationLevel: level + 1,
          uplineDepth: i + 1,
        });
        level += 1;
      }
    }

    return payouts;
  }

  /**
   * Apply an order's commission. Call from a BullMQ worker with jobId
   * `commission:${orderId}` so the queue itself also dedupes.
   */
  async runForOrder(orderId: string): Promise<CommissionRunResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // FOR UPDATE on the order makes two concurrent runs serialise; the
        // loser then sees commissionRunAt set and exits.
        const locked = await tx.$queryRaw<{ id: string; commissionRunAt: Date | null }[]>`
          SELECT id, "commissionRunAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE
        `;
        if (locked.length === 0) throw new BadRequestException(`Order ${orderId} not found`);
        if (locked[0].commissionRunAt) {
          return { orderId, planVersionId: '', payouts: [], totalPaise: 0n, skipped: true, reason: 'already run' };
        }

        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { member: true },
        });
        if (order.status !== 'DELIVERED') {
          return { orderId, planVersionId: '', payouts: [], totalPaise: 0n, skipped: true, reason: `status is ${order.status}` };
        }

        const planRow = order.planVersionId
          ? await tx.planVersion.findUniqueOrThrow({ where: { id: order.planVersionId } })
          : await tx.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
        const plan = parsePlan(planRow.config);

        const buyer = order.member;
        const chain = await this.uplineChain(tx, buyer);
        const bvCenti = order.totalBvCenti;

        // --- volume first, so rank promotions land before rates are read ---
        // A buyer crossing into a higher rank with this very order earns at the
        // OLD rate on it; the new rate applies from the next order. That is the
        // conventional reading and it avoids a member gaming the boundary.
        const period = order.deliveredAt ? isoPeriod(order.deliveredAt) : isoPeriod(new Date());

        await tx.member.update({
          where: { id: buyer.id },
          data: { selfBvCenti: { increment: BigInt(bvCenti) }, groupBvCenti: { increment: BigInt(bvCenti) } },
        });
        if (chain.length > 0) {
          await tx.member.updateMany({
            where: { id: { in: chain.map((m) => m.id) } },
            data: { groupBvCenti: { increment: BigInt(bvCenti) } },
          });
        }
        await tx.monthlyVolume.upsert({
          where: { memberId_period: { memberId: buyer.id, period } },
          create: { memberId: buyer.id, period, selfBvCenti: bvCenti, groupBvCenti: bvCenti },
          update: { selfBvCenti: { increment: bvCenti }, groupBvCenti: { increment: bvCenti } },
        });

        const payouts = this.computePayouts({
          plan,
          buyer,
          chain,
          bvCenti,
          isFirstPurchase: order.isFirstPurchase,
          orderNo: order.orderNo,
        });

        // --- write commission rows; collisions mean this is a replay ---
        const applied: Payout[] = [];
        for (const p of payouts) {
          const created = await tx.commission.createMany({
            data: [
              {
                orderId: order.id,
                memberId: p.memberId,
                type: p.type,
                sourceBvCenti: bvCenti,
                pctBp: p.pctBp,
                amountPaise: p.amountPaise,
                remainderPaise: p.remainderPaise,
                generationLevel: p.generationLevel ?? null,
                uplineDepth: p.uplineDepth ?? null,
                planVersionId: planRow.id,
                dedupeKey: idempotencyKey('commission', order.id, p.memberId, p.type, p.generationLevel),
              },
            ],
            skipDuplicates: true,
          });
          if (created.count > 0) applied.push(p);
        }

        if (applied.length > 0) {
          await this.ledger.postMany(
            tx,
            applied.map((p) => ({
              memberId: p.memberId,
              wallet: 'INCOME' as const,
              direction: 'CREDIT' as const,
              amountPaise: p.amountPaise,
              category: ledgerCategoryFor(p.type),
              idempotencyKey: idempotencyKey('commission', order.id, p.memberId, p.type, p.generationLevel),
              journalId: `commission:${order.id}`,
              refType: 'order',
              refId: order.id,
              note: p.note,
              planVersionId: planRow.id,
            })),
          );
        }

        // --- rank promotions, read after the volume update ---
        const touched = await tx.member.findMany({
          where: { id: { in: [buyer.id, ...chain.map((m) => m.id)] }, isCompany: false },
        });
        for (const m of touched) {
          const basis = plan.rankBasis === 'TEAM_BV' ? m.groupBvCenti - m.selfBvCenti : m.groupBvCenti;
          const next = rankIndexFor(plan, Number(basis));
          if (next > m.rankIndex) {
            await tx.member.update({ where: { id: m.id }, data: { rankIndex: next } });
            await tx.rankChange.create({
              data: { memberId: m.id, fromIndex: m.rankIndex, toIndex: next, atBvCenti: basis, planVersionId: planRow.id },
            });
            await tx.notification.create({
              data: {
                memberId: m.id,
                title: `You're now ${plan.ranks[next].name}`,
                body: `Your volume crossed the target. Self income is now ${plan.ranks[next].selfPctBp / 100}%.`,
                kind: 'RANK',
              },
            });
          }
        }

        // --- royalty pools accrue on every delivered BV ---
        for (const fund of plan.royalty.funds) {
          await tx.royaltyPool.upsert({
            where: { fundKey: fund.key },
            create: { fundKey: fund.key, accBvCenti: bvCenti },
            update: { accBvCenti: { increment: bvCenti } },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: { commissionRunAt: new Date(), planVersionId: planRow.id },
        });

        const totalPaise = applied.reduce((a, p) => a + p.amountPaise, 0n);
        this.log.log(`Order ${order.orderNo}: paid ${applied.length} members, total ${totalPaise} paise`);
        return { orderId, planVersionId: planRow.id, payouts: applied, totalPaise, skipped: false };
      },
      { isolationLevel: 'ReadCommitted', timeout: 30_000 },
    );
  }

  /**
   * Share out a royalty pool.
   *
   * Under the client's default rule a member qualifies by having N or more team
   * members at a given rank, which is a downline query rather than a simple BV
   * comparison — hence the ancestorPath prefix match.
   */
  /**
   * What each configured fund has accumulated, so an admin can see whether
   * there's anything worth distributing before triggering `distributeRoyalty`
   * — which otherwise is the only way to find out, and only by trying.
   */
  async royaltyPoolBalances() {
    const planRow = await this.prisma.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
    const plan = parsePlan(planRow.config);
    const pools = await this.prisma.royaltyPool.findMany({
      where: { fundKey: { in: plan.royalty.funds.map((f) => f.key) } },
    });
    const byKey = new Map(pools.map((p) => [p.fundKey, p]));

    return plan.royalty.funds.map((fund) => {
      const accBvCenti = byKey.get(fund.key)?.accBvCenti ?? 0;
      const { amountPaise } = commissionOn(accBvCenti, fund.poolPctBp);
      return { fundKey: fund.key, name: fund.name, accBvCenti, poolPaise: amountPaise };
    });
  }

  async distributeRoyalty(fundKey: string, actorId?: string): Promise<{ runId: string; perHeadPaise: Paise; qualifiers: number }> {
    return this.prisma.$transaction(async (tx) => {
      const planRow = await tx.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
      const plan = parsePlan(planRow.config);
      const fund = plan.royalty.funds.find((f) => f.key === fundKey);
      if (!fund) throw new BadRequestException(`No fund called ${fundKey}`);

      // Without this lock, two clicks (or two admins) landing inside the same
      // window both read the pool before either resets it, and both pay the
      // full amount out — the same accumulated volume distributed twice. A
      // missing row can't race (there is nothing yet to double-spend), so
      // locking only when one exists is correct, not just an optimisation.
      await tx.$queryRaw`SELECT "fundKey" FROM "RoyaltyPool" WHERE "fundKey" = ${fundKey} FOR UPDATE`;

      const pool = await tx.royaltyPool.findUnique({ where: { fundKey } });
      const accBvCenti = pool?.accBvCenti ?? 0;
      const { amountPaise: poolPaise } = commissionOn(accBvCenti, fund.poolPctBp);
      if (poolPaise <= 0n) throw new BadRequestException(`${fund.name} has nothing to share yet.`);

      const members = await tx.member.findMany({
        where: { isCompany: false, status: 'ACTIVE' },
        select: { id: true, memberCode: true, groupBvCenti: true, selfBvCenti: true, ancestorPath: true },
        orderBy: { memberCode: 'asc' }, // stable order for the leftover-paise rule
      });

      const qualifiers: typeof members = [];
      for (const m of members) {
        if (fund.qualifyMode === 'BV_TARGET') {
          const basis = plan.rankBasis === 'TEAM_BV' ? m.groupBvCenti - m.selfBvCenti : m.groupBvCenti;
          if (Number(basis) >= fund.targetBvCenti) qualifiers.push(m);
        } else {
          const count = await tx.member.count({
            // Prefix match so the btree on ancestorPath is usable. A `contains`
            // here would be LIKE '%...%' and would sequentially scan every member.
            where: { ancestorPath: { startsWith: `${m.ancestorPath}${m.id}/` }, isCompany: false, rankIndex: { gte: fund.minRankIndex } },
          });
          if (count >= fund.minCount) qualifiers.push(m);
        }
      }

      if (qualifiers.length === 0) {
        throw new BadRequestException(
          `Nobody qualifies for the ${fund.name.toLowerCase()} yet. The pool carries forward.`,
        );
      }

      const { perHead, extras } = splitPool(poolPaise, qualifiers.length);
      const run = await tx.royaltyRun.create({
        data: {
          fundKey,
          poolBvCenti: accBvCenti,
          poolPaise,
          perHeadPaise: perHead,
          qualifierCount: qualifiers.length,
          planVersionId: planRow.id,
          runById: actorId,
        },
      });

      const postings = qualifiers.map((m, i) => {
        const amountPaise = perHead + (i < extras ? 1n : 0n); // leftover paise, one each
        return {
          memberId: m.id,
          wallet: 'INCOME' as const,
          direction: 'CREDIT' as const,
          amountPaise,
          category: 'ROYALTY' as const,
          idempotencyKey: idempotencyKey('royalty', run.id, m.id),
          journalId: `royalty:${run.id}`,
          refType: 'royalty',
          refId: run.id,
          note: `${fund.name} share`,
          planVersionId: planRow.id,
        };
      });

      await tx.commission.createMany({
        data: postings.map((p) => ({
          royaltyRunId: run.id,
          memberId: p.memberId,
          type: 'ROYALTY' as const,
          sourceBvCenti: accBvCenti,
          pctBp: fund.poolPctBp,
          amountPaise: p.amountPaise,
          planVersionId: planRow.id,
          dedupeKey: idempotencyKey('royalty', run.id, p.memberId),
        })),
        skipDuplicates: true,
      });
      await this.ledger.postMany(tx, postings);
      await tx.royaltyPool.update({ where: { fundKey }, data: { accBvCenti: 0 } });

      return { runId: run.id, perHeadPaise: perHead, qualifiers: qualifiers.length };
    });
  }

  /**
   * Claw back a run that should not have happened — a delivery marked in error,
   * or a fraudulent order found after the fact. Reverses every ledger entry and
   * reopens the order for a fresh run.
   */
  async reverseOrderRun(orderId: string, reason: string, actorId?: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const entries = await tx.ledgerEntry.findMany({
        where: { refType: 'order', refId: orderId, direction: 'CREDIT' },
        select: { id: true },
      });
      for (const e of entries) await this.ledger.reverse(tx, e.id, reason, actorId);
      await tx.commission.deleteMany({ where: { orderId } });
      await tx.order.update({ where: { id: orderId }, data: { commissionRunAt: null } });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId, action: 'commission.reverse', detail: { orderId, reason, entries: entries.length } },
      });
      return entries.length;
    });
  }
}

function ledgerCategoryFor(type: CommissionType) {
  switch (type) {
    case 'SELF':
      return 'SELF_INCOME' as const;
    case 'DIRECT':
      return 'DIRECT_INCOME' as const;
    case 'TEAM':
      return 'TEAM_INCOME' as const;
    case 'GENERATION':
      return 'GENERATION_BONUS' as const;
    case 'ROYALTY':
      return 'ROYALTY' as const;
  }
}
