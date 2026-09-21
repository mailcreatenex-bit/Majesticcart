import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rupeesToPaise, paiseToRupeeString, formatInr, bvToCenti, centiToBvString,
  percentToBp, commissionOn, pctOfPaise, gstInclusiveComponent, splitPool, sumPaise,
} from '../common/money';
import {
  CLIENT_DEFAULT_PLAN, PlanConfigSchema, parsePlan, payoutExposure,
  assertSustainable, PlanUnsustainableError, rankIndexFor, PlanConfig,
} from '../plan/plan.config';
import { CommissionService } from '../commission/commission.service';
import type { Member } from '@prisma/client';

/* ------------------------------------------------------------------ money */

test('rupees convert to paise without float drift', () => {
  assert.equal(rupeesToPaise('599.50'), 59950n);
  assert.equal(rupeesToPaise('0.01'), 1n);
  assert.equal(rupeesToPaise(1599), 159900n);
  assert.equal(paiseToRupeeString(59950n), '599.50');
  assert.throws(() => rupeesToPaise('10.999'), /at most 2 decimals/);
});

test('the 0.1 + 0.2 problem does not exist on the ledger', () => {
  const a = rupeesToPaise('0.1');
  const b = rupeesToPaise('0.2');
  assert.equal(a + b, rupeesToPaise('0.3'));
  assert.notEqual(0.1 + 0.2, 0.3); // the float version this replaces
});

test('rupees format with Indian digit grouping', () => {
  assert.equal(formatInr(10_000_000n), '₹1,00,000');
  assert.equal(formatInr(59950n), '₹599.50');
  assert.equal(formatInr(0n), '₹0');
});

test('BV converts to centi-BV', () => {
  assert.equal(bvToCenti(300), 30_000);
  assert.equal(bvToCenti('2.5'), 250);
  assert.equal(centiToBvString(30_000), '300');
  assert.equal(centiToBvString(250), '2.50');
});

test('commission is exact and rounds down, returning the dust', () => {
  // 300 BV at 19% is 57 BV, and 1 BV is treated as 1 rupee.
  assert.equal(commissionOn(bvToCenti(300), percentToBp(19)).amountPaise, rupeesToPaise(57));
  // 800 BV at 2% generation bonus is 16 rupees.
  assert.equal(commissionOn(bvToCenti(800), percentToBp(2)).amountPaise, rupeesToPaise(16));

  const dusty = commissionOn(7, 3); // 7 * 3 / 10000 -> 0 with remainder 21
  assert.equal(dusty.amountPaise, 0n);
  assert.equal(dusty.remainderPaise, 21n);
});

test('rounding never invents money', () => {
  for (let bv = 1; bv <= 500; bv++) {
    const { amountPaise, remainderPaise } = commissionOn(bv, 1900);
    assert.equal(amountPaise * 10_000n + remainderPaise, BigInt(bv) * 1900n);
  }
});

test('withdrawal deduction matches the plan', () => {
  // 10% of 1000 rupees is 100, leaving 900 net.
  const { amountPaise } = pctOfPaise(rupeesToPaise(1000), percentToBp(10));
  assert.equal(amountPaise, rupeesToPaise(100));
  assert.equal(rupeesToPaise(1000) - amountPaise, rupeesToPaise(900));
});

test('GST is extracted from a tax-inclusive price', () => {
  // 599 inclusive of 18% carries 91.37 of tax.
  assert.equal(gstInclusiveComponent(rupeesToPaise(599), percentToBp(18)), rupeesToPaise('91.37'));
});

test('a royalty pool splits without losing a paise', () => {
  const pool = 100_00n; // 100 rupees between 3 members
  const { perHead, extras } = splitPool(pool, 3);
  const shares = Array.from({ length: 3 }, (_, i) => perHead + (i < extras ? 1n : 0n));
  assert.equal(sumPaise(shares), pool);
  assert.equal(shares[0] - shares[2], 1n); // dust goes to the first, deterministically
  assert.throws(() => splitPool(pool, 0), /between nobody/);
});

/* ------------------------------------------------------------------- plan */

