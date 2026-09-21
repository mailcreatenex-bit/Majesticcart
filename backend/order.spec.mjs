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

// src/__tests__/order.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/order/pricing.ts
import { BadRequestException } from "@nestjs/common";

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
function gstInclusiveComponent(inclusivePaise, gstBp) {
  const denom = BigInt(BP_DENOMINATOR + gstBp);
  return inclusivePaise * BigInt(gstBp) / denom;
}
var sumPaise = (xs) => xs.reduce((a, b) => a + b, 0n);

// src/order/pricing.ts
function priceOrder(items) {
  if (items.length === 0) throw new BadRequestException("Your bag is empty.");
  let totalPaise = 0n;
  let gstPaise = 0n;
  let mrpTotalPaise = 0n;
  let totalBvCenti = 0;
  for (const item2 of items) {
    if (!Number.isInteger(item2.quantity) || item2.quantity < 1) {
      throw new BadRequestException(`Quantity for ${item2.name} must be a whole number of at least 1.`);
    }
    const qty = BigInt(item2.quantity);
    const lineTotal = item2.pricePaise * qty;
    totalPaise += lineTotal;
    gstPaise += gstInclusiveComponent(lineTotal, item2.gstBp);
    mrpTotalPaise += item2.mrpPaise * qty;
    totalBvCenti += item2.bvCenti * item2.quantity;
  }
  return {
    subtotalPaise: totalPaise - gstPaise,
    gstPaise,
    totalPaise,
    mrpTotalPaise,
    discountPaise: mrpTotalPaise - totalPaise,
    totalBvCenti
  };
}
function assertJoiningMinimum(plan, isFirstPurchase, totals) {
  if (!isFirstPurchase || plan.joining.mode !== "MIN_FIRST_PURCHASE") return;
  const required = plan.joining.minFirstPurchase;
  if (plan.joining.unit === "BV") {
    if (totals.totalBvCenti < required) {
      throw new BadRequestException(
        `Your first order needs to be at least ${centiToBvString(required)} BV. This bag has ${centiToBvString(totals.totalBvCenti)} BV. Add more products to continue.`
      );
    }
    return;
  }
  if (totals.totalPaise < BigInt(required)) {
    throw new BadRequestException(
      `Your first order needs to be at least ${formatInr(BigInt(required))}. This bag has ${formatInr(totals.totalPaise)}. Add more products to continue.`
    );
  }
}
function normaliseCart(lines, maxPerProduct = 99) {
  if (!Array.isArray(lines) || lines.length === 0) throw new BadRequestException("Your bag is empty.");
  const merged = /* @__PURE__ */ new Map();
  for (const line of lines) {
    if (!line?.productId) throw new BadRequestException("An item in your bag is invalid.");
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequestException("Quantities must be whole numbers of at least 1.");
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + qty);
  }
  for (const [productId, qty] of merged) {
    if (qty > maxPerProduct) {
      throw new BadRequestException(`You can order at most ${maxPerProduct} units of one product per order.`);
    }
    merged.set(productId, qty);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}

// src/order/order.service.ts
import { Injectable as Injectable2, Logger as Logger2, BadRequestException as BadRequestException3, ConflictException as ConflictException2 } from "@nestjs/common";

