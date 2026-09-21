var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/__tests__/plan.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/common/money.ts
var BP_DENOMINATOR = 1e4;
var PAISE_PER_RUPEE = 100n;
var CENTI_PER_BV = 100;
function rupeesToPaise(rupees) {
  const s = String(rupees).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`"${rupees}" is not a rupee amount with at most 2 decimals`);
  }
  const negative = s.startsWith("-");
  const [whole, frac = ""] = (negative ? s.slice(1) : s).split(".");
  const paise = BigInt(whole) * PAISE_PER_RUPEE + BigInt(frac.padEnd(2, "0"));
  return negative ? -paise : paise;
}
function paiseToRupeeString(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / PAISE_PER_RUPEE;
  const frac = abs % PAISE_PER_RUPEE;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}
function formatInr(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = (abs / PAISE_PER_RUPEE).toString();
  const frac = (abs % PAISE_PER_RUPEE).toString().padStart(2, "0");
  const [last3, ...rest] = [whole.slice(-3), whole.slice(0, -3)].filter(Boolean);
  const head = rest.length ? rest[0].replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "";
  return `\u20B9${head}${last3}${frac === "00" ? "" : "." + frac}`;
}
function bvToCenti(bv) {
  const s = String(bv).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${bv}" is not a valid BV`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * CENTI_PER_BV + Number(frac.padEnd(2, "0"));
}
function centiToBvString(centi) {
  const whole = Math.trunc(centi / CENTI_PER_BV);
  const frac = Math.abs(centi % CENTI_PER_BV);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}
function percentToBp(pct) {
  const bp = Math.round(pct * 100);
  if (!Number.isFinite(bp)) throw new Error(`"${pct}" is not a percentage`);
  return bp;
}
function commissionOn(bvCenti, pctBp) {
  if (!Number.isInteger(bvCenti) || bvCenti < 0) throw new Error(`bad bvCenti: ${bvCenti}`);
  if (!Number.isInteger(pctBp) || pctBp < 0) throw new Error(`bad pctBp: ${pctBp}`);
  const numerator = BigInt(bvCenti) * BigInt(pctBp);
  const amountPaise = numerator / BigInt(BP_DENOMINATOR);
  return { amountPaise, remainderPaise: numerator % BigInt(BP_DENOMINATOR) };
}
function pctOfPaise(paise, pctBp) {
  const numerator = paise * BigInt(pctBp);
  return {
    amountPaise: numerator / BigInt(BP_DENOMINATOR),
    remainderPaise: numerator % BigInt(BP_DENOMINATOR)
  };
}
function gstInclusiveComponent(inclusivePaise, gstBp) {
  const denom = BigInt(BP_DENOMINATOR + gstBp);
  return inclusivePaise * BigInt(gstBp) / denom;
}
function splitPool(poolPaise, headCount) {
  if (headCount <= 0) throw new Error("cannot split a pool between nobody");
  const heads = BigInt(headCount);
  return { perHead: poolPaise / heads, extras: Number(poolPaise % heads) };
}
var sumPaise = (xs) => xs.reduce((a, b) => a + b, 0n);