test("the client's plan document validates", () => {
  const plan = parsePlan(CLIENT_DEFAULT_PLAN);
  assert.equal(plan.ranks.length, 5);
  assert.equal(plan.ranks[4].name, 'Diamond');
  assert.equal(plan.ranks[4].selfPctBp, 2500);
  assert.equal(plan.joining.minFirstPurchase, bvToCenti(2000));
});

test('members land in the right rank band', () => {
  const p = CLIENT_DEFAULT_PLAN;
  assert.equal(rankIndexFor(p, bvToCenti(0)), 0); // Star
  assert.equal(rankIndexFor(p, bvToCenti(999)), 0);
  assert.equal(rankIndexFor(p, bvToCenti(1000)), 1); // Bronze, exactly on the line
  assert.equal(rankIndexFor(p, bvToCenti(14_999)), 2); // Silver
  assert.equal(rankIndexFor(p, bvToCenti(40_000)), 4); // Diamond
  assert.equal(rankIndexFor(p, bvToCenti(999_999)), 4);
});

test('the default plan commits 45% of BV and is sustainable', () => {
  const { totalBp } = payoutExposure(CLIENT_DEFAULT_PLAN);
  // 25 self + 10 direct + 0 team (gap is carved out of self) + 5 generation + 5 royalty
  assert.equal(totalBp, percentToBp(45));
  assert.doesNotThrow(() => assertSustainable(CLIENT_DEFAULT_PLAN));
});

test('unlimited flat team income is refused without an explicit acknowledgement', () => {
  const reckless: PlanConfig = {
    ...CLIENT_DEFAULT_PLAN,
    team: { enabled: true, mode: 'FLAT', depth: 0 },
  };
  assert.equal(payoutExposure(reckless).totalBp, null);
  assert.throws(() => assertSustainable(reckless), PlanUnsustainableError);
  assert.doesNotThrow(() => assertSustainable(reckless, { acceptUnlimited: true }));
});

test('a plan over the payout ceiling is refused', () => {
  const greedy: PlanConfig = {
    ...CLIENT_DEFAULT_PLAN,
    team: { enabled: true, mode: 'FLAT', depth: 8 }, // 5% x 8 levels = 40% on top
  };
  assert.throws(() => assertSustainable(greedy), /commits 85% of BV/);
});

test('a rank ladder that does not start at zero is rejected', () => {
  const broken = { ...CLIENT_DEFAULT_PLAN, ranks: CLIENT_DEFAULT_PLAN.ranks.slice(1) };
  const result = PlanConfigSchema.safeParse(broken);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /first rank must start at 0 BV/);
});

test('out-of-order rank targets are rejected', () => {
  const jumbled = {
    ...CLIENT_DEFAULT_PLAN,
    ranks: [
      CLIENT_DEFAULT_PLAN.ranks[0],
      { ...CLIENT_DEFAULT_PLAN.ranks[1], minBvCenti: bvToCenti(90_000) },
      CLIENT_DEFAULT_PLAN.ranks[2],
    ],
  };
  assert.equal(PlanConfigSchema.safeParse(jumbled).success, false);
});

test('a 500% commission typo cannot be saved', () => {
  const typo = { ...CLIENT_DEFAULT_PLAN, direct: { enabled: true, pctBp: percentToBp(500), basis: 'FIRST_PURCHASE' } };
  assert.equal(PlanConfigSchema.safeParse(typo).success, false);
});

/* -------------------------------------------------------------- genealogy */

const svc = new CommissionService(null as any, null as any);

let seq = 0;
function member(over: Partial<Member> = {}): Member {
  const id = over.id ?? `m${++seq}`;
  return {
    id, memberCode: id.toUpperCase(), name: id, phone: '9000000000', email: null,
    status: 'ACTIVE', isCompany: false, sponsorId: null, ancestorPath: '/', depth: 0,
    rankIndex: 0, selfBvCenti: 0n, groupBvCenti: 0n,
    payoutUpi: null, payoutHolder: null, payoutBank: null, payoutAccount: null, payoutIfsc: null,
    lastDeviceId: null, joinedAt: new Date(), updatedAt: new Date(),
    ...over,
  } as Member;
}
const run = (plan: PlanConfig, buyer: Member, chain: Member[], bv = 800, isFirst = false) =>
  svc.computePayouts({ plan, buyer, chain, bvCenti: bvToCenti(bv), isFirstPurchase: isFirst, orderNo: 'OD1' });
