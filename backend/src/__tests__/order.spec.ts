import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceOrder, assertJoiningMinimum, normaliseCart, PriceableItem } from '../order/pricing';
import { financialYear } from '../order/order.service';
import { rupeesToPaise, bvToCenti, formatInr } from '../common/money';
import { CLIENT_DEFAULT_PLAN, PlanConfig } from '../plan/plan.config';

const item = (over: Partial<PriceableItem> = {}): PriceableItem => ({
  productId: 'p1',
  name: 'Rose Gold Body Lotion',
  pricePaise: rupeesToPaise(599),
  mrpPaise: rupeesToPaise(699),
  bvCenti: bvToCenti(300),
  gstBp: 1800,
  quantity: 1,
  ...over,
});

/* --------------------------------------------------------------- pricing */

test('a single line prices correctly with GST extracted from the shelf price', () => {
  const t = priceOrder([item()]);
  assert.equal(t.totalPaise, rupeesToPaise(599));
  assert.equal(t.gstPaise, rupeesToPaise('91.37')); // 599 x 18/118
  assert.equal(t.subtotalPaise, rupeesToPaise('507.63'));
  assert.equal(t.subtotalPaise + t.gstPaise, t.totalPaise); // must always hold
  assert.equal(t.discountPaise, rupeesToPaise(100));
  assert.equal(t.totalBvCenti, bvToCenti(300));
});

test('quantity multiplies price, BV and discount together', () => {
  const t = priceOrder([item({ quantity: 3 })]);
  assert.equal(t.totalPaise, rupeesToPaise(1797));
  assert.equal(t.totalBvCenti, bvToCenti(900));
  assert.equal(t.discountPaise, rupeesToPaise(300));
});

test('GST is computed per line, not blended over the cart', () => {
  // Hair oil sits at 5%, cosmetics at 18%. A single blended rate would be wrong.
  const t = priceOrder([
    item({ productId: 'oil', pricePaise: rupeesToPaise(379), mrpPaise: rupeesToPaise(449), gstBp: 500, bvCenti: bvToCenti(190) }),
    item({ productId: 'lotion', pricePaise: rupeesToPaise(599), mrpPaise: rupeesToPaise(699), gstBp: 1800, bvCenti: bvToCenti(300) }),
  ]);
  // Both floor, consistently with every other money calculation: 379 x 5/105
  // is 18.047, which becomes 18.04 and not 18.05. Per-line tax is kept exact to
  // the paise here; rounding the invoice total to the nearest rupee for GST
  // filing is the invoice module's job, not the ledger's.
  const oilGst = rupeesToPaise('18.04');
  const lotionGst = rupeesToPaise('91.37'); // 599 x 18/118
  assert.equal(t.gstPaise, oilGst + lotionGst);
  assert.equal(t.totalPaise, rupeesToPaise(978));
  assert.equal(t.totalBvCenti, bvToCenti(490));
});

test('subtotal plus GST always reconciles to the total', () => {
  for (let price = 1; price <= 400; price++) {
    for (const gstBp of [0, 500, 1200, 1800, 2800]) {
      const t = priceOrder([item({ pricePaise: rupeesToPaise(price), mrpPaise: rupeesToPaise(price), gstBp, quantity: (price % 4) + 1 })]);
      assert.equal(t.subtotalPaise + t.gstPaise, t.totalPaise);
    }
  }
});

test('an empty bag is refused', () => {
  assert.throws(() => priceOrder([]), /bag is empty/);
});

test('a fractional or zero quantity is refused', () => {
  assert.throws(() => priceOrder([item({ quantity: 0 })]), /whole number/);
  assert.throws(() => priceOrder([item({ quantity: 1.5 })]), /whole number/);
});

/* ----------------------------------------------------------- cart hygiene */

test('duplicate lines merge instead of fighting each other for stock', () => {
  const cart = normaliseCart([
    { productId: 'b', quantity: 1 },
    { productId: 'a', quantity: 2 },
    { productId: 'b', quantity: 3 },
  ]);
  assert.deepEqual(cart, [
    { productId: 'a', quantity: 2 },
    { productId: 'b', quantity: 4 },
  ]);
});

