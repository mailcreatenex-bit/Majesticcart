import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile, parseDefinition, ReportDefinitionSchema, ReportDefinition, Caller, MAX_ROWS } from '../reporting/compiler';
import { CATALOG, describeCatalog, getDataset } from '../reporting/catalog';
import { ALL_PRESETS, validatePresets, PRESET_GROUPS } from '../reporting/presets';

const ADMIN: Caller = { type: 'ADMIN', id: 'admin1', role: 'ADMIN' };
const MEMBER: Caller = {
  type: 'MEMBER',
  id: 'mem1',
  memberId: 'ckmem1',
  ancestorPath: '/company/priya/',
};

const def = (over: Partial<ReportDefinition> = {}): ReportDefinition =>
  parseDefinition({
    key: 'test_report',
    name: 'Test report',
    dataset: 'orders',
    dimensions: ['placedAt'],
    bucket: 'month',
    measures: ['revenue', 'orderCount'],
    filters: [],
    limit: 100,
    chartType: 'line',
    audience: ['ADMIN'],
    scope: 'GLOBAL',
    ...over,
  });

/* ---------------------------------------------------------- the basics */

test('a simple report compiles to grouped, parameterised SQL', () => {
  const q = compile(def(), ADMIN);
  assert.match(q.sql, /^SELECT /);
  assert.match(q.sql, /date_trunc\('month'/);
  assert.match(q.sql, /FROM "Order" o JOIN "Member" m/);
  assert.match(q.sql, /GROUP BY/);
  assert.match(q.sql, /LIMIT 100/);
  assert.deepEqual(q.columns.map((c) => c.key), ['placedAt', 'revenue', 'orderCount']);
  assert.equal(q.columns[1].type, 'money');
});

test('the dataset base filter is always applied', () => {
  // Cancelled orders must never silently inflate revenue.
  assert.match(compile(def(), ADMIN).sql, /o\.status <> 'CANCELLED'/);
});

test('the row limit is clamped to the hard ceiling', () => {
  assert.throws(() => def({ limit: 999_999 }), /less than or equal to 5000|too_big/);
  assert.match(compile(def({ limit: MAX_ROWS }), ADMIN).sql, new RegExp(`LIMIT ${MAX_ROWS}`));
});

/* ------------------------------------------------------------ injection */

test('a filter value never reaches the SQL text — it is always a bound parameter', () => {
  const nasty = "'; DROP TABLE \"Member\"; --";
  const q = compile(def({ filters: [{ dimension: 'city', op: 'eq', value: nasty }] }), ADMIN);

  assert.equal(q.sql.includes('DROP TABLE'), false);
  assert.equal(q.sql.includes(nasty), false);
  assert.match(q.sql, /o\."shipCity" = \$1/);
  assert.deepEqual(q.params, [nasty]);
});

test('a contains filter builds its wildcards around the parameter, not inside the SQL', () => {
  const q = compile(def({ filters: [{ dimension: 'city', op: 'contains', value: "%' OR 1=1 --" }] }), ADMIN);
  assert.equal(q.sql.includes('OR 1=1'), false);
  assert.match(q.sql, /ILIKE \$1/);
  assert.equal(q.params[0], "%%' OR 1=1 --%");
});

test('an unknown dimension, measure or dataset is rejected at parse time', () => {
  assert.throws(() => def({ dimensions: ['(SELECT passwordHash FROM "Member")'] }), /is not a dimension/);
  assert.throws(() => def({ measures: ['revenue, m."passwordHash"'] }), /is not a measure/);
  assert.throws(() => def({ dataset: 'pg_catalog.pg_user' }), /Unknown dataset/);
});

test('an unknown filter operator is rejected', () => {
  assert.throws(
    () => def({ filters: [{ dimension: 'city', op: 'RAW_SQL' as never, value: '1=1' }] }),
    /invalid|Invalid|enum/,
  );
});

test('a bucket value outside the whitelist is rejected', () => {
  assert.throws(() => def({ bucket: "month'); DROP TABLE x; --" as never }), /invalid|Invalid|enum/);
});

test('a report key cannot carry anything but lowercase, digits and underscores', () => {
  assert.throws(() => def({ key: 'bad key"; --' }), /lowercase letters/);
});

test('every parameter placeholder in the SQL has a matching bound value', () => {
  const q = compile(
    def({
      filters: [
        { dimension: 'city', op: 'in', value: ['Kolkata', 'Siliguri', 'Patna'] },
        { dimension: 'placedAt', op: 'between', value: ['2026-01-01', '2026-09-30'] },
        { dimension: 'state', op: 'neq', value: 'Goa' },
      ],
    }),
    ADMIN,
  );
  const placeholders = [...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(placeholders).size, q.params.length);
  assert.equal(Math.max(...placeholders), q.params.length);
  assert.equal(q.params.length, 6);
});

/* -------------------------------------------------------------- scoping */

test('a member caller is confined to their downline even when the definition says GLOBAL', () => {
  // This is the attack: save a definition claiming GLOBAL, then open it as a
  // member and read the whole company's orders.
  const sneaky = def({ audience: ['ADMIN', 'MEMBER'], scope: 'GLOBAL' });
  const q = compile(sneaky, MEMBER);

  assert.equal(q.scopeApplied, 'OWN_DOWNLINE');
  assert.match(q.sql, /"ancestorPath" LIKE \$\d+/);
  assert.ok(q.params.includes('/company/priya/ckmem1/%'));
});

test('the downline prefix ends in a slash so one member cannot match another', () => {
  const q = compile(def({ audience: ['MEMBER'], scope: 'OWN_DOWNLINE' }), MEMBER);
  const prefix = q.params.find((p) => typeof p === 'string' && p.endsWith('/%')) as string;
  // Without the trailing slash, "ckmem1" would also match "ckmem12".
  assert.equal(prefix, '/company/priya/ckmem1/%');
  assert.equal(prefix.includes('ckmem1/'), true);
});

test('OWN_ROWS narrows to the member themselves, not their team', () => {
  const q = compile(def({ audience: ['MEMBER'], scope: 'OWN_ROWS' }), MEMBER);
  assert.equal(q.scopeApplied, 'OWN_ROWS');
  assert.match(q.sql, /m\.id = \$\d+/);
  assert.equal(q.sql.includes('ancestorPath'), false);
});

test('a member cannot open a report that is not published to members', () => {
  assert.throws(() => compile(def({ audience: ['ADMIN'] }), MEMBER), /not available to members/);
});

test('a dataset with no member scoping can never be published to members', () => {
  // Security alerts name other members and describe fraud signals.
  assert.equal(getDataset('alerts')!.scoping, undefined);
  assert.throws(
    () => def({ dataset: 'alerts', dimensions: ['severity'], measures: ['alertCount'], bucket: undefined, audience: ['MEMBER'] }),
    /cannot be shown to members/,
  );
});

test('a member caller with no genealogy context is refused rather than run unscoped', () => {
  const broken: Caller = { type: 'MEMBER', id: 'x', memberId: 'ckmem1' }; // no ancestorPath
  assert.throws(() => compile(def({ audience: ['MEMBER'] }), broken), /refusing to run an unscoped query/);
});

test('an admin report stays company-wide', () => {
  const q = compile(def(), ADMIN);
  assert.equal(q.scopeApplied, 'GLOBAL');
  assert.equal(q.sql.includes('ancestorPath'), false);
});

/* --------------------------------------------------------------- filters */

test('filter operators render the expected SQL', () => {
  const cases: [string, unknown, RegExp][] = [
    ['eq', 'Kolkata', /= \$1/],
    ['neq', 'Kolkata', /<> \$1/],
    ['gt', 'A', /> \$1/],
    ['gte', 'A', />= \$1/],
    ['lt', 'Z', /< \$1/],
    ['lte', 'Z', /<= \$1/],
    ['in', ['A', 'B'], /IN \(\$1, \$2\)/],
    ['notIn', ['A', 'B'], /NOT IN \(\$1, \$2\)/],
    ['between', ['A', 'B'], /BETWEEN \$1 AND \$2/],
    ['isNull', undefined, /IS NULL/],
    ['notNull', undefined, /IS NOT NULL/],
  ];
  for (const [op, value, pattern] of cases) {
    const q = compile(def({ filters: [{ dimension: 'city', op: op as never, value: value as never }] }), ADMIN);
    assert.match(q.sql, pattern, `operator ${op}`);
  }
});

test('operators that need a value are rejected without one', () => {
  assert.throws(() => def({ filters: [{ dimension: 'city', op: 'eq' }] }), /needs a value/);
  assert.throws(() => def({ filters: [{ dimension: 'city', op: 'in', value: [] }] }), /non-empty list/);
  assert.throws(() => def({ filters: [{ dimension: 'placedAt', op: 'between', value: ['only-one'] }] }), /exactly two/);
});

test('a boolean-valued enum dimension is coerced to a real boolean', () => {
  const q = compile(def({ filters: [{ dimension: 'isFirstPurchase', op: 'eq', value: 'true' }] }), ADMIN);
  assert.equal(q.params[0], true);
  assert.notEqual(q.params[0], 'true');
});

test('a date filter is bound as a Date, and an unparseable one is refused', () => {
  const q = compile(def({ filters: [{ dimension: 'placedAt', op: 'gte', value: '2026-04-01' }] }), ADMIN);
  assert.ok(q.params[0] instanceof Date);
  assert.throws(() => compile(def({ filters: [{ dimension: 'placedAt', op: 'gte', value: 'last tuesday' }] }), ADMIN), /not a valid date/);
});

/* ---------------------------------------------------------------- sorting */

test('sorting is restricted to catalog fields', () => {
  const q = compile(def({ sort: { field: 'revenue', direction: 'desc' } }), ADMIN);
  assert.match(q.sql, /ORDER BY "revenue" DESC/);
  assert.throws(() => def({ sort: { field: '(SELECT 1)', direction: 'asc' } }), /neither a dimension nor/);
});

test('a bucket without a date dimension is refused', () => {
  assert.throws(() => def({ dimensions: ['state'], bucket: 'month' }), /needs a date dimension/);
});

/* ---------------------------------------------------------------- presets */

test('every shipped preset is valid against the catalog', () => {
  assert.doesNotThrow(() => validatePresets());
  assert.ok(ALL_PRESETS.length >= 30, `expected 30+ presets, found ${ALL_PRESETS.length}`);
});

test('every preset compiles for an admin', () => {
  const onBehalfOf = { memberId: 'ckmem1', ancestorPath: '/company/priya/' };
  for (const preset of ALL_PRESETS) {
    const memberOnly = preset.audience.every((a) => a === 'MEMBER');
    const caller: Caller = memberOnly ? { ...ADMIN, onBehalfOf } : ADMIN;
    assert.doesNotThrow(() => compile(preset, caller), `preset ${preset.key} failed to compile`);
  }
});

test('an admin must name a member before opening a member report', () => {
  const memberReport = def({ audience: ['MEMBER'], scope: 'OWN_ROWS' });
  // Without a subject this would return company-wide figures under a heading
  // that says "my income" — a wrong number in a disputed conversation.
  assert.throws(() => compile(memberReport, ADMIN), /Choose which member/);

  const q = compile(memberReport, { ...ADMIN, onBehalfOf: { memberId: 'ckmem9', ancestorPath: '/company/' } });
  assert.equal(q.scopeApplied, 'OWN_ROWS');
  assert.ok(q.params.includes('ckmem9'));
});

test('impersonation cannot widen a member report past that member', () => {
  const teamReport = def({ audience: ['MEMBER'], scope: 'GLOBAL' }); // mislabelled on purpose
  const q = compile(teamReport, { ...ADMIN, onBehalfOf: { memberId: 'ckmem9', ancestorPath: '/company/' } });
  assert.equal(q.scopeApplied, 'OWN_DOWNLINE');
  assert.ok(q.params.includes('/company/ckmem9/%'));
});

test('a staff report still respects role restrictions', () => {
  const financeOnly = def({ audience: ['FINANCE'] });
  assert.throws(() => compile(financeOnly, { type: 'ADMIN', id: 'a', role: 'SUPPORT' }), /role does not have access/);
  assert.doesNotThrow(() => compile(financeOnly, { type: 'ADMIN', id: 'a', role: 'FINANCE' }));
});

test('every member-facing preset compiles scoped, and no admin preset is member-visible', () => {
  for (const preset of ALL_PRESETS) {
    if (preset.audience.includes('MEMBER')) {
      const q = compile(preset, MEMBER);
      assert.notEqual(q.scopeApplied, 'GLOBAL', `${preset.key} ran unscoped for a member`);
      assert.ok(q.params.length > 0, `${preset.key} bound no scope parameter`);
    } else {
      assert.throws(() => compile(preset, MEMBER), `${preset.key} should be closed to members`);
    }
  }
});

test('preset keys are unique', () => {
  const keys = ALL_PRESETS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('presets cover every reporting area', () => {
  assert.deepEqual(PRESET_GROUPS.map((g) => g.key), ['finance', 'compliance', 'growth', 'operations', 'member']);
  for (const group of PRESET_GROUPS) assert.ok(group.reports.length >= 4, `${group.key} is thin`);
});

/* ---------------------------------------------------------------- catalog */

test('the catalog exposed to the UI carries no SQL', () => {
  const described = JSON.stringify(describeCatalog());
  for (const needle of ['SELECT', 'FROM', 'JOIN', 'passwordHash', '"Member"', 'SUM(']) {
    assert.equal(described.includes(needle), false, `catalog leaked "${needle}" to the client`);
  }
});

test('no dataset exposes a credential or secret column', () => {
  const forbidden = ['passwordHash', 'totpSecret', 'codeHash', 'tokenHash', 'payoutAccount', 'salt'];
  for (const ds of Object.values(CATALOG)) {
    const sql = [ds.from, ds.baseWhere ?? '', ...Object.values(ds.dimensions).map((d) => d.sql), ...Object.values(ds.measures).map((m) => m.sql)].join(' ');
    for (const secret of forbidden) {
      assert.equal(sql.includes(secret), false, `${ds.key} exposes ${secret}`);
    }
  }
});

test('every dataset that claims member scoping actually binds both parameters', () => {
  for (const ds of Object.values(CATALOG)) {
    if (!ds.scoping) continue;
    assert.match(ds.scoping.ownRows, /\$memberId/, `${ds.key} ownRows has no member binding`);
    assert.match(ds.scoping.downline, /\$pathPrefix/, `${ds.key} downline has no prefix binding`);
  }
});
