import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickReminders, type SnapshotRow } from '../order/cart-reminder.service';

const NOW = new Date('2026-10-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const row = (over: Partial<SnapshotRow> & { memberId: string }): SnapshotRow => ({
  count: 2, firstName: 'Asha', updatedAt: hoursAgo(5), remindedAt: null, ...over,
});
const pick = (rows: SnapshotRow[], ordered: string[] = [], recent: string[] = []) =>
  pickReminders(rows, NOW, new Set(ordered), new Set(recent)).map((r) => r.memberId);

test('a bag left for a few hours is reminded about', () => {
  assert.deepEqual(pick([row({ memberId: 'a' })]), ['a']);
});

test('a bag still being changed is left alone', () => {
  assert.deepEqual(pick([row({ memberId: 'a', updatedAt: hoursAgo(1) })]), []);
});

test('a bag older than three days is not worth bringing up', () => {
  assert.deepEqual(pick([row({ memberId: 'a', updatedAt: hoursAgo(24 * 4) })]), []);
});

test('an empty bag, or one the member has ordered from since, gets nothing', () => {
  assert.deepEqual(pick([row({ memberId: 'a', count: 0 }), row({ memberId: 'b' })], ['b']), []);
});

test('the same bag is mentioned once, but a changed bag can be mentioned again', () => {
  assert.deepEqual(pick([row({ memberId: 'a', remindedAt: hoursAgo(2) })]), [], 'reminded after this version of the bag');
  assert.deepEqual(pick([row({ memberId: 'a', updatedAt: hoursAgo(5), remindedAt: hoursAgo(30) })]), ['a'], 'the bag changed after the last reminder');
});

test('nobody is reminded more than once in three days', () => {
  assert.deepEqual(pick([row({ memberId: 'a' })], [], ['a']), []);
});