test('the cart comes back sorted by product id — that is the lock order', () => {
  const cart = normaliseCart([
    { productId: 'zeta', quantity: 1 },
    { productId: 'alpha', quantity: 1 },
    { productId: 'mid', quantity: 1 },
  ]);
  assert.deepEqual(cart.map((l) => l.productId), ['alpha', 'mid', 'zeta']);
});

test('junk carts are rejected before they reach the database', () => {
  assert.throws(() => normaliseCart([]), /bag is empty/);
  assert.throws(() => normaliseCart([{ productId: '', quantity: 1 }]), /invalid/);
  assert.throws(() => normaliseCart([{ productId: 'a', quantity: -2 }]), /whole numbers/);
  assert.throws(() => normaliseCart([{ productId: 'a', quantity: 500 }]), /at most 99 units/);
  assert.throws(() => normaliseCart([{ productId: 'a', quantity: 60 }, { productId: 'a', quantity: 60 }]), /at most 99 units/);
});

/* ---------------------------------------------------------- joining gate */

test('a first order below the 2000 BV minimum is refused with the shortfall named', () => {
  const small = priceOrder([item({ bvCenti: bvToCenti(300) })]);
  assert.throws(
    () => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, small),
    /first order needs to be at least 2000 BV.*has 300 BV/s,
  );
});

test('a first order meeting the minimum passes', () => {
  const big = priceOrder([item({ bvCenti: bvToCenti(800), quantity: 3 })]); // 2400 BV
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, big));
});

test('the minimum applies to the first order only, never to repeat orders', () => {
  const small = priceOrder([item({ bvCenti: bvToCenti(120) })]);
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, false, small));
});

test('free joining lets a first order be any size', () => {
  const free: PlanConfig = { ...CLIENT_DEFAULT_PLAN, joining: { mode: 'FREE', minFirstPurchase: 0, unit: 'BV' } };
  const tiny = priceOrder([item({ bvCenti: bvToCenti(10) })]);
  assert.doesNotThrow(() => assertJoiningMinimum(free, true, tiny));
});

test('the minimum can be set in rupees instead of BV', () => {
  const inRupees: PlanConfig = {
    ...CLIENT_DEFAULT_PLAN,
    joining: { mode: 'MIN_FIRST_PURCHASE', minFirstPurchase: Number(rupeesToPaise(2000)), unit: 'INR' },
  };
  const under = priceOrder([item({ pricePaise: rupeesToPaise(599) })]);
  const over = priceOrder([item({ pricePaise: rupeesToPaise(599), quantity: 4 })]);
  assert.throws(() => assertJoiningMinimum(inRupees, true, under), /at least ₹2,000/);
  assert.doesNotThrow(() => assertJoiningMinimum(inRupees, true, over));
});

/* -------------------------------------------------------- financial year */

test('the Indian financial year runs April to March', () => {
  assert.equal(financialYear(new Date('2026-09-12')), '2026-27');
  assert.equal(financialYear(new Date('2026-04-01')), '2026-27'); // first day
  assert.equal(financialYear(new Date('2026-03-31')), '2025-26'); // last day
  assert.equal(financialYear(new Date('2027-01-15')), '2026-27');
});

/* ------------------------------------------------------------- end to end */

test('a realistic first order produces the figures the member is shown', () => {
  const totals = priceOrder([
    item({ productId: 'oud', name: 'Oud Royale', pricePaise: rupeesToPaise(1599), mrpPaise: rupeesToPaise(1899), bvCenti: bvToCenti(800), quantity: 2 }),
    item({ productId: 'serum', name: 'Vitamin C Serum', pricePaise: rupeesToPaise(799), mrpPaise: rupeesToPaise(999), bvCenti: bvToCenti(400), quantity: 1 }),
  ]);

  assert.equal(formatInr(totals.totalPaise), '₹3,997');
  assert.equal(formatInr(totals.mrpTotalPaise), '₹4,797');
  assert.equal(formatInr(totals.discountPaise), '₹800');
  assert.equal(totals.totalBvCenti, bvToCenti(2000));
  assert.equal(totals.subtotalPaise + totals.gstPaise, totals.totalPaise);

  // Exactly on the 2000 BV joining line — must pass, not fail by a rounding hair.
  assert.doesNotThrow(() => assertJoiningMinimum(CLIENT_DEFAULT_PLAN, true, totals));
});
