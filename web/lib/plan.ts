/**
 * The compensation plan, as the admin console sees it.
 *
 * A mirror of `backend/src/plan/plan.config.ts`. The server validates with zod
 * and is the authority; this exists so the editor can render the right control
 * for each field and explain what it does.
 *
 * Two units that must not be confused, and are the reason the editor never
 * stores a float:
 *
 *   • **basis points (bp)** for percentages. 15% is 1500. The plan document the
 *     client wrote says "15%", the API says 1500, and the editor converts at
 *     the input boundary — once, in `pctToBp`/`bpToPct`.
 *   • **centi-BV** for business volume. 1000 BV is 100000. Half a BV has to be
 *     representable, and a float would make 0.1 BV land somewhere near it.
 */

export type RankBasis = 'GROUP_BV' | 'TEAM_BV';
export type TeamMode = 'GAP' | 'FLAT' | 'DIRECT_ONLY';
export type DirectBasis = 'FIRST_PURCHASE' | 'EVERY_PURCHASE' | 'WALLET_RECHARGE';
export type JoinMode = 'FREE' | 'MIN_FIRST_PURCHASE';
export type QualifyMode = 'RANK_COUNT' | 'BV_TARGET';
export type PayoutCycle = 'INSTANT' | 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';

export interface Rank {
  name: string;
  minBvCenti: number;
  selfPctBp: number;
  teamPctBp: number;
}

export interface RoyaltyFund {
  key: string;
  name: string;
  poolPctBp: number;
  qualifyMode: QualifyMode;
  minRankIndex: number;
  minCount: number;
  targetBvCenti: number;
}

export interface PlanConfig {
  rankBasis: RankBasis;
  ranks: Rank[];
  joining: { mode: JoinMode; minFirstPurchase: number; unit: 'BV' | 'INR' };
  self: { enabled: boolean };
  direct: { enabled: boolean; pctBp: number; basis: DirectBasis };
  team: { enabled: boolean; mode: TeamMode; depth: number };
  generation: { enabled: boolean; minRankIndex: number; onlyQualified: boolean; levelsBp: number[] };
  repurchase: { enabled: boolean; monthlyBvCenti: number; blocksWithdrawal: boolean };
  withdrawal: { minPaise: string; deductionBp: number; cycle: PayoutCycle };
  royalty: { funds: RoyaltyFund[] };
}

export interface ExposureLine {
  label: string;
  pctBp: number | null;
  note?: string;
}

/* ----------------------------------------------------------- conversions */