const totalBp = (payouts: { pctBp: number }[]) => payouts.reduce((a, p) => a + p.pctBp, 0);

test('gap mode: each upline earns only the difference above the best rate below', () => {
  const buyer = member({ id: 'buyer', rankIndex: 0 }); // Star 10%
  const gold = member({ id: 'gold', rankIndex: 3 }); // Gold 22%
  const dia1 = member({ id: 'dia1', rankIndex: 4 }); // Diamond 25%
  const dia2 = member({ id: 'dia2', rankIndex: 4 }); // Diamond, already capped out

  const payouts = run(CLIENT_DEFAULT_PLAN, buyer, [gold, dia1, dia2]);
  const team = payouts.filter((p) => p.type === 'TEAM');

  assert.equal(payouts.find((p) => p.type === 'SELF')!.pctBp, percentToBp(10));
  assert.equal(team.find((p) => p.memberId === 'gold')!.pctBp, percentToBp(12)); // 22 - 10
  assert.equal(team.find((p) => p.memberId === 'dia1')!.pctBp, percentToBp(3)); // 25 - 22
  assert.equal(team.find((p) => p.memberId === 'dia2'), undefined); // nothing left to give
});

test('gap mode never pays out more than the top rank rate, at any depth', () => {
  const top = percentToBp(25);
  const plan: PlanConfig = { ...CLIENT_DEFAULT_PLAN, direct: { ...CLIENT_DEFAULT_PLAN.direct, enabled: false }, generation: { ...CLIENT_DEFAULT_PLAN.generation, enabled: false } };
  for (let trial = 0; trial < 200; trial++) {
    const buyer = member({ rankIndex: Math.floor(Math.random() * 5) });
    const chain = Array.from({ length: Math.floor(Math.random() * 15) }, () =>
      member({ rankIndex: Math.floor(Math.random() * 5) }),
    );
    assert.ok(totalBp(run(plan, buyer, chain)) <= top, 'gap mode leaked past the top rank rate');
  }
});

test('generation bonus reaches the first three qualifying uplines only', () => {
  const buyer = member({ id: 'buyer' });
  const chain = [
    member({ id: 'star', rankIndex: 0 }),
    member({ id: 'd1', rankIndex: 4 }),
    member({ id: 'silver', rankIndex: 2 }),
    member({ id: 'd2', rankIndex: 4 }),
    member({ id: 'd3', rankIndex: 4 }),
    member({ id: 'd4', rankIndex: 4 }), // past the third generation
  ];
  const gens = run(CLIENT_DEFAULT_PLAN, buyer, chain).filter((p) => p.type === 'GENERATION');

  assert.deepEqual(gens.map((g) => g.memberId), ['d1', 'd2', 'd3']);
  assert.deepEqual(gens.map((g) => g.pctBp), [percentToBp(2), percentToBp(2), percentToBp(1)]);
  assert.deepEqual(gens.map((g) => g.generationLevel), [1, 2, 3]);
});

test('onlyQualified off: a non-qualifying upline burns its generation slot unpaid', () => {
  const plan: PlanConfig = { ...CLIENT_DEFAULT_PLAN, generation: { ...CLIENT_DEFAULT_PLAN.generation, onlyQualified: false } };
  const chain = [member({ id: 'star', rankIndex: 0 }), member({ id: 'd1', rankIndex: 4 })];
  const gens = run(plan, member(), chain).filter((p) => p.type === 'GENERATION');

  assert.deepEqual(gens.map((g) => g.memberId), ['d1']);
  assert.equal(gens[0].generationLevel, 2); // slot 1 was consumed by the Star
});

test('direct income on first purchase only, when the plan says so', () => {
  const sponsor = member({ id: 'sponsor', rankIndex: 2 });
  const repeat = run(CLIENT_DEFAULT_PLAN, member(), [sponsor], 800, false);
  const first = run(CLIENT_DEFAULT_PLAN, member(), [sponsor], 800, true);

  assert.equal(repeat.find((p) => p.type === 'DIRECT'), undefined);
  assert.equal(first.find((p) => p.type === 'DIRECT')!.pctBp, percentToBp(10));
});

