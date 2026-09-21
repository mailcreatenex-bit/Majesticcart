import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLIENT_DEFAULT_PLAN, payoutExposure, assertSustainable, PlanConfigSchema,
  type PlanConfig,
} from '../plan/plan.config';
import { percentToBp } from '../common/money';
import {
  exposureBp, localIssues, pctToBp, bpToPct, bvToCenti, centiToBv,
  SUSTAINABLE_CEILING_BP,
  type PlanConfig as WebPlanConfig,
} from '../../../web/lib/plan';

/**
 * The admin console's exposure calculation against this one.
 *
 * The console shows the payout ceiling live as the admin edits, which is the
 * number that decides whether publishing will be refused. If the two
 * calculations disagree, the editor tells the admin a plan is fine and then the
 * save fails — or worse, tells them it is over the ceiling when it is not, and
 * they lower a rate that did not need lowering.
 *
 * The console's copy is dependency-free on purpose, so it can be imported
 * straight into this suite rather than reimplemented in it.
 */

const variants: { name: string; plan: PlanConfig }[] = [
  { name: 'the client default', plan: CLIENT_DEFAULT_PLAN },
  {
    name: 'flat team income, 5 levels',
    plan: { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: 'FLAT', depth: 5 } },
  },
  {
    name: 'flat team income, unlimited depth',
    plan: { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: 'FLAT', depth: 0 } },
  },
  {
    name: 'direct sponsor only',
    plan: { ...CLIENT_DEFAULT_PLAN, team: { enabled: true, mode: 'DIRECT_ONLY', depth: 1 } },
  },
  {
    name: 'team income off',
    plan: { ...CLIENT_DEFAULT_PLAN, team: { enabled: false, mode: 'GAP', depth: 0 } },
  },
  {
    name: 'no generation bonus',
    plan: {
      ...CLIENT_DEFAULT_PLAN,
      generation: { ...CLIENT_DEFAULT_PLAN.generation, enabled: false },
    },
  },
  {
    name: 'no royalty funds',
    plan: { ...CLIENT_DEFAULT_PLAN, royalty: { funds: [] } },
  },
  {
    name: 'self income off',
    plan: { ...CLIENT_DEFAULT_PLAN, self: { enabled: false } },
  },
];

for (const { name, plan } of variants) {
  test(`exposure agrees with the console for ${name}`, () => {
    const server = payoutExposure(plan);
    const client = exposureBp(plan as unknown as WebPlanConfig);

    assert.equal(
      client.totalBp, server.totalBp,
      `the console would show ${client.totalBp} and the server enforces ${server.totalBp}`,
    );
  });
}

test('the console agrees with the server about what is publishable', () => {
  // The important half: the editor must not say "fine" about a plan the save
  // will refuse, nor warn about one it would accept.
  for (const { name, plan } of variants) {
    const { totalBp } = exposureBp(plan as unknown as WebPlanConfig);
    const consoleSaysOk = totalBp !== null && totalBp <= SUSTAINABLE_CEILING_BP;

    let serverAccepts = true;
    try {
      assertSustainable(plan);
    } catch {
      serverAccepts = false;
    }

    assert.equal(consoleSaysOk, serverAccepts, `disagreement on: ${name}`);
  }
});

test('the ceiling the console draws is the one the server enforces', () => {
  assert.equal(SUSTAINABLE_CEILING_BP, percentToBp(60));
});

/* ------------------------------------------------------- unit conversion */

test('percent and BV conversions are exact integers', () => {
  // Both the console and the plan document speak in percentages and BV, while
  // everything stored is basis points and centi-BV. A float in this conversion
  // is how 19% becomes 1899.
  for (const [input, bp] of [['10', 1000], ['15', 1500], ['19', 1900], ['22', 2200], ['25', 2500],
                             ['0.5', 50], ['2.5', 250], ['0.01', 1], ['100', 10000]] as const) {
    assert.equal(pctToBp(input), bp, `${input}% should be ${bp}bp`);
    assert.ok(Number.isInteger(pctToBp(input)));
  }

  for (const [input, centi] of [['0', 0], ['1000', 100000], ['5000', 500000],
                                ['500', 50000], ['0.5', 50], ['40000', 4000000]] as const) {
    assert.equal(bvToCenti(input), centi, `${input} BV should be ${centi} centi`);
  }
});

test('conversions round-trip the values the client document actually uses', () => {
  for (const pct of ['10', '15', '19', '22', '25', '5', '2', '1']) {
    assert.equal(bpToPct(pctToBp(pct)), pct);
  }
  for (const bv of ['0', '1000', '5000', '15000', '40000', '500']) {
    assert.equal(centiToBv(bvToCenti(bv)), bv);
  }
});

test('unparseable input is zero rather than a plausible guess', () => {
  for (const bad of ['', '  ', 'abc', '1.2.3', '-5', '1e3', '15%']) {
    assert.equal(pctToBp(bad), 0, `"${bad}"`);
    assert.equal(bvToCenti(bad), 0, `"${bad}"`);
  }
});

/* ------------------------------------------------------- local validation */

test('the console rejects a ladder the server would also reject', () => {
  // The first rank must start at 0 BV or a new member matches no rank at all
  // and has no rate. The server enforces it in superRefine; the console has to
  // catch it as the admin types, or they lose the connection between the field
  // they edited and the error.
  const bad: WebPlanConfig = {
    ...(CLIENT_DEFAULT_PLAN as unknown as WebPlanConfig),
    ranks: [
      { name: 'Star', minBvCenti: 100000, selfPctBp: 1000, teamPctBp: 500 },
      { name: 'Bronze', minBvCenti: 500000, selfPctBp: 1500, teamPctBp: 500 },
    ],
  };
  const issues = localIssues(bad);
  assert.ok(issues.some((i) => i.path === 'ranks.0.minBvCenti'), 'must flag a ladder not starting at 0');

  // And the server refuses the same plan.
  assert.throws(() => PlanConfigSchema.parse(bad));
});

test('the console flags a rank ladder that goes backwards', () => {
  const bad: WebPlanConfig = {
    ...(CLIENT_DEFAULT_PLAN as unknown as WebPlanConfig),
    ranks: [
      { name: 'Star', minBvCenti: 0, selfPctBp: 1000, teamPctBp: 500 },
      { name: 'Bronze', minBvCenti: 100000, selfPctBp: 900, teamPctBp: 500 },
    ],
  };
  const issues = localIssues(bad);
  assert.ok(
    issues.some((i) => i.path === 'ranks.1.selfPctBp'),
    'a lower rank paying more than a higher one inverts the incentive and makes the GAP differential negative',
  );
});

test('the console warns about unlimited flat depth, as the server refuses it', () => {
  const unlimited: WebPlanConfig = {
    ...(CLIENT_DEFAULT_PLAN as unknown as WebPlanConfig),
    team: { enabled: true, mode: 'FLAT', depth: 0 },
  };
  assert.ok(localIssues(unlimited).some((i) => i.path === 'team.depth'));
  assert.throws(() => assertSustainable(unlimited as unknown as PlanConfig));
});

test('the client default plan is publishable', () => {
  // The whole point: the plan the client actually specified must pass.
  assert.deepEqual(localIssues(CLIENT_DEFAULT_PLAN as unknown as WebPlanConfig), []);
  assert.doesNotThrow(() => assertSustainable(CLIENT_DEFAULT_PLAN));
});