/** "15" or "15.5" → 1500 or 1550. Integer basis points, never a float. */
export function pctToBp(input: string | number): number {
  const text = String(input).trim();
  if (!text || !/^\d*\.?\d*$/.test(text)) return 0;
  const [whole = '', frac = ''] = text.split('.');
  // Two decimal places of a percent is one basis point, which is the finest
  // the plan expresses. Truncated rather than rounded up — erring towards
  // paying less than a typo asked for.
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

export const bpToPct = (bp: number): string => {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
};

/** "1000" or "1000.5" → 100000 or 100050 centi-BV. */
export function bvToCenti(input: string | number): number {
  const text = String(input).trim();
  if (!text || !/^\d*\.?\d*$/.test(text)) return 0;
  const [whole = '', frac = ''] = text.split('.');
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

export const centiToBv = (centi: number): string => {
  const whole = Math.trunc(centi / 100);
  const frac = Math.abs(centi % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
};

/* ------------------------------------------------------------- the modes */

/**
 * What each mode actually does, in the words an operator would use.
 *
 * Every one of these exists because the client's own plan document was
 * ambiguous about it. Rather than guessing, each ambiguity became a setting —
 * so the answer can be changed later without a deploy, and so the choice is
 * visible rather than buried in code.
 *
 * `warning` is set where a mode carries legal risk. It is rendered next to the
 * option, not hidden behind a tooltip.
 */
export const MODE_COPY = {
  rankBasis: {
    GROUP_BV: {
      label: 'Group BV (self + team)',
      detail: 'Rank is measured on everything below a member including their own purchases.',
    },
    TEAM_BV: {
      label: 'Team BV (team only)',
      detail: 'A member’s own purchases do not count towards their rank. Harder to reach, and harder to game by self-buying.',
    },
  },

  teamMode: {
    GAP: {
      label: 'Differential (gap)',
      detail: 'Each upline earns the difference between their rate and the highest rate already paid below them. Self-funding: the total never exceeds the top rank’s rate.',
    },
    FLAT: {
      label: 'Flat percentage',
      detail: 'Every qualifying upline earns the same percentage, to the depth set below. Simple to explain, and the cost grows with every level you add.',
    },
    DIRECT_ONLY: {
      label: 'Direct sponsor only',
      detail: 'Only the immediate sponsor earns team income. The cheapest option, and the weakest incentive to build depth.',
    },
  },

  directBasis: {
    FIRST_PURCHASE: {
      label: 'On their first purchase',
      detail: 'Paid once, when a newly sponsored member first buys products. This is the default and the safest reading of the plan document.',
    },
    EVERY_PURCHASE: {
      label: 'On every purchase',
      detail: 'Paid each time a directly sponsored member orders. More generous, and it keeps paying on product sales.',
    },
    WALLET_RECHARGE: {
      label: 'On wallet top-ups',
      detail: 'Paid when a sponsored member adds money to their wallet, before they have bought anything.',
      warning:
        'This pays commission on deposits rather than on product sales, which is the money-circulation pattern the Consumer Protection (Direct Selling) Rules 2021 are written to catch. Take legal advice before turning it on.',
    },
  },

  joinMode: {
    FREE: {
      label: 'Free to join',
      detail: 'No purchase required to become a member. Required by the Direct Selling Rules — a joining fee is what makes a scheme a scheme.',
    },
    MIN_FIRST_PURCHASE: {
      label: 'Minimum first purchase',
      detail: 'Registration stays free, but a member must buy at least this much before they can earn. Modelled as a product purchase, never as a fee.',
    },
  },

  qualifyMode: {
    RANK_COUNT: {
      label: 'By number of ranked legs',
      detail: 'Qualify by having at least N members at or above a given rank below you.',
    },
    BV_TARGET: {
      label: 'By business volume',
      detail: 'Qualify by reaching a BV target in the period.',
    },
  },

  payoutCycle: {
    INSTANT: { label: 'Immediately', detail: 'Credited to the income wallet as each order is delivered.' },
    WEEKLY: { label: 'Weekly', detail: 'Accumulated and released once a week.' },
    FORTNIGHTLY: { label: 'Fortnightly', detail: 'Accumulated and released every two weeks.' },
    MONTHLY: { label: 'Monthly', detail: 'Accumulated and released once a month.' },
  },
} as const;

/* ------------------------------------------------------------ validation */

export interface PlanIssue {
  path: string;
  message: string;
}

/**
 * The checks worth running as the admin types.
 *
 * Not a reimplementation of the server's validation — the server is the
 * authority and will refuse a bad plan regardless. These are the ones where
 * waiting for a round trip means the admin has already moved on to the next
 * field and lost the connection between what they typed and what broke.
 */
export function localIssues(plan: PlanConfig): PlanIssue[] {
  const issues: PlanIssue[] = [];

  if (plan.ranks.length === 0) {
    issues.push({ path: 'ranks', message: 'There must be at least one rank.' });
  }

  // Everyone needs a rank from the moment they join, so the ladder has to start
  // at zero. Otherwise a new member matches nothing and has no rate at all.
  if (plan.ranks[0] && plan.ranks[0].minBvCenti !== 0) {
    issues.push({ path: 'ranks.0.minBvCenti', message: 'The first rank must start at 0 BV so every member has a rank.' });
  }

  plan.ranks.forEach((rank, i) => {
    if (!rank.name.trim()) {
      issues.push({ path: `ranks.${i}.name`, message: 'Every rank needs a name.' });
    }
    if (i > 0 && rank.minBvCenti <= plan.ranks[i - 1].minBvCenti) {
      issues.push({
        path: `ranks.${i}.minBvCenti`,
        message: `${rank.name || `Rank ${i + 1}`} must require more BV than ${plan.ranks[i - 1].name || `rank ${i}`}.`,
      });
    }
    // A lower rank paying more than a higher one inverts the whole incentive,
    // and in GAP mode it also makes the differential negative.
    if (i > 0 && rank.selfPctBp < plan.ranks[i - 1].selfPctBp) {
      issues.push({
        path: `ranks.${i}.selfPctBp`,
        message: `${rank.name || `Rank ${i + 1}`} pays less than the rank below it.`,
      });
    }
  });

  if (plan.team.enabled && plan.team.mode === 'FLAT' && plan.team.depth === 0) {
    issues.push({
      path: 'team.depth',
      message: 'Unlimited depth on a flat percentage has no ceiling — every level added multiplies the cost. Set a depth, or use the differential mode.',
    });
  }

  if (plan.generation.enabled && plan.generation.levelsBp.length === 0) {
    issues.push({ path: 'generation.levelsBp', message: 'Add at least one generation level, or turn the bonus off.' });
  }

  return issues;
}

/**
 * Worst-case payout per 100 BV sold, computed the same way the server does.
 *
 * Shown live as the admin edits, because the alternative is discovering the
 * number only when publishing is refused — by which point they have made
 * several changes and do not know which one caused it.
 *
 * GAP contributes nothing extra: differential team income is carved out of the
 * top self rate rather than added on top of it. That single line is the whole
 * reason the differential mode is affordable and the flat mode is not.
 */
export function exposureBp(plan: PlanConfig): { lines: ExposureLine[]; totalBp: number | null } {
  const lines: ExposureLine[] = [];
  const topSelf = plan.ranks.reduce((max, r) => Math.max(max, r.selfPctBp), 0);

  if (plan.self.enabled) {
    lines.push({ label: 'Self purchase income', pctBp: topSelf, note: 'At the highest rank' });
  }

  if (plan.direct.enabled) {
    lines.push({ label: 'Direct income', pctBp: plan.direct.pctBp });
  }

  if (plan.team.enabled) {
    if (plan.team.mode === 'GAP') {
      lines.push({
        label: 'Team income (differential)',
        pctBp: 0,
        note: 'Carved out of the self rate above, so it adds nothing to the total',
      });
    } else {
      const perLevel = plan.ranks.reduce((max, r) => Math.max(max, r.teamPctBp), 0);
      const depth = plan.team.mode === 'DIRECT_ONLY' ? 1 : plan.team.depth;
      lines.push({
        label: `Team income (flat${depth ? `, ${depth} levels` : ', unlimited'})`,
        // Unlimited depth has no computable ceiling, which is the point.
        pctBp: depth === 0 ? null : perLevel * depth,
        note: depth === 0 ? 'Unlimited depth has no ceiling' : undefined,
      });
    }
  }

  if (plan.generation.enabled) {
    lines.push({
      label: `Generation bonus (${plan.generation.levelsBp.length} levels)`,
      pctBp: plan.generation.levelsBp.reduce((sum, bp) => sum + bp, 0),
    });
  }

  for (const fund of plan.royalty.funds) {
    lines.push({ label: fund.name, pctBp: fund.poolPctBp });
  }

  const unbounded = lines.some((l) => l.pctBp === null);
  const totalBp = unbounded ? null : lines.reduce((sum, l) => sum + (l.pctBp ?? 0), 0);

  return { lines, totalBp };
}

/** The ceiling `assertSustainable` enforces on the server: 60% of BV. */
export const SUSTAINABLE_CEILING_BP = 6000;
