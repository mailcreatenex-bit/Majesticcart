import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFunnel } from '../analytics/analytics.service';

test('each step reports sessions, the share that carried on, the share of all visitors, and who was lost', () => {
  const f = buildFunnel({ visit: 1000, view_product: 600, add_to_bag: 120, view_cart: 90, begin_checkout: 60, order_placed: 30 });
  assert.deepEqual(f.map((s) => s.sessions), [1000, 600, 120, 90, 60, 30]);
  assert.equal(f[1].fromPreviousPct, 60);
  assert.equal(f[2].fromPreviousPct, 20);
  assert.equal(f[5].fromVisitPct, 3);
  assert.equal(f[2].lost, 480);
  assert.equal(f[0].lost, 0);
});

test('an empty period gives zeroes, not NaN or a divide by zero', () => {
  const f = buildFunnel({});
  for (const s of f) {
    assert.equal(s.sessions, 0);
    assert.equal(s.fromVisitPct, 0);
    assert.ok(Number.isFinite(s.fromPreviousPct));
  }
});

test('a step with more sessions than the one before it never reports a negative loss', () => {
  // Possible when a shopper lands straight on a product page from a shared link, with no recorded visit event.
  const f = buildFunnel({ visit: 10, view_product: 12 });
  assert.equal(f[1].lost, 0);
});