test('every purchase basis pays the sponsor each time', () => {
  const plan: PlanConfig = { ...CLIENT_DEFAULT_PLAN, direct: { enabled: true, pctBp: percentToBp(10), basis: 'EVERY_PURCHASE' } };
  const payouts = run(plan, member(), [member({ id: 'sponsor' })], 800, false);
  assert.equal(payouts.find((p) => p.type === 'DIRECT')!.memberId, 'sponsor');
});

test('flat team mode pays every level down to the configured depth', () => {
  const plan: PlanConfig = { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: 'FLAT', depth: 2 } };
  const chain = [member({ id: 'u1' }), member({ id: 'u2' }), member({ id: 'u3' })];
  const team = run(plan, member(), chain).filter((p) => p.type === 'TEAM');

  assert.deepEqual(team.map((t) => t.memberId), ['u1', 'u2']); // u3 is past the depth limit
  assert.deepEqual(team.map((t) => t.pctBp), [percentToBp(5), percentToBp(5)]);
});

test('direct-only team mode pays the sponsor and nobody above', () => {
  const plan: PlanConfig = { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: 'DIRECT_ONLY', depth: 0 } };
  const team = run(plan, member(), [member({ id: 'u1' }), member({ id: 'u2', rankIndex: 4 })]).filter((p) => p.type === 'TEAM');
  assert.deepEqual(team.map((t) => t.memberId), ['u1']);
});

test('members on hold and the company account earn nothing', () => {
  const buyer = member({ id: 'buyer' });
  const chain = [
    member({ id: 'held', rankIndex: 4, status: 'ON_HOLD' }),
    member({ id: 'company', rankIndex: 4, isCompany: true }),
    member({ id: 'ok', rankIndex: 4 }),
  ];
  const ids = new Set(run(CLIENT_DEFAULT_PLAN, buyer, chain, 800, true).map((p) => p.memberId));

  assert.equal(ids.has('held'), false);
  assert.equal(ids.has('company'), false);
  assert.equal(ids.has('ok'), true);
});

test('an orphan buyer with no sponsor still earns self income and nothing breaks', () => {
  const payouts = run(CLIENT_DEFAULT_PLAN, member({ rankIndex: 4 }), [], 800, true);
  assert.equal(payouts.length, 1);
  assert.equal(payouts[0].type, 'SELF');
  assert.equal(payouts[0].pctBp, percentToBp(25));
});

test('switching off every component pays nobody', () => {
  const off: PlanConfig = {
    ...CLIENT_DEFAULT_PLAN,
    self: { enabled: false },
    direct: { ...CLIENT_DEFAULT_PLAN.direct, enabled: false },
    team: { ...CLIENT_DEFAULT_PLAN.team, enabled: false },
    generation: { ...CLIENT_DEFAULT_PLAN.generation, enabled: false },
  };
  assert.deepEqual(run(off, member(), [member({ rankIndex: 4 })], 800, true), []);
});

test('a real order pays the exact rupee amounts the plan promises', () => {
  const buyer = member({ id: 'buyer', rankIndex: 0 });
  const chain = [member({ id: 'gold', rankIndex: 3 }), member({ id: 'dia', rankIndex: 4 })];
  const payouts = run(CLIENT_DEFAULT_PLAN, buyer, chain, 800, true); // an 800 BV first order

  const byWho = Object.fromEntries(payouts.map((p) => [`${p.memberId}:${p.type}`, p.amountPaise]));
  assert.equal(byWho['buyer:SELF'], rupeesToPaise(80)); // 10% of 800
  assert.equal(byWho['gold:DIRECT'], rupeesToPaise(80)); // 10% of 800
  assert.equal(byWho['gold:TEAM'], rupeesToPaise(96)); // 12% gap
  assert.equal(byWho['dia:TEAM'], rupeesToPaise(24)); // 3% gap
  assert.equal(byWho['dia:GENERATION'], rupeesToPaise(16)); // 2% generation 1

  assert.equal(sumPaise(payouts.map((p) => p.amountPaise)), rupeesToPaise(296)); // 37% of 800
});