// src/plan/plan.config.ts
import { z } from "zod";
var RankSchema = z.object({
  name: z.string().trim().min(1).max(40),
  minBvCenti: z.number().int().min(0),
  selfPctBp: z.number().int().min(0).max(9e3),
  teamPctBp: z.number().int().min(0).max(9e3)
});
var TeamModeSchema = z.enum(["GAP", "FLAT", "DIRECT_ONLY"]);
var DirectBasisSchema = z.enum(["FIRST_PURCHASE", "EVERY_PURCHASE", "WALLET_RECHARGE"]);
var JoinModeSchema = z.enum(["FREE", "MIN_FIRST_PURCHASE"]);
var RankBasisSchema = z.enum(["GROUP_BV", "TEAM_BV"]);
var QualifyModeSchema = z.enum(["RANK_COUNT", "BV_TARGET"]);
var PayoutCycleSchema = z.enum(["INSTANT", "WEEKLY", "FORTNIGHTLY", "MONTHLY"]);
var RoyaltyFundSchema = z.object({
  key: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(60),
  poolPctBp: z.number().int().min(0).max(2e3),
  qualifyMode: QualifyModeSchema,
  minRankIndex: z.number().int().min(0),
  minCount: z.number().int().min(1),
  targetBvCenti: z.number().int().min(0)
});
var PlanConfigSchema = z.object({
  rankBasis: RankBasisSchema,
  ranks: z.array(RankSchema).min(1).max(12),
  joining: z.object({
    mode: JoinModeSchema,
    minFirstPurchase: z.number().int().min(0),
    // centi-BV or paise, per unit
    unit: z.enum(["BV", "INR"])
  }),
  self: z.object({ enabled: z.boolean() }),
  direct: z.object({
    enabled: z.boolean(),
    pctBp: z.number().int().min(0).max(5e3),
    basis: DirectBasisSchema
  }),
  team: z.object({
    enabled: z.boolean(),
    mode: TeamModeSchema,
    depth: z.number().int().min(0).max(50)
    // 0 = unlimited
  }),
  generation: z.object({
    enabled: z.boolean(),
    minRankIndex: z.number().int().min(0),
    onlyQualified: z.boolean(),
    levelsBp: z.array(z.number().int().min(0).max(5e3)).max(20)
  }),
  repurchase: z.object({
    enabled: z.boolean(),
    monthlyBvCenti: z.number().int().min(0),
    blocksWithdrawal: z.boolean()
  }),
  withdrawal: z.object({
    minPaise: z.string(),
    // bigint over the wire
    deductionBp: z.number().int().min(0).max(5e3),
    cycle: PayoutCycleSchema
  }),
  royalty: z.object({ funds: z.array(RoyaltyFundSchema).max(12) })
}).superRefine((plan, ctx) => {
  const path = (p, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: p, message });
  if (plan.ranks[0].minBvCenti !== 0) {
    path(["ranks", 0, "minBvCenti"], "The first rank must start at 0 BV so every member has a rank");
  }
  for (let i = 1; i < plan.ranks.length; i++) {
    if (plan.ranks[i].minBvCenti <= plan.ranks[i - 1].minBvCenti) {
      path(["ranks", i, "minBvCenti"], "Rank targets must increase down the ladder");
    }
  }
  if (plan.generation.minRankIndex >= plan.ranks.length) {
    path(["generation", "minRankIndex"], "That rank does not exist");
  }
  if (plan.generation.enabled && plan.generation.levelsBp.length === 0) {
    path(["generation", "levelsBp"], "Add at least one generation, or switch the bonus off");
  }
  if (plan.joining.mode === "MIN_FIRST_PURCHASE" && plan.joining.minFirstPurchase <= 0) {
    path(["joining", "minFirstPurchase"], "Set a minimum, or switch joining to free");
  }
  for (const [i, f] of plan.royalty.funds.entries()) {
    if (f.minRankIndex >= plan.ranks.length) path(["royalty", "funds", i, "minRankIndex"], "That rank does not exist");
    if (f.qualifyMode === "BV_TARGET" && f.targetBvCenti <= 0) {
      path(["royalty", "funds", i, "targetBvCenti"], "Set a BV target above 0");
    }
  }
  if (new Set(plan.royalty.funds.map((f) => f.key)).size !== plan.royalty.funds.length) {
    path(["royalty", "funds"], "Two funds cannot share the same key");
  }
});
var CLIENT_DEFAULT_PLAN = {
  rankBasis: "GROUP_BV",
  ranks: [
    { name: "Star", minBvCenti: bvToCenti(0), selfPctBp: percentToBp(10), teamPctBp: percentToBp(5) },
    { name: "Bronze", minBvCenti: bvToCenti(1e3), selfPctBp: percentToBp(15), teamPctBp: percentToBp(5) },
    { name: "Silver", minBvCenti: bvToCenti(5e3), selfPctBp: percentToBp(19), teamPctBp: percentToBp(5) },
    { name: "Gold", minBvCenti: bvToCenti(15e3), selfPctBp: percentToBp(22), teamPctBp: percentToBp(5) },
    { name: "Diamond", minBvCenti: bvToCenti(4e4), selfPctBp: percentToBp(25), teamPctBp: percentToBp(5) }
  ],
  joining: { mode: "MIN_FIRST_PURCHASE", minFirstPurchase: bvToCenti(2e3), unit: "BV" },
  self: { enabled: true },
  // The document says "DIRECT JOINING 10% UNLIMITED (ADD WALLET)". Paying on a
  // wallet top-up rewards money coming in rather than goods going out, which is
  // the pattern the Direct Selling Rules treat as a money circulation scheme.
  // Default is the product-sale version; WALLET_RECHARGE stays available but
  // carries the warning in the admin UI.
  direct: { enabled: true, pctBp: percentToBp(10), basis: "FIRST_PURCHASE" },
  team: { enabled: true, mode: "GAP", depth: 0 },
  generation: {
    enabled: true,
    minRankIndex: 4,
    // Diamond
    onlyQualified: true,
    levelsBp: [percentToBp(2), percentToBp(2), percentToBp(1)]
  },
  repurchase: { enabled: true, monthlyBvCenti: bvToCenti(500), blocksWithdrawal: true },
  withdrawal: { minPaise: rupeesToPaise(500).toString(), deductionBp: percentToBp(10), cycle: "MONTHLY" },
  royalty: {
    funds: [
      { key: "car", name: "Car fund", poolPctBp: percentToBp(2), qualifyMode: "RANK_COUNT", minRankIndex: 4, minCount: 3, targetBvCenti: 0 },
      { key: "house", name: "House fund", poolPctBp: percentToBp(2), qualifyMode: "RANK_COUNT", minRankIndex: 4, minCount: 3, targetBvCenti: 0 },
      { key: "travel", name: "Travel fund", poolPctBp: percentToBp(1), qualifyMode: "RANK_COUNT", minRankIndex: 4, minCount: 3, targetBvCenti: 0 }
    ]
  }
};
function rankIndexFor(plan, bvCenti) {
  let index = 0;
  plan.ranks.forEach((r, i) => {
    if (bvCenti >= r.minBvCenti) index = i;
  });
  return index;
}
var rankAt = (plan, i) => plan.ranks[Math.max(0, Math.min(i, plan.ranks.length - 1))];
function payoutExposure(plan) {
  const lines = [];
  const topSelf = Math.max(...plan.ranks.map((r) => r.selfPctBp));
  const topTeam = Math.max(...plan.ranks.map((r) => r.teamPctBp));
  if (plan.self.enabled) lines.push({ label: "Self income at the highest rank", pctBp: topSelf });
  if (plan.direct.enabled) {
    lines.push({
      label: "Direct joining income",
      pctBp: plan.direct.pctBp,
      note: plan.direct.basis === "FIRST_PURCHASE" ? "first order only" : plan.direct.basis === "EVERY_PURCHASE" ? "every order" : "on wallet recharge"
    });
  }
  if (plan.team.enabled) {
    if (plan.team.mode === "GAP") lines.push({ label: "Team income (gap)", pctBp: 0, note: "carved out of the self rate above" });
    else if (plan.team.mode === "DIRECT_ONLY") lines.push({ label: "Team income (sponsor only)", pctBp: topTeam });
    else if (plan.team.depth > 0) lines.push({ label: `Team income (flat, ${plan.team.depth} levels)`, pctBp: topTeam * plan.team.depth });
    else lines.push({ label: "Team income (flat, unlimited)", pctBp: null, note: "grows with every generation" });
  }
  if (plan.generation.enabled) {
    lines.push({ label: "Generation bonus", pctBp: plan.generation.levelsBp.reduce((a, b) => a + b, 0) });
  }
  const royaltyBp = plan.royalty.funds.reduce((a, f) => a + f.poolPctBp, 0);
  lines.push({ label: "Royalty and lifestyle pools", pctBp: royaltyBp });
  const totalBp2 = lines.some((l) => l.pctBp === null) ? null : lines.reduce((a, l) => a + (l.pctBp ?? 0), 0);
  return { lines, totalBp: totalBp2 };
}
var PlanUnsustainableError = class extends Error {
};
function assertSustainable(plan, opts = {}) {
  const ceiling = opts.ceilingBp ?? percentToBp(60);
  const { totalBp: totalBp2 } = payoutExposure(plan);
  if (totalBp2 === null) {
    if (!opts.acceptUnlimited) {
      throw new PlanUnsustainableError(
        "Flat team income with no depth limit has no payout ceiling. Set a level limit, or confirm you want it unlimited."
      );
    }
    return;
  }
  if (totalBp2 > ceiling) {
    throw new PlanUnsustainableError(
      `This plan commits ${totalBp2 / 100}% of BV to commission, above the ${ceiling / 100}% ceiling. Lower a rate or raise the ceiling deliberately.`
    );
  }
}
function parsePlan(raw) {
  return PlanConfigSchema.parse(raw);
}