// src/ledger/ledger.service.ts
import { Injectable, Logger, ConflictException, BadRequestException as BadRequestException2 } from "@nestjs/common";
import { Prisma } from "@prisma/client";
var InsufficientFundsError = class extends BadRequestException2 {
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
      throw new BadRequestException2(`No ${kind} wallet exists for member ${memberId}`);
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
      throw new BadRequestException2(`A posting must be positive, got ${req.amountPaise}`);
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
    if (!wallet) throw new BadRequestException2(`No ${kind} wallet for ${memberId}`);
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
    if (!original) throw new BadRequestException2(`Ledger entry ${entryId} not found`);
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
function parsePlan(raw) {
  return PlanConfigSchema.parse(raw);
}

// src/order/order.service.ts
var ALLOWED_TRANSITIONS = {
  PLACED: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  // returns go through returnDelivered(), not a transition
  CANCELLED: []
};
var OrderService = class {
  constructor(prisma, ledger, commission) {
    this.prisma = prisma;
    this.ledger = ledger;
    this.commission = commission;
  }
  prisma;
  ledger;
  commission;
  log = new Logger2(OrderService.name);
  /**
   * Allocate the next number in a gapless series.
   *
   * Takes a row lock, so concurrent checkouts serialise on this one row. That
   * is a deliberate trade: a Postgres sequence would be faster but burns
   * numbers on rollback, and a GST invoice series may not have holes.
   */
  async nextNumber(tx, key, prefix) {
    const rows = await tx.$queryRaw`
      INSERT INTO "NumberSeries" (key, prefix, "nextValue", "updatedAt")
      VALUES (${key}, ${prefix}, 2, NOW())
      ON CONFLICT (key) DO UPDATE SET "nextValue" = "NumberSeries"."nextValue" + 1, "updatedAt" = NOW()
      RETURNING prefix, "nextValue" - 1 AS "nextValue"
    `;
    const row = rows[0];
    return `${row.prefix}${row.nextValue}`;
  }
  async checkout(input) {
    const lines = normaliseCart(input.lines);
    const shipping = this.validateShipping(input.shipping);
    return this.prisma.$transaction(
      async (tx) => {
        const planRow = await tx.planVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
        const plan = parsePlan(planRow.config);
        const products = await tx.product.findMany({
          where: { id: { in: lines.map((l) => l.productId) } },
          orderBy: { id: "asc" }
        });
        if (products.length !== lines.length) {
          throw new BadRequestException3("An item in your bag is no longer sold. Remove it to continue.");
        }
        const byId = new Map(products.map((p) => [p.id, p]));
        const items = lines.map((line) => {
          const p = byId.get(line.productId);
          if (!p.isActive) throw new BadRequestException3(`${p.name} is no longer available.`);
          return {
            productId: p.id,
            name: p.name,
            pricePaise: p.pricePaise,
            mrpPaise: p.mrpPaise,
            bvCenti: p.bvCenti,
            gstBp: p.gstBp,
            quantity: line.quantity
          };
        });
        const totals = priceOrder(items);
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        if (member.status !== "ACTIVE") {
          throw new BadRequestException3("Your account is on hold. Contact support to place orders.");
        }
        await this.ledger.lockWallets(tx, [{ memberId: member.id, wallet: "SHOPPING" }]);
        const priorOrders = await tx.order.count({
          where: { memberId: member.id, status: { not: "CANCELLED" } }
        });
        const isFirstPurchase = priorOrders === 0;
        assertJoiningMinimum(plan, isFirstPurchase, totals);
        for (const item2 of items) {
          const claimed = await tx.product.updateMany({
            where: { id: item2.productId, stock: { gte: item2.quantity } },
            data: { stock: { decrement: item2.quantity }, sold: { increment: item2.quantity } }
          });
          if (claimed.count === 0) {
            const fresh = await tx.product.findUnique({ where: { id: item2.productId }, select: { stock: true } });
            throw new ConflictException2(
              `Only ${fresh?.stock ?? 0} left of ${item2.name}. Lower the quantity to continue.`
            );
          }
        }
        const orderNo = await this.nextNumber(tx, "order", "OD");
        const order = await tx.order.create({
          data: {
            orderNo,
            memberId: member.id,
            status: "PLACED",
            subtotalPaise: totals.subtotalPaise,
            gstPaise: totals.gstPaise,
            totalPaise: totals.totalPaise,
            totalBvCenti: totals.totalBvCenti,
            isFirstPurchase,
            shipName: shipping.name,
            shipPhone: shipping.phone,
            shipLine: shipping.line,
            shipCity: shipping.city,
            shipState: shipping.state,
            shipPincode: shipping.pincode,
            items: {
              create: items.map((i) => ({
                productId: i.productId,
                nameSnapshot: i.name,
                // snapshot: a price edit next month must not rewrite history
                pricePaise: i.pricePaise,
                mrpPaise: i.mrpPaise,
                bvCenti: i.bvCenti,
                gstBp: i.gstBp,
                quantity: i.quantity
              }))
            },
            events: { create: { status: "PLACED" } }
          },
          include: { items: true }
        });
        await this.ledger.post(tx, {
          memberId: member.id,
          wallet: "SHOPPING",
          direction: "DEBIT",
          amountPaise: totals.totalPaise,
          category: "ORDER_PAYMENT",
          idempotencyKey: input.requestId ? idempotencyKey("order-pay", member.id, input.requestId) : idempotencyKey("order-pay", order.id),
          refType: "order",
          refId: order.id,
          note: `Order ${orderNo}`
        });
        await tx.member.update({
          where: { id: member.id },
          data: {
            addressLine: shipping.line,
            city: shipping.city,
            state: shipping.state,
            pincode: shipping.pincode
          }
        });
        await tx.notification.create({
          data: {
            memberId: member.id,
            title: "Order placed",
            body: `${orderNo} for ${formatInr(totals.totalPaise)} is confirmed. Income is credited once it's delivered.`,
            kind: "ORDER"
          }
        });
        this.log.log(`${orderNo}: ${formatInr(totals.totalPaise)}, ${totals.totalBvCenti} centi-BV, first=${isFirstPurchase}`);
        return order;
      },
      { isolationLevel: "ReadCommitted", timeout: 2e4 }
    );
  }
  /**
   * Move an order along the fulfilment chain.
   *
   * DELIVERED does not pay commission inline. It enqueues a job, so a slow
   * genealogy walk cannot hold a database transaction open while an admin waits
   * on a button, and a transient failure is retried by the queue rather than
   * losing the payout.
   */
  async transition(orderId, next, args = {}) {
    const order = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id, status FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `;
      if (locked.length === 0) throw new BadRequestException3("Order not found.");
      const current = locked[0].status;
      if (!ALLOWED_TRANSITIONS[current].includes(next)) {
        throw new ConflictException2(`An order that is ${current.toLowerCase()} can't be marked ${next.toLowerCase()}.`);
      }
      if (next === "CANCELLED") return this.applyCancellation(tx, orderId, args);
      const patch = { status: next };
      if (next === "DELIVERED") {
        patch.deliveredAt = /* @__PURE__ */ new Date();
        patch.planVersionId = (await tx.planVersion.findFirstOrThrow({ orderBy: { version: "desc" } })).id;
        patch.invoiceNo = await this.nextNumber(tx, `invoice:${financialYear()}`, `INV/${financialYear()}/`);
        patch.invoicedAt = /* @__PURE__ */ new Date();
      }
      const updated = await tx.order.update({ where: { id: orderId }, data: patch });
      await tx.orderEvent.create({ data: { orderId, status: next, note: args.note, actorId: args.actorId } });
      await tx.notification.create({
        data: {
          memberId: updated.memberId,
          title: next === "DELIVERED" ? "Order delivered" : `Order ${next.toLowerCase()}`,
          body: `${updated.orderNo} is ${next.toLowerCase()}.`,
          kind: "ORDER"
        }
      });
      await tx.auditLog.create({
        data: { actorType: "ADMIN", actorId: args.actorId, action: "order.transition", detail: { orderId, from: current, to: next } }
      });
      return updated;
    });
    if (next === "DELIVERED") await this.enqueueCommission(orderId);
    return order;
  }
  /**
   * Refund and restock. Only reachable before delivery, so no commission has
   * run yet and there is nothing to claw back.
   */
  async applyCancellation(tx, orderId, args) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.commissionRunAt) {
      throw new ConflictException2("Commission has already been paid on this order. Use the return flow instead.");
    }
    const items = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const item2 of items) {
      await tx.product.update({
        where: { id: item2.productId },
        data: { stock: { increment: item2.quantity }, sold: { decrement: item2.quantity } }
      });
    }
    await this.ledger.post(tx, {
      memberId: order.memberId,
      wallet: "SHOPPING",
      direction: "CREDIT",
      amountPaise: order.totalPaise,
      category: "ORDER_REFUND",
      idempotencyKey: idempotencyKey("order-refund", order.id),
      refType: "order",
      refId: order.id,
      note: `Refund for ${order.orderNo}`
    });
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await tx.orderEvent.create({ data: { orderId, status: "CANCELLED", note: args.note, actorId: args.actorId } });
    await tx.notification.create({
      data: {
        memberId: order.memberId,
        title: "Order cancelled",
        body: `${order.orderNo} was cancelled${args.note ? ` (${args.note})` : ""}. ${formatInr(order.totalPaise)} is back in your shopping wallet.`,
        kind: "ORDER"
      }
    });
    return updated;
  }
  /**
   * A delivered order coming back.
   *
   * This is the expensive path the delivery-time payout rule exists to keep
   * rare: commission has already landed in income wallets and may already have
   * been withdrawn, so reversing it can push a wallet negative. That is
   * deliberate — the debt is recorded rather than silently written off, and
   * finance decides how to recover it.
   */
  async returnDelivered(orderId, args) {
    const reason = args.reason?.trim();
    if (!reason) throw new BadRequestException3("Record why the order is being returned.");
    const reversed = await this.commission.reverseOrderRun(orderId, reason, args.actorId);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      if (order.status !== "DELIVERED") throw new ConflictException2("Only a delivered order can be returned.");
      if (args.restock !== false) {
        const items = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));
        for (const item2 of items) {
          await tx.product.update({
            where: { id: item2.productId },
            data: { stock: { increment: item2.quantity }, sold: { decrement: item2.quantity } }
          });
        }
      }
      const buyer = await tx.member.findUniqueOrThrow({ where: { id: order.memberId } });
      const ancestorIds = buyer.ancestorPath.split("/").filter(Boolean);
      await tx.member.update({
        where: { id: buyer.id },
        data: {
          selfBvCenti: { decrement: BigInt(order.totalBvCenti) },
          groupBvCenti: { decrement: BigInt(order.totalBvCenti) }
        }
      });
      if (ancestorIds.length > 0) {
        await tx.member.updateMany({
          where: { id: { in: ancestorIds } },
          data: { groupBvCenti: { decrement: BigInt(order.totalBvCenti) } }
        });
      }
      await this.ledger.post(tx, {
        memberId: order.memberId,
        wallet: "SHOPPING",
        direction: "CREDIT",
        amountPaise: order.totalPaise,
        category: "ORDER_REFUND",
        idempotencyKey: idempotencyKey("order-return", order.id),
        refType: "order",
        refId: order.id,
        note: `Return of ${order.orderNo}: ${reason}`
      });
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await tx.orderEvent.create({ data: { orderId, status: "CANCELLED", note: `Returned: ${reason}`, actorId: args.actorId } });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: args.actorId,
          action: "order.return",
          detail: { orderId, reason, reversedEntries: reversed, refundPaise: order.totalPaise.toString() }
        }
      });
      this.log.warn(`${order.orderNo} returned. ${reversed} commission entries reversed \u2014 check for negative income wallets.`);
      return { ok: true, reversedEntries: reversed };
    });
  }
  /**
   * Hand the payout to BullMQ. The jobId makes a duplicate enqueue a no-op, and
   * the engine's own idempotency keys make a duplicate *run* a no-op too —
   * belt and braces, because this is the money path.
   */
  async enqueueCommission(orderId) {
    await this.commissionQueue?.add(
      "run",
      { orderId },
      {
        jobId: `commission:${orderId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 5e3 },
        removeOnComplete: 1e3,
        removeOnFail: false
        // a failed payout must stay visible for triage
      }
    );
  }
  /** Set by OrderModule. Typed loosely so the queue is not a test dependency. */
  commissionQueue;
  validateShipping(s) {
    const name = s?.name?.trim() ?? "";
    const phone = (s?.phone ?? "").replace(/\s/g, "");
    const line = s?.line?.trim() ?? "";
    const city = s?.city?.trim() ?? "";
    const state = s?.state?.trim() ?? "";
    const pincode = (s?.pincode ?? "").trim();
    if (!name) throw new BadRequestException3("Enter the recipient's name.");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new BadRequestException3("Enter a valid 10-digit mobile number for delivery.");
    if (line.length < 6) throw new BadRequestException3("Enter the full street address.");
    if (!city) throw new BadRequestException3("Enter the city.");
    if (!state) throw new BadRequestException3("Choose the state.");
    if (!/^[1-9]\d{5}$/.test(pincode)) throw new BadRequestException3("Enter a valid 6-digit PIN code.");
    return { name, phone, line, city, state, pincode };
  }
};
OrderService = __decorateClass([
  Injectable2()
], OrderService);
function financialYear(d = /* @__PURE__ */ new Date()) {
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

// src/__tests__/order.spec.ts
var item = (over = {}) => ({
  productId: "p1",
  name: "Rose Gold Body Lotion",
  pricePaise: rupeesToPaise(599),
  mrpPaise: rupeesToPaise(699),
  bvCenti: bvToCenti(300),
  gstBp: 1800,
  quantity: 1,
  ...over
});
test("a single line prices correctly with GST extracted from the shelf price", () => {
  const t = priceOrder([item()]);
  assert.equal(t.totalPaise, rupeesToPaise(599));
  assert.equal(t.gstPaise, rupeesToPaise("91.37"));
  assert.equal(t.subtotalPaise, rupeesToPaise("507.63"));
  assert.equal(t.subtotalPaise + t.gstPaise, t.totalPaise);
  assert.equal(t.discountPaise, rupeesToPaise(100));
  assert.equal(t.totalBvCenti, bvToCenti(300));
});
test("quantity multiplies price, BV and discount together", () => {
  const t = priceOrder([item({ quantity: 3 })]);
  assert.equal(t.totalPaise, rupeesToPaise(1797));
  assert.equal(t.totalBvCenti, bvToCenti(900));
  assert.equal(t.discountPaise, rupeesToPaise(300));
});
test("GST is computed per line, not blended over the cart", () => {
  const t = priceOrder([
    item({ productId: "oil", pricePaise: rupeesToPaise(379), mrpPaise: rupeesToPaise(449), gstBp: 500, bvCenti: bvToCenti(190) }),
    item({ productId: "lotion", pricePaise: rupeesToPaise(599), mrpPaise: rupeesToPaise(699), gstBp: 1800, bvCenti: bvToCenti(300) })
  ]);
  const oilGst = rupeesToPaise("18.04");
  const lotionGst = rupeesToPaise("91.37");
  assert.equal(t.gstPaise, oilGst + lotionGst);
  assert.equal(t.totalPaise, rupeesToPaise(978));
  assert.equal(t.totalBvCenti, bvToCenti(490));
});
test("subtotal plus GST always reconciles to the total", () => {
  for (let price = 1; price <= 400; price++) {
    for (const gstBp of [0, 500, 1200, 1800, 2800]) {
      const t = priceOrder([item({ pricePaise: rupeesToPaise(price), mrpPaise: rupeesToPaise(price), gstBp, quantity: price % 4 + 1 })]);
      assert.equal(t.subtotalPaise + t.gstPaise, t.totalPaise);
    }
  }
});
test("an empty bag is refused", () => {
  assert.throws(() => priceOrder([]), /bag is empty/);
});
test("a fractional or zero quantity is refused", () => {
  assert.throws(() => priceOrder([item({ quantity: 0 })]), /whole number/);
  assert.throws(() => priceOrder([item({ quantity: 1.5 })]), /whole number/);
});
test("duplicate lines merge instead of fighting each other for stock", () => {
  const cart = normaliseCart([
    { productId: "b", quantity: 1 },
    { productId: "a", quantity: 2 },
    { productId: "b", quantity: 3 }
  ]);
  assert.deepEqual(cart, [
    { productId: "a", quantity: 2 },
    { productId: "b", quantity: 4 }
  ]);
});
test("the cart comes back sorted by product id \u2014 that is the lock order", () => {
  const cart = normaliseCart([
    { productId: "zeta", quantity: 1 },
    { productId: "alpha", quantity: 1 },
    { productId: "mid", quantity: 1 }
  ]);
  assert.deepEqual(cart.map((l) => l.productId), ["alpha", "mid", "zeta"]);
});
test("junk carts are rejected before they reach the database", () => {
  assert.throws(() => normaliseCart([]), /bag is empty/);
  assert.throws(() => normaliseCart([{ productId: "", quantity: 1 }]), /invalid/);
  assert.throws(() => normaliseCart([{ productId: "a", quantity: -2 }]), /whole numbers/);
  assert.throws(() => normaliseCart([{ productId: "a", quantity: 500 }]), /at most 99 units/);
  assert.throws(() => normaliseCart([{ productId: "a", quantity: 60 }, { productId: "a", quantity: 60 }]), /at most 99 units/);
});
test("a first order below the 2000 BV minimum is refused with the shortfall named", () => {
  const small = priceOrder([item({ bvCenti: bvToCenti(300) })]);
  assert.throws(
    () => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, small),
    /first order needs to be at least 2000 BV.*has 300 BV/s
  );
});
test("a first order meeting the minimum passes", () => {
  const big = priceOrder([item({ bvCenti: bvToCenti(800), quantity: 3 })]);
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, big));
});
test("the minimum applies to the first order only, never to repeat orders", () => {
  const small = priceOrder([item({ bvCenti: bvToCenti(120) })]);
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, false, small));
});
test("free joining lets a first order be any size", () => {
  const free = { ...CLIENT_DEFAULT_PLAN, joining: { mode: "FREE", minFirstPurchase: 0, unit: "BV" } };
  const tiny = priceOrder([item({ bvCenti: bvToCenti(10) })]);
  assert.doesNotThrow(() => assertJoiningMinimum(free, true, tiny));
});
test("the minimum can be set in rupees instead of BV", () => {
  const inRupees = {
    ...CLIENT_DEFAULT_PLAN,
    joining: { mode: "MIN_FIRST_PURCHASE", minFirstPurchase: Number(rupeesToPaise(2e3)), unit: "INR" }
  };
  const under = priceOrder([item({ pricePaise: rupeesToPaise(599) })]);
  const over = priceOrder([item({ pricePaise: rupeesToPaise(599), quantity: 4 })]);
  assert.throws(() => assertJoiningMinimum(inRupees, true, under), /at least ₹2,000/);
  assert.doesNotThrow(() => assertJoiningMinimum(inRupees, true, over));
});
test("the Indian financial year runs April to March", () => {
  assert.equal(financialYear(/* @__PURE__ */ new Date("2026-09-12")), "2026-27");
  assert.equal(financialYear(/* @__PURE__ */ new Date("2026-04-01")), "2026-27");
  assert.equal(financialYear(/* @__PURE__ */ new Date("2026-03-31")), "2025-26");
  assert.equal(financialYear(/* @__PURE__ */ new Date("2027-01-15")), "2026-27");
});
test("a realistic first order produces the figures the member is shown", () => {
  const totals = priceOrder([
    item({ productId: "oud", name: "Oud Royale", pricePaise: rupeesToPaise(1599), mrpPaise: rupeesToPaise(1899), bvCenti: bvToCenti(800), quantity: 2 }),
    item({ productId: "serum", name: "Vitamin C Serum", pricePaise: rupeesToPaise(799), mrpPaise: rupeesToPaise(999), bvCenti: bvToCenti(400), quantity: 1 })
  ]);
  assert.equal(formatInr(totals.totalPaise), "\u20B93,997");
  assert.equal(formatInr(totals.mrpTotalPaise), "\u20B94,797");
  assert.equal(formatInr(totals.discountPaise), "\u20B9800");
  assert.equal(totals.totalBvCenti, bvToCenti(2e3));
  assert.equal(totals.subtotalPaise + totals.gstPaise, totals.totalPaise);
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, totals));
});
