import { z } from 'zod';
import { percentToBp, bvToCenti, rupeesToPaise, BasisPoints } from '../common/money';

/**
 * The compensation plan as a validated document.
 *
 * Nothing here is a database column. The client edits all of it from the admin
 * console, so the only defence against a typo that pays 500% commission is this
 * schema plus the exposure ceiling in assertSustainable().
 *
 * Every percentage is stored in basis points so the plan document itself never
 * carries a float.
 */

export const RankSchema = z.object({
  name: z.string().trim().min(1).max(40),
  minBvCenti: z.number().int().min(0),
  selfPctBp: z.number().int().min(0).max(9000),
  teamPctBp: z.number().int().min(0).max(9000),
});

export const TeamModeSchema = z.enum(['GAP', 'FLAT', 'DIRECT_ONLY']);
export const DirectBasisSchema = z.enum(['FIRST_PURCHASE', 'EVERY_PURCHASE', 'WALLET_RECHARGE']);
export const JoinModeSchema = z.enum(['FREE', 'MIN_FIRST_PURCHASE']);
export const RankBasisSchema = z.enum(['GROUP_BV', 'TEAM_BV']);
export const QualifyModeSchema = z.enum(['RANK_COUNT', 'BV_TARGET']);
export const PayoutCycleSchema = z.enum(['INSTANT', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY']);

export const RoyaltyFundSchema = z.object({
  key: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(60),
  poolPctBp: z.number().int().min(0).max(2000),
  qualifyMode: QualifyModeSchema,
  minRankIndex: z.number().int().min(0),
  minCount: z.number().int().min(1),
  targetBvCenti: z.number().int().min(0),
});

export const PlanConfigSchema = z
  .object({
    rankBasis: RankBasisSchema,
    ranks: z.array(RankSchema).min(1).max(12),
    joining: z.object({
      mode: JoinModeSchema,
      minFirstPurchase: z.number().int().min(0), // centi-BV or paise, per unit
      unit: z.enum(['BV', 'INR']),
    }),
    self: z.object({ enabled: z.boolean() }),
    direct: z.object({
      enabled: z.boolean(),
      pctBp: z.number().int().min(0).max(5000),
      basis: DirectBasisSchema,
    }),
    team: z.object({
      enabled: z.boolean(),
      mode: TeamModeSchema,
      depth: z.number().int().min(0).max(50), // 0 = unlimited
    }),
    generation: z.object({
      enabled: z.boolean(),
      minRankIndex: z.number().int().min(0),
      onlyQualified: z.boolean(),
      levelsBp: z.array(z.number().int().min(0).max(5000)).max(20),
    }),
    repurchase: z.object({
      enabled: z.boolean(),
      monthlyBvCenti: z.number().int().min(0),
      blocksWithdrawal: z.boolean(),
    }),
    withdrawal: z.object({
      minPaise: z.string(), // bigint over the wire
      deductionBp: z.number().int().min(0).max(5000),
      cycle: PayoutCycleSchema,
    }),
    royalty: z.object({ funds: z.array(RoyaltyFundSchema).max(12) }),
  })
  .superRefine((plan, ctx) => {
    const path = (p: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: p, message });

    if (plan.ranks[0].minBvCenti !== 0) {
      path(['ranks', 0, 'minBvCenti'], 'The first rank must start at 0 BV so every member has a rank');
    }
    for (let i = 1; i < plan.ranks.length; i++) {
      if (plan.ranks[i].minBvCenti <= plan.ranks[i - 1].minBvCenti) {
        path(['ranks', i, 'minBvCenti'], 'Rank targets must increase down the ladder');
      }
    }
    if (plan.generation.minRankIndex >= plan.ranks.length) {
      path(['generation', 'minRankIndex'], 'That rank does not exist');
    }
    if (plan.generation.enabled && plan.generation.levelsBp.length === 0) {
      path(['generation', 'levelsBp'], 'Add at least one generation, or switch the bonus off');
    }
    if (plan.joining.mode === 'MIN_FIRST_PURCHASE' && plan.joining.minFirstPurchase <= 0) {
      path(['joining', 'minFirstPurchase'], 'Set a minimum, or switch joining to free');
    }
    for (const [i, f] of plan.royalty.funds.entries()) {
      if (f.minRankIndex >= plan.ranks.length) path(['royalty', 'funds', i, 'minRankIndex'], 'That rank does not exist');
      if (f.qualifyMode === 'BV_TARGET' && f.targetBvCenti <= 0) {
        path(['royalty', 'funds', i, 'targetBvCenti'], 'Set a BV target above 0');
      }
    }
    if (new Set(plan.royalty.funds.map((f) => f.key)).size !== plan.royalty.funds.length) {
      path(['royalty', 'funds'], 'Two funds cannot share the same key');
    }
  });

export type PlanConfig = z.infer<typeof PlanConfigSchema>;
export type Rank = z.infer<typeof RankSchema>;
export type RoyaltyFund = z.infer<typeof RoyaltyFundSchema>;

/* ---------------------------------------------------------------- defaults */

/** Straight from the client's plan document, September 2026. */
export const CLIENT_DEFAULT_PLAN: PlanConfig = {
  rankBasis: 'GROUP_BV',
  ranks: [
    { name: 'Star', minBvCenti: bvToCenti(0), selfPctBp: percentToBp(10), teamPctBp: percentToBp(5) },
    { name: 'Bronze', minBvCenti: bvToCenti(1000), selfPctBp: percentToBp(15), teamPctBp: percentToBp(5) },
    { name: 'Silver', minBvCenti: bvToCenti(5000), selfPctBp: percentToBp(19), teamPctBp: percentToBp(5) },
    { name: 'Gold', minBvCenti: bvToCenti(15000), selfPctBp: percentToBp(22), teamPctBp: percentToBp(5) },
    { name: 'Diamond', minBvCenti: bvToCenti(40000), selfPctBp: percentToBp(25), teamPctBp: percentToBp(5) },
  ],
  joining: { mode: 'MIN_FIRST_PURCHASE', minFirstPurchase: bvToCenti(2000), unit: 'BV' },
  self: { enabled: true },
  // The document says "DIRECT JOINING 10% UNLIMITED (ADD WALLET)". Paying on a
  // wallet top-up rewards money coming in rather than goods going out, which is
  // the pattern the Direct Selling Rules treat as a money circulation scheme.
  // Default is the product-sale version; WALLET_RECHARGE stays available but
  // carries the warning in the admin UI.
  direct: { enabled: true, pctBp: percentToBp(10), basis: 'FIRST_PURCHASE' },
  team: { enabled: true, mode: 'GAP', depth: 0 },
  generation: {
    enabled: true,
    minRankIndex: 4, // Diamond
    onlyQualified: true,
    levelsBp: [percentToBp(2), percentToBp(2), percentToBp(1)],
  },
  repurchase: { enabled: true, monthlyBvCenti: bvToCenti(500), blocksWithdrawal: true },
  withdrawal: { minPaise: rupeesToPaise(500).toString(), deductionBp: percentToBp(10), cycle: 'MONTHLY' },
  royalty: {
    funds: [
      { key: 'car', name: 'Car fund', poolPctBp: percentToBp(2), qualifyMode: 'RANK_COUNT', minRankIndex: 4, minCount: 3, targetBvCenti: 0 },
      { key: 'house', name: 'House fund', poolPctBp: percentToBp(2), qualifyMode: 'RANK_COUNT', minRankIndex: 4, minCount: 3, targetBvCenti: 0 },
      { key: 'travel', name: 'Travel fund', poolPctBp: percentToBp(1), qualifyMode: 'RANK_COUNT', minRankIndex: 4, minCount: 3, targetBvCenti: 0 },
    ],
  },
};

/* ---------------------------------------------------------------- helpers */

export function rankIndexFor(plan: PlanConfig, bvCenti: number): number {
  let index = 0;
  plan.ranks.forEach((r, i) => {
    if (bvCenti >= r.minBvCenti) index = i;
  });
  return index;
}

export const rankAt = (plan: PlanConfig, i: number): Rank =>
  plan.ranks[Math.max(0, Math.min(i, plan.ranks.length - 1))];

export interface ExposureLine {
  label: string;
  pctBp: BasisPoints | null; // null means "no ceiling"
  note?: string;
}

/**
 * Worst-case payout per 100 BV sold, used by the admin console and by
 * assertSustainable below.
 *
 * GAP contributes nothing extra because differential team income is carved out
 * of the top self rate rather than added on top of it.
 */
export function payoutExposure(plan: PlanConfig): { lines: ExposureLine[]; totalBp: BasisPoints | null } {
  const lines: ExposureLine[] = [];
  const topSelf = Math.max(...plan.ranks.map((r) => r.selfPctBp));
  const topTeam = Math.max(...plan.ranks.map((r) => r.teamPctBp));

  if (plan.self.enabled) lines.push({ label: 'Self income at the highest rank', pctBp: topSelf });
  if (plan.direct.enabled) {
    lines.push({
      label: 'Direct joining income',
      pctBp: plan.direct.pctBp,
      note: plan.direct.basis === 'FIRST_PURCHASE' ? 'first order only' : plan.direct.basis === 'EVERY_PURCHASE' ? 'every order' : 'on wallet recharge',
    });
  }
  if (plan.team.enabled) {
    if (plan.team.mode === 'GAP') lines.push({ label: 'Team income (gap)', pctBp: 0, note: 'carved out of the self rate above' });
    else if (plan.team.mode === 'DIRECT_ONLY') lines.push({ label: 'Team income (sponsor only)', pctBp: topTeam });
    else if (plan.team.depth > 0) lines.push({ label: `Team income (flat, ${plan.team.depth} levels)`, pctBp: topTeam * plan.team.depth });
    else lines.push({ label: 'Team income (flat, unlimited)', pctBp: null, note: 'grows with every generation' });
  }
  if (plan.generation.enabled) {
    lines.push({ label: 'Generation bonus', pctBp: plan.generation.levelsBp.reduce((a, b) => a + b, 0) });
  }
  const royaltyBp = plan.royalty.funds.reduce((a, f) => a + f.poolPctBp, 0);
  lines.push({ label: 'Royalty and lifestyle pools', pctBp: royaltyBp });

  const totalBp = lines.some((l) => l.pctBp === null)
    ? null
    : lines.reduce((a, l) => a + (l.pctBp ?? 0), 0);
  return { lines, totalBp };
}

export class PlanUnsustainableError extends Error {}

/**
 * Last line of defence before a plan version is written.
 *
 * A cosmetics catalogue cannot fund much past ~60% of BV from product margin.
 * Unlimited flat levels have no ceiling at all, so they need an explicit
 * acknowledgement rather than a silent save.
 */
export function assertSustainable(plan: PlanConfig, opts: { acceptUnlimited?: boolean; ceilingBp?: number } = {}): void {
  const ceiling = opts.ceilingBp ?? percentToBp(60);
  const { totalBp } = payoutExposure(plan);

  if (totalBp === null) {
    if (!opts.acceptUnlimited) {
      throw new PlanUnsustainableError(
        'Flat team income with no depth limit has no payout ceiling. Set a level limit, or confirm you want it unlimited.',
      );
    }
    return;
  }
  if (totalBp > ceiling) {
    throw new PlanUnsustainableError(
      `This plan commits ${totalBp / 100}% of BV to commission, above the ${ceiling / 100}% ceiling. Lower a rate or raise the ceiling deliberately.`,
    );
  }
}

export function parsePlan(raw: unknown): PlanConfig {
  return PlanConfigSchema.parse(raw);
}