// src/commission/commission.service.ts
import { Injectable as Injectable2, Logger as Logger2, BadRequestException as BadRequestException2 } from "@nestjs/common";

// src/ledger/ledger.service.ts
import { Injectable, Logger, ConflictException, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
var InsufficientFundsError = class extends BadRequestException {
  constructor(wallet, available, needed) {
    super(
      `The ${wallet === "SHOPPING" ? "shopping" : "income"} wallet has ${formatInr(available)}, which is short of ${formatInr(needed)}.`
    );
  }
};
function idempotencyKey(...parts) {
  return parts.map((p) => p === null || p === void 0 ? "_" : String(p)).join(":");
}
var LedgerService = class {
  constructor(prisma) {
    this.prisma = prisma;
  }
  prisma;
  log = new Logger(LedgerService.name);
  /**
   * Lock a member's wallet for the rest of the transaction.
   *
   * Callers that touch several members in one transaction must go through
   * lockWallets() instead, so the ordering rule is not left to chance.
   */
  async lockWallet(tx, memberId, kind) {
    const rows = await tx.$queryRaw`
      SELECT id, "balancePaise"
      FROM "Wallet"
      WHERE "memberId" = ${memberId} AND kind = ${kind}::"WalletKind"
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new BadRequestException(`No ${kind} wallet exists for member ${memberId}`);
    }
    return rows[0];
  }
  /**
   * Take every lock this transaction will need, up front and in a fixed order.
   *
   * Deadlocks in a genealogy payout are not hypothetical: two orders delivering
   * at once share most of their upline. Sorting the ids means both transactions
   * grab the same rows in the same sequence, so one simply waits.
   */
  async lockWallets(tx, targets) {
    const unique = [...new Map(targets.map((t) => [`${t.memberId}:${t.wallet}`, t])).values()];
    if (unique.length === 0) return;
    const ids = await tx.wallet.findMany({
      where: { OR: unique.map((t) => ({ memberId: t.memberId, kind: t.wallet })) },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    if (ids.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM "Wallet"
      WHERE id IN (${Prisma.join(ids.map((r) => r.id))})
      ORDER BY id ASC
      FOR UPDATE
    `;
  }
  /** Post one leg. Must run inside a transaction the caller owns. */
  async post(tx, req) {
    if (req.amountPaise <= 0n) {
      throw new BadRequestException(`A posting must be positive, got ${req.amountPaise}`);
    }
    const wallet = await this.lockWallet(tx, req.memberId, req.wallet);
    const delta = req.direction === "CREDIT" ? req.amountPaise : -req.amountPaise;
    const balanceAfter = wallet.balancePaise + delta;
    if (balanceAfter < 0n && !req.allowNegative) {
      throw new InsufficientFundsError(req.wallet, wallet.balancePaise, req.amountPaise);
    }
    try {
      const entry = await tx.ledgerEntry.create({
        data: {
          journalId: req.journalId ?? req.idempotencyKey,
          memberId: req.memberId,
          walletId: wallet.id,
          direction: req.direction,
          amountPaise: req.amountPaise,
          category: req.category,
          balanceAfter,
          refType: req.refType,
          refId: req.refId,
          note: req.note,
          idempotencyKey: req.idempotencyKey,
          planVersionId: req.planVersionId
        },
        select: { id: true }
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balancePaise: balanceAfter, version: { increment: 1 } }
      });
      return { entryId: entry.id, balanceAfter, deduplicated: false };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await tx.ledgerEntry.findUnique({
          where: { idempotencyKey: req.idempotencyKey },
          select: { id: true, balanceAfter: true }
        });
        this.log.warn(`Duplicate posting suppressed: ${req.idempotencyKey}`);
        if (existing) {
          return { entryId: existing.id, balanceAfter: existing.balanceAfter, deduplicated: true };
        }
      }
      throw e;
    }
  }
  /**
   * Move money between two wallets as one journal. Either both legs land or
   * neither does, because they share the caller's transaction.
   */
  async transfer(tx, args) {
    const journalId = args.idempotencyKey;
    await this.lockWallets(tx, [
      { memberId: args.memberId, wallet: args.from },
      { memberId: args.memberId, wallet: args.to }
    ]);
    const debit = await this.post(tx, {
      memberId: args.memberId,
      wallet: args.from,
      direction: "DEBIT",
      amountPaise: args.amountPaise,
      category: args.category,
      idempotencyKey: `${args.idempotencyKey}:debit`,
      journalId,
      note: args.note
    });
    const credit = await this.post(tx, {
      memberId: args.memberId,
      wallet: args.to,
      direction: "CREDIT",
      amountPaise: args.amountPaise,
      category: args.category,
      idempotencyKey: `${args.idempotencyKey}:credit`,
      journalId,
      note: args.note
    });
    return { debit, credit };
  }
  /**
   * Post many credits in one shot — the shape a commission run needs.
   * Locks everything first, then writes, so the run cannot deadlock midway.
   */
  async postMany(tx, requests) {
    await this.lockWallets(tx, requests.map((r) => ({ memberId: r.memberId, wallet: r.wallet })));
    const out = [];
    for (const req of requests) out.push(await this.post(tx, req));
    return out;
  }
  async balance(memberId, kind) {
    const w = await this.prisma.wallet.findUnique({
      where: { memberId_kind: { memberId, kind } },
      select: { balancePaise: true }
    });
    return w?.balancePaise ?? 0n;
  }
  /**
   * Reconciliation: recompute a wallet from its entries and compare with the
   * stored balance. Run nightly. A non-zero drift means something wrote to
   * Wallet outside this service, and that is a production incident.
   */
  async audit(memberId, kind) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { memberId_kind: { memberId, kind } },
      select: { id: true, balancePaise: true }
    });
    if (!wallet) throw new BadRequestException(`No ${kind} wallet for ${memberId}`);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      select: { direction: true, amountPaise: true }
    });
    const derived = sumPaise(
      entries.map((e) => e.direction === "CREDIT" ? e.amountPaise : -e.amountPaise)
    );
    return { stored: wallet.balancePaise, derived, drift: wallet.balancePaise - derived };
  }
  /**
   * Undo a posting by writing its mirror image. Used for order cancellation and
   * for clawing back a commission run that should not have happened.
   */
  async reverse(tx, entryId, reason, actorId) {
    const original = await tx.ledgerEntry.findUnique({ where: { id: entryId } });
    if (!original) throw new BadRequestException(`Ledger entry ${entryId} not found`);
    const wallet = await tx.wallet.findUnique({ where: { id: original.walletId }, select: { kind: true } });
    if (!wallet) throw new ConflictException(`Wallet for entry ${entryId} is missing`);
    return this.post(tx, {
      memberId: original.memberId,
      wallet: wallet.kind,
      direction: original.direction === "CREDIT" ? "DEBIT" : "CREDIT",
      amountPaise: original.amountPaise,
      category: original.category,
      idempotencyKey: `reverse:${entryId}`,
      journalId: original.journalId,
      refType: original.refType ?? void 0,
      refId: original.refId ?? void 0,
      note: `Reversal: ${reason}${actorId ? ` (by ${actorId})` : ""}`,
      allowNegative: true
      // a clawback may legitimately overdraw a spent wallet
    });
  }
};
LedgerService = __decorateClass([
  Injectable()
], LedgerService);

