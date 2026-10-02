import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickNudges } from '../member/team-dashboard.service';
import { findIncomeClaims } from '../common/income-claims';

const NOW = new Date('2026-10-15T10:00:00Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const d = (over: Partial<Parameters<typeof pickNudges>[0][number]> & { id: string }) => ({
  name: over.id, code: `MC-${over.id}`, status: 'ACTIVE', joinedAt: days(60),
  monthBvCenti: 0, orders: 3, lastOrderAt: days(40), ...over,
});
const TARGET = 50_000; // 500 BV, in centi

test('someone on or over target is left alone', () => {
  assert.deepEqual(pickNudges([d({ id: 'a', monthBvCenti: TARGET }), d({ id: 'b', monthBvCenti: TARGET + 1 })], TARGET, NOW, new Set()), []);
});

test('the three reasons, closest to the line first, then lapsed, then never started', () => {
  const out = pickNudges([
    d({ id: 'never', orders: 0, lastOrderAt: null }),
    d({ id: 'lapsed', monthBvCenti: 0 }),
    d({ id: 'far', monthBvCenti: 10_000 }),
    d({ id: 'near', monthBvCenti: 45_000 }),
  ], TARGET, NOW, new Set());
  assert.deepEqual(out.map((n) => [n.id, n.reason]), [
    ['near', 'BELOW_TARGET'], ['far', 'BELOW_TARGET'], ['lapsed', 'NO_ORDER_THIS_MONTH'], ['never', 'NEVER_ORDERED'],
  ]);
  assert.equal(out[0].gapBvCenti, 5_000);
});

test('a brand-new member is given two days before being listed as never ordered', () => {
  const fresh = d({ id: 'fresh', orders: 0, lastOrderAt: null, joinedAt: days(1) });
  const older = d({ id: 'older', orders: 0, lastOrderAt: null, joinedAt: days(3) });
  assert.deepEqual(pickNudges([fresh, older], TARGET, NOW, new Set()).map((n) => n.id), ['older']);
});

test('inactive members are never listed', () => {
  assert.deepEqual(pickNudges([d({ id: 'x', status: 'BLOCKED' })], TARGET, NOW, new Set()), []);
});

test('with no monthly target in the plan only the lapsed and never-started are listed', () => {
  const out = pickNudges([d({ id: 'low', monthBvCenti: 100 }), d({ id: 'zero', monthBvCenti: 0 })], null, NOW, new Set());
  assert.deepEqual(out.map((n) => n.id), ['zero']);
});

test('someone nudged recently is still listed but marked, so the screen can say so', () => {
  const out = pickNudges([d({ id: 'a' })], TARGET, NOW, new Set(['a']));
  assert.equal(out[0].nudgedRecently, true);
});

test('the reminder wording carries no earnings claim', () => {
  const samples = [
    'Hi Asha, Priya here. Your first order is waiting for you on Majestic Cart.',
    'Hi Asha, Priya here. You have not ordered this month yet. Your monthly purchase is still open.',
    'Hi Asha, Priya here. You are close to your monthly purchase target this month. 120 BV to go.',
  ];
  for (const s of samples) assert.deepEqual(findIncomeClaims(s), [], s);
});