// src/common/period.ts
function isoPeriod(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// src/commission/commission.service.ts
var CommissionService = class {
  constructor(prisma, ledger) {
    this.prisma = prisma;
    this.ledger = ledger;
  }
  prisma;
  ledger;
  log = new Logger2(CommissionService.name);
  /**
   * Upline chain, nearest sponsor first.
   *
   * Reads the materialised ancestorPath instead of walking sponsorId one row at
   * a time — a 20-deep genealogy is one query rather than twenty round trips.
   */
  async uplineChain(tx, member2) {
    const ids = member2.ancestorPath.split("/").filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await tx.member.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id)).filter((m) => !!m).reverse();
  }
  eligible(m) {
    return !m.isCompany && m.status === "ACTIVE";
  }
  /**
   * Decide who earns what. Pure: no writes, no side effects, so this is the
   * function the unit tests hammer with genealogy fixtures.
   */
  computePayouts(args) {
    const { plan, buyer, chain, bvCenti, isFirstPurchase, orderNo } = args;
    const payouts = [];
    const add = (m, pctBp, type, note, extra = {}) => {
      if (!this.eligible(m) || pctBp <= 0) return;
      const { amountPaise, remainderPaise } = commissionOn(bvCenti, pctBp);
      if (amountPaise <= 0n) return;
      payouts.push({ memberId: m.id, type, pctBp, amountPaise, remainderPaise, note, ...extra });
    };
    const buyerSelfBp = rankAt(plan, buyer.rankIndex).selfPctBp;
    if (plan.self.enabled) {
      add(buyer, buyerSelfBp, "SELF", `${buyerSelfBp / 100}% self income on ${orderNo}`);
    }
    const sponsor = chain[0];
    if (plan.direct.enabled && sponsor) {
      const due = plan.direct.basis === "EVERY_PURCHASE" || plan.direct.basis === "FIRST_PURCHASE" && isFirstPurchase;
      if (due) {
        add(sponsor, plan.direct.pctBp, "DIRECT", `${plan.direct.pctBp / 100}% direct income on ${orderNo}`, { uplineDepth: 1 });
      }
    }
    if (plan.team.enabled) {
      if (plan.team.mode === "DIRECT_ONLY") {
        if (sponsor) {
          add(sponsor, rankAt(plan, sponsor.rankIndex).teamPctBp, "TEAM", `Team income on ${orderNo}`, { uplineDepth: 1 });
        }
      } else if (plan.team.mode === "FLAT") {
        const depth = plan.team.depth > 0 ? plan.team.depth : chain.length;
        chain.slice(0, depth).forEach((u, i) => {
          add(u, rankAt(plan, u.rankIndex).teamPctBp, "TEAM", `Level ${i + 1} team income on ${orderNo}`, { uplineDepth: i + 1 });
        });
      } else {
        const topBp = Math.max(...plan.ranks.map((r) => r.selfPctBp));
        let paidBp = plan.self.enabled ? buyerSelfBp : 0;
        for (const [i, u] of chain.entries()) {
          if (paidBp >= topBp) break;
          if (!this.eligible(u)) continue;
          const uplineBp = rankAt(plan, u.rankIndex).selfPctBp;
          if (uplineBp > paidBp) {
            add(u, uplineBp - paidBp, "TEAM", `${(uplineBp - paidBp) / 100}% gap on ${orderNo}`, { uplineDepth: i + 1 });
            paidBp = uplineBp;
          }
        }
      }
    }
    const gen = plan.generation;
    if (gen.enabled && gen.levelsBp.length > 0) {
      let level = 0;
      for (const [i, u] of chain.entries()) {
        if (level >= gen.levelsBp.length) break;
        const qualified = u.rankIndex >= gen.minRankIndex;
        if (!qualified) {
          if (!gen.onlyQualified) level += 1;
          continue;
        }
        add(u, gen.levelsBp[level], "GENERATION", `Generation ${level + 1} bonus on ${orderNo}`, {
          generationLevel: level + 1,
          uplineDepth: i + 1
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
  async runForOrder(orderId) {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw`
          SELECT id, "commissionRunAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE
        `;
        if (locked.length === 0) throw new BadRequestException2(`Order ${orderId} not found`);
        if (locked[0].commissionRunAt) {
          return { orderId, planVersionId: "", payouts: [], totalPaise: 0n, skipped: true, reason: "already run" };
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { member: true }
        });
        if (order.status !== "DELIVERED") {
          return { orderId, planVersionId: "", payouts: [], totalPaise: 0n, skipped: true, reason: `status is ${order.status}` };
        }
        const planRow = order.planVersionId ? await tx.planVersion.findUniqueOrThrow({ where: { id: order.planVersionId } }) : await tx.planVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
        const plan = parsePlan(planRow.config);
        const buyer = order.member;
        const chain = await this.uplineChain(tx, buyer);
        const bvCenti = order.totalBvCenti;
        const period = order.deliveredAt ? isoPeriod(order.deliveredAt) : isoPeriod(/* @__PURE__ */ new Date());
        await tx.member.update({
          where: { id: buyer.id },
          data: { selfBvCenti: { increment: BigInt(bvCenti) }, groupBvCenti: { increment: BigInt(bvCenti) } }
        });
        if (chain.length > 0) {
          await tx.member.updateMany({
            where: { id: { in: chain.map((m) => m.id) } },
            data: { groupBvCenti: { increment: BigInt(bvCenti) } }
          });
        }
        await tx.monthlyVolume.upsert({
          where: { memberId_period: { memberId: buyer.id, period } },
          create: { memberId: buyer.id, period, selfBvCenti: bvCenti, groupBvCenti: bvCenti },
          update: { selfBvCenti: { increment: bvCenti }, groupBvCenti: { increment: bvCenti } }
        });
        const payouts = this.computePayouts({
          plan,
          buyer,
          chain,
          bvCenti,
          isFirstPurchase: order.isFirstPurchase,
          orderNo: order.orderNo
        });
        const applied = [];
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
                dedupeKey: idempotencyKey("commission", order.id, p.memberId, p.type, p.generationLevel)
              }
            ],
            skipDuplicates: true
          });
          if (created.count > 0) applied.push(p);
        }
        if (applied.length > 0) {
          await this.ledger.postMany(
            tx,
            applied.map((p) => ({
              memberId: p.memberId,
              wallet: "INCOME",
              direction: "CREDIT",
              amountPaise: p.amountPaise,
              category: ledgerCategoryFor(p.type),
              idempotencyKey: idempotencyKey("commission", order.id, p.memberId, p.type, p.generationLevel),
              journalId: `commission:${order.id}`,
              refType: "order",
              refId: order.id,
              note: p.note,
              planVersionId: planRow.id
            }))
          );
        }
        const touched = await tx.member.findMany({
          where: { id: { in: [buyer.id, ...chain.map((m) => m.id)] }, isCompany: false }
        });
        for (const m of touched) {
          const basis = plan.rankBasis === "TEAM_BV" ? m.groupBvCenti - m.selfBvCenti : m.groupBvCenti;
          const next = rankIndexFor(plan, Number(basis));
          if (next > m.rankIndex) {
            await tx.member.update({ where: { id: m.id }, data: { rankIndex: next } });
            await tx.rankChange.create({
              data: { memberId: m.id, fromIndex: m.rankIndex, toIndex: next, atBvCenti: basis, planVersionId: planRow.id }
            });
            await tx.notification.create({
              data: {
                memberId: m.id,
                title: `You're now ${plan.ranks[next].name}`,
                body: `Your volume crossed the target. Self income is now ${plan.ranks[next].selfPctBp / 100}%.`,
                kind: "RANK"
              }
            });
          }
        }
        for (const fund of plan.royalty.funds) {
          await tx.royaltyPool.upsert({
            where: { fundKey: fund.key },
            create: { fundKey: fund.key, accBvCenti: bvCenti },
            update: { accBvCenti: { increment: bvCenti } }
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: { commissionRunAt: /* @__PURE__ */ new Date(), planVersionId: planRow.id }
        });
        const totalPaise = applied.reduce((a, p) => a + p.amountPaise, 0n);
        this.log.log(`Order ${order.orderNo}: paid ${applied.length} members, total ${totalPaise} paise`);
        return { orderId, planVersionId: planRow.id, payouts: applied, totalPaise, skipped: false };
      },
      { isolationLevel: "ReadCommitted", timeout: 3e4 }
    );
  }
  /**
   * Share out a royalty pool.
   *
   * Under the client's default rule a member qualifies by having N or more team
   * members at a given rank, which is a downline query rather than a simple BV
   * comparison — hence the ancestorPath prefix match.
   */
  async distributeRoyalty(fundKey, actorId) {
    return this.prisma.$transaction(async (tx) => {
      const planRow = await tx.planVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      const plan = parsePlan(planRow.config);
      const fund = plan.royalty.funds.find((f) => f.key === fundKey);
      if (!fund) throw new BadRequestException2(`No fund called ${fundKey}`);
      const pool = await tx.royaltyPool.findUnique({ where: { fundKey } });
      const accBvCenti = pool?.accBvCenti ?? 0;
      const { amountPaise: poolPaise } = commissionOn(accBvCenti, fund.poolPctBp);
      if (poolPaise <= 0n) throw new BadRequestException2(`${fund.name} has nothing to share yet.`);
      const members = await tx.member.findMany({
        where: { isCompany: false, status: "ACTIVE" },
        select: { id: true, memberCode: true, groupBvCenti: true, selfBvCenti: true, ancestorPath: true },
        orderBy: { memberCode: "asc" }
        // stable order for the leftover-paise rule
      });
      const qualifiers = [];
      for (const m of members) {
        if (fund.qualifyMode === "BV_TARGET") {
          const basis = plan.rankBasis === "TEAM_BV" ? m.groupBvCenti - m.selfBvCenti : m.groupBvCenti;
          if (Number(basis) >= fund.targetBvCenti) qualifiers.push(m);
        } else {
          const count = await tx.member.count({
            // Prefix match so the btree on ancestorPath is usable. A `contains`
            // here would be LIKE '%...%' and would sequentially scan every member.
            where: { ancestorPath: { startsWith: `${m.ancestorPath}${m.id}/` }, isCompany: false, rankIndex: { gte: fund.minRankIndex } }
          });
          if (count >= fund.minCount) qualifiers.push(m);
        }
      }
      if (qualifiers.length === 0) {
        throw new BadRequestException2(
          `Nobody qualifies for the ${fund.name.toLowerCase()} yet. The pool carries forward.`
        );
      }
      const { perHead, extras } = splitPool(poolPaise, qualifiers.length);
      const run2 = await tx.royaltyRun.create({
        data: {
          fundKey,
          poolBvCenti: accBvCenti,
          poolPaise,
          perHeadPaise: perHead,
          qualifierCount: qualifiers.length,
          planVersionId: planRow.id,
          runById: actorId
        }
      });
      const postings = qualifiers.map((m, i) => {
        const amountPaise = perHead + (i < extras ? 1n : 0n);
        return {
          memberId: m.id,
          wallet: "INCOME",
          direction: "CREDIT",
          amountPaise,
          category: "ROYALTY",
          idempotencyKey: idempotencyKey("royalty", run2.id, m.id),
          journalId: `royalty:${run2.id}`,
          refType: "royalty",
          refId: run2.id,
          note: `${fund.name} share`,
          planVersionId: planRow.id
        };
      });
      await tx.commission.createMany({
        data: postings.map((p) => ({
          royaltyRunId: run2.id,
          memberId: p.memberId,
          type: "ROYALTY",
          sourceBvCenti: accBvCenti,
          pctBp: fund.poolPctBp,
          amountPaise: p.amountPaise,
          planVersionId: planRow.id,
          dedupeKey: idempotencyKey("royalty", run2.id, p.memberId)
        })),
        skipDuplicates: true
      });
      await this.ledger.postMany(tx, postings);
      await tx.royaltyPool.update({ where: { fundKey }, data: { accBvCenti: 0 } });
      return { runId: run2.id, perHeadPaise: perHead, qualifiers: qualifiers.length };
    });
  }
  /**
   * Claw back a run that should not have happened — a delivery marked in error,
   * or a fraudulent order found after the fact. Reverses every ledger entry and
   * reopens the order for a fresh run.
   */
  async reverseOrderRun(orderId, reason, actorId) {
    return this.prisma.$transaction(async (tx) => {
      const entries = await tx.ledgerEntry.findMany({
        where: { refType: "order", refId: orderId, direction: "CREDIT" },
        select: { id: true }
      });
      for (const e of entries) await this.ledger.reverse(tx, e.id, reason, actorId);
      await tx.commission.deleteMany({ where: { orderId } });
      await tx.order.update({ where: { id: orderId }, data: { commissionRunAt: null } });
      await tx.auditLog.create({
        data: { actorType: "ADMIN", actorId, action: "commission.reverse", detail: { orderId, reason, entries: entries.length } }
      });
      return entries.length;
    });
  }
};
CommissionService = __decorateClass([
  Injectable2()
], CommissionService);
function ledgerCategoryFor(type) {
  switch (type) {
    case "SELF":
      return "SELF_INCOME";
    case "DIRECT":
      return "DIRECT_INCOME";
    case "TEAM":
      return "TEAM_INCOME";
    case "GENERATION":
      return "GENERATION_BONUS";
    case "ROYALTY":
      return "ROYALTY";
  }
}

// src/__tests__/plan.spec.ts
test("rupees convert to paise without float drift", () => {
  assert.equal(rupeesToPaise("599.50"), 59950n);
  assert.equal(rupeesToPaise("0.01"), 1n);
  assert.equal(rupeesToPaise(1599), 159900n);
  assert.equal(paiseToRupeeString(59950n), "599.50");
  assert.throws(() => rupeesToPaise("10.999"), /at most 2 decimals/);
});
test("the 0.1 + 0.2 problem does not exist on the ledger", () => {
  const a = rupeesToPaise("0.1");
  const b = rupeesToPaise("0.2");
  assert.equal(a + b, rupeesToPaise("0.3"));
  assert.notEqual(0.1 + 0.2, 0.3);
});
test("rupees format with Indian digit grouping", () => {
  assert.equal(formatInr(10000000n), "\u20B91,00,000");
  assert.equal(formatInr(59950n), "\u20B9599.50");
  assert.equal(formatInr(0n), "\u20B90");
});
test("BV converts to centi-BV", () => {
  assert.equal(bvToCenti(300), 3e4);
  assert.equal(bvToCenti("2.5"), 250);
  assert.equal(centiToBvString(3e4), "300");
  assert.equal(centiToBvString(250), "2.50");
});
test("commission is exact and rounds down, returning the dust", () => {
  assert.equal(commissionOn(bvToCenti(300), percentToBp(19)).amountPaise, rupeesToPaise(57));
  assert.equal(commissionOn(bvToCenti(800), percentToBp(2)).amountPaise, rupeesToPaise(16));
  const dusty = commissionOn(7, 3);
  assert.equal(dusty.amountPaise, 0n);
  assert.equal(dusty.remainderPaise, 21n);
});
test("rounding never invents money", () => {
  for (let bv = 1; bv <= 500; bv++) {
    const { amountPaise, remainderPaise } = commissionOn(bv, 1900);
    assert.equal(amountPaise * 10000n + remainderPaise, BigInt(bv) * 1900n);
  }
});
test("withdrawal deduction matches the plan", () => {
  const { amountPaise } = pctOfPaise(rupeesToPaise(1e3), percentToBp(10));
  assert.equal(amountPaise, rupeesToPaise(100));
  assert.equal(rupeesToPaise(1e3) - amountPaise, rupeesToPaise(900));
});
test("GST is extracted from a tax-inclusive price", () => {
  assert.equal(gstInclusiveComponent(rupeesToPaise(599), percentToBp(18)), rupeesToPaise("91.37"));
});
test("a royalty pool splits without losing a paise", () => {
  const pool = 10000n;
  const { perHead, extras } = splitPool(pool, 3);
  const shares = Array.from({ length: 3 }, (_, i) => perHead + (i < extras ? 1n : 0n));
  assert.equal(sumPaise(shares), pool);
  assert.equal(shares[0] - shares[2], 1n);
  assert.throws(() => splitPool(pool, 0), /between nobody/);
});
test("the client's plan document validates", () => {
  const plan = parsePlan(CLIENT_DEFAULT_PLAN);
  assert.equal(plan.ranks.length, 5);
  assert.equal(plan.ranks[4].name, "Diamond");
  assert.equal(plan.ranks[4].selfPctBp, 2500);
  assert.equal(plan.joining.minFirstPurchase, bvToCenti(2e3));
});
test("members land in the right rank band", () => {
  const p = CLIENT_DEFAULT_PLAN;
  assert.equal(rankIndexFor(p, bvToCenti(0)), 0);
  assert.equal(rankIndexFor(p, bvToCenti(999)), 0);
  assert.equal(rankIndexFor(p, bvToCenti(1e3)), 1);
  assert.equal(rankIndexFor(p, bvToCenti(14999)), 2);
  assert.equal(rankIndexFor(p, bvToCenti(4e4)), 4);
  assert.equal(rankIndexFor(p, bvToCenti(999999)), 4);
});
test("the default plan commits 45% of BV and is sustainable", () => {
  const { totalBp: totalBp2 } = payoutExposure(CLIENT_DEFAULT_PLAN);
  assert.equal(totalBp2, percentToBp(45));
  assert.doesNotThrow(() => assertSustainable(CLIENT_DEFAULT_PLAN));
});
test("unlimited flat team income is refused without an explicit acknowledgement", () => {
  const reckless = {
    ...CLIENT_DEFAULT_PLAN,
    team: { enabled: true, mode: "FLAT", depth: 0 }
  };
  assert.equal(payoutExposure(reckless).totalBp, null);
  assert.throws(() => assertSustainable(reckless), PlanUnsustainableError);
  assert.doesNotThrow(() => assertSustainable(reckless, { acceptUnlimited: true }));
});
test("a plan over the payout ceiling is refused", () => {
  const greedy = {
    ...CLIENT_DEFAULT_PLAN,
    team: { enabled: true, mode: "FLAT", depth: 8 }
    // 5% x 8 levels = 40% on top
  };
  assert.throws(() => assertSustainable(greedy), /commits 85% of BV/);
});
test("a rank ladder that does not start at zero is rejected", () => {
  const broken = { ...CLIENT_DEFAULT_PLAN, ranks: CLIENT_DEFAULT_PLAN.ranks.slice(1) };
  const result = PlanConfigSchema.safeParse(broken);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /first rank must start at 0 BV/);
});
test("out-of-order rank targets are rejected", () => {
  const jumbled = {
    ...CLIENT_DEFAULT_PLAN,
    ranks: [
      CLIENT_DEFAULT_PLAN.ranks[0],
      { ...CLIENT_DEFAULT_PLAN.ranks[1], minBvCenti: bvToCenti(9e4) },
      CLIENT_DEFAULT_PLAN.ranks[2]
    ]
  };
  assert.equal(PlanConfigSchema.safeParse(jumbled).success, false);
});
test("a 500% commission typo cannot be saved", () => {
  const typo = { ...CLIENT_DEFAULT_PLAN, direct: { enabled: true, pctBp: percentToBp(500), basis: "FIRST_PURCHASE" } };
  assert.equal(PlanConfigSchema.safeParse(typo).success, false);
});
var svc = new CommissionService(null, null);
var seq = 0;
function member(over = {}) {
  const id = over.id ?? `m${++seq}`;
  return {
    id,
    memberCode: id.toUpperCase(),
    name: id,
    phone: "9000000000",
    email: null,
    status: "ACTIVE",
    isCompany: false,
    sponsorId: null,
    ancestorPath: "/",
    depth: 0,
    rankIndex: 0,
    selfBvCenti: 0n,
    groupBvCenti: 0n,
    payoutUpi: null,
    payoutHolder: null,
    payoutBank: null,
    payoutAccount: null,
    payoutIfsc: null,
    lastDeviceId: null,
    joinedAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date(),
    ...over
  };
}
var run = (plan, buyer, chain, bv = 800, isFirst = false) => svc.computePayouts({ plan, buyer, chain, bvCenti: bvToCenti(bv), isFirstPurchase: isFirst, orderNo: "OD1" });
var totalBp = (payouts) => payouts.reduce((a, p) => a + p.pctBp, 0);
test("gap mode: each upline earns only the difference above the best rate below", () => {
  const buyer = member({ id: "buyer", rankIndex: 0 });
  const gold = member({ id: "gold", rankIndex: 3 });
  const dia1 = member({ id: "dia1", rankIndex: 4 });
  const dia2 = member({ id: "dia2", rankIndex: 4 });
  const payouts = run(CLIENT_DEFAULT_PLAN, buyer, [gold, dia1, dia2]);
  const team = payouts.filter((p) => p.type === "TEAM");
  assert.equal(payouts.find((p) => p.type === "SELF").pctBp, percentToBp(10));
  assert.equal(team.find((p) => p.memberId === "gold").pctBp, percentToBp(12));
  assert.equal(team.find((p) => p.memberId === "dia1").pctBp, percentToBp(3));
  assert.equal(team.find((p) => p.memberId === "dia2"), void 0);
});
test("gap mode never pays out more than the top rank rate, at any depth", () => {
  const top = percentToBp(25);
  const plan = { ...CLIENT_DEFAULT_PLAN, direct: { ...CLIENT_DEFAULT_PLAN.direct, enabled: false }, generation: { ...CLIENT_DEFAULT_PLAN.generation, enabled: false } };
  for (let trial = 0; trial < 200; trial++) {
    const buyer = member({ rankIndex: Math.floor(Math.random() * 5) });
    const chain = Array.from(
      { length: Math.floor(Math.random() * 15) },
      () => member({ rankIndex: Math.floor(Math.random() * 5) })
    );
    assert.ok(totalBp(run(plan, buyer, chain)) <= top, "gap mode leaked past the top rank rate");
  }
});
test("generation bonus reaches the first three qualifying uplines only", () => {
  const buyer = member({ id: "buyer" });
  const chain = [
    member({ id: "star", rankIndex: 0 }),
    member({ id: "d1", rankIndex: 4 }),
    member({ id: "silver", rankIndex: 2 }),
    member({ id: "d2", rankIndex: 4 }),
    member({ id: "d3", rankIndex: 4 }),
    member({ id: "d4", rankIndex: 4 })
    // past the third generation
  ];
  const gens = run(CLIENT_DEFAULT_PLAN, buyer, chain).filter((p) => p.type === "GENERATION");
  assert.deepEqual(gens.map((g) => g.memberId), ["d1", "d2", "d3"]);
  assert.deepEqual(gens.map((g) => g.pctBp), [percentToBp(2), percentToBp(2), percentToBp(1)]);
  assert.deepEqual(gens.map((g) => g.generationLevel), [1, 2, 3]);
});
test("onlyQualified off: a non-qualifying upline burns its generation slot unpaid", () => {
  const plan = { ...CLIENT_DEFAULT_PLAN, generation: { ...CLIENT_DEFAULT_PLAN.generation, onlyQualified: false } };
  const chain = [member({ id: "star", rankIndex: 0 }), member({ id: "d1", rankIndex: 4 })];
  const gens = run(plan, member(), chain).filter((p) => p.type === "GENERATION");
  assert.deepEqual(gens.map((g) => g.memberId), ["d1"]);
  assert.equal(gens[0].generationLevel, 2);
});
test("direct income on first purchase only, when the plan says so", () => {
  const sponsor = member({ id: "sponsor", rankIndex: 2 });
  const repeat = run(CLIENT_DEFAULT_PLAN, member(), [sponsor], 800, false);
  const first = run(CLIENT_DEFAULT_PLAN, member(), [sponsor], 800, true);
  assert.equal(repeat.find((p) => p.type === "DIRECT"), void 0);
  assert.equal(first.find((p) => p.type === "DIRECT").pctBp, percentToBp(10));
});
test("every purchase basis pays the sponsor each time", () => {
  const plan = { ...CLIENT_DEFAULT_PLAN, direct: { enabled: true, pctBp: percentToBp(10), basis: "EVERY_PURCHASE" } };
  const payouts = run(plan, member(), [member({ id: "sponsor" })], 800, false);
  assert.equal(payouts.find((p) => p.type === "DIRECT").memberId, "sponsor");
});
test("flat team mode pays every level down to the configured depth", () => {
  const plan = { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: "FLAT", depth: 2 } };
  const chain = [member({ id: "u1" }), member({ id: "u2" }), member({ id: "u3" })];
  const team = run(plan, member(), chain).filter((p) => p.type === "TEAM");
  assert.deepEqual(team.map((t) => t.memberId), ["u1", "u2"]);
  assert.deepEqual(team.map((t) => t.pctBp), [percentToBp(5), percentToBp(5)]);
});
test("direct-only team mode pays the sponsor and nobody above", () => {
  const plan = { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: "DIRECT_ONLY", depth: 0 } };
  const team = run(plan, member(), [member({ id: "u1" }), member({ id: "u2", rankIndex: 4 })]).filter((p) => p.type === "TEAM");
  assert.deepEqual(team.map((t) => t.memberId), ["u1"]);
});
test("members on hold and the company account earn nothing", () => {
  const buyer = member({ id: "buyer" });
  const chain = [
    member({ id: "held", rankIndex: 4, status: "ON_HOLD" }),
    member({ id: "company", rankIndex: 4, isCompany: true }),
    member({ id: "ok", rankIndex: 4 })
  ];
  const ids = new Set(run(CLIENT_DEFAULT_PLAN, buyer, chain, 800, true).map((p) => p.memberId));
  assert.equal(ids.has("held"), false);
  assert.equal(ids.has("company"), false);
  assert.equal(ids.has("ok"), true);
});
test("an orphan buyer with no sponsor still earns self income and nothing breaks", () => {
  const payouts = run(CLIENT_DEFAULT_PLAN, member({ rankIndex: 4 }), [], 800, true);
  assert.equal(payouts.length, 1);
  assert.equal(payouts[0].type, "SELF");
  assert.equal(payouts[0].pctBp, percentToBp(25));
});
test("switching off every component pays nobody", () => {
  const off = {
    ...CLIENT_DEFAULT_PLAN,
    self: { enabled: false },
    direct: { ...CLIENT_DEFAULT_PLAN.direct, enabled: false },
    team: { ...CLIENT_DEFAULT_PLAN.team, enabled: false },
    generation: { ...CLIENT_DEFAULT_PLAN.generation, enabled: false }
  };
  assert.deepEqual(run(off, member(), [member({ rankIndex: 4 })], 800, true), []);
});
test("a real order pays the exact rupee amounts the plan promises", () => {
  const buyer = member({ id: "buyer", rankIndex: 0 });
  const chain = [member({ id: "gold", rankIndex: 3 }), member({ id: "dia", rankIndex: 4 })];
  const payouts = run(CLIENT_DEFAULT_PLAN, buyer, chain, 800, true);
  const byWho = Object.fromEntries(payouts.map((p) => [`${p.memberId}:${p.type}`, p.amountPaise]));
  assert.equal(byWho["buyer:SELF"], rupeesToPaise(80));
  assert.equal(byWho["gold:DIRECT"], rupeesToPaise(80));
  assert.equal(byWho["gold:TEAM"], rupeesToPaise(96));
  assert.equal(byWho["dia:TEAM"], rupeesToPaise(24));
  assert.equal(byWho["dia:GENERATION"], rupeesToPaise(16));
  assert.equal(sumPaise(payouts.map((p) => p.amountPaise)), rupeesToPaise(296));
});
