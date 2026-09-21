import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDIAN_STATES, stateCodeFor } from '@/lib/states';
import { parseRupeeInput } from '@/lib/money';
import { newRequestId } from '@/lib/api';
import {
  addLine, setQuantity, removeLine, clearCart, totals, checkoutLines,
  checkoutBlock, rechargeSuggestion, readCart, writeCart,
  EMPTY_CART, CART_STORAGE_KEY, MAX_QUANTITY, MAX_LINES,
  type Cart, type StorageLike,
} from '@/lib/cart';

const line = (id: string, over: Partial<{ pricePaise: number; mrpPaise: number; bvCenti: number; quantity: number }> = {}) => ({
  productId: id,
  slug: `slug-${id}`,
  quantity: over.quantity ?? 1,
  snapshot: {
    name: `Product ${id}`,
    pricePaise: over.pricePaise ?? 59900,
    mrpPaise: over.mrpPaise ?? 69900,
    bvCenti: over.bvCenti ?? 30000,
  },
});

const fakeStorage = (seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => ({
  data: { ...seed },
  getItem(k) { return this.data[k] ?? null; },
  setItem(k, v) { this.data[k] = v; },
});

/* ------------------------------------------------------------ mutations */

test('adding the same product twice increases quantity rather than adding a line', () => {
  // Two lines for one product makes the subtotal look wrong even when it is
  // not, and the member has to fix it by hand.
  let cart = addLine(EMPTY_CART, line('p1'));
  cart = addLine(cart, line('p1'));

  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 2);
});

test('quantity is capped rather than rejected', () => {
  const cart = addLine(EMPTY_CART, { ...line('p1'), quantity: 5000 });
  assert.equal(cart.lines[0].quantity, MAX_QUANTITY);
});

test('setting a quantity to zero removes the line', () => {
  // What the minus button means at a quantity of one.
  const cart = setQuantity(addLine(EMPTY_CART, line('p1')), 'p1', 0);
  assert.equal(cart.lines.length, 0);
});

test('the bag stops accepting new products at the cap', () => {
  let cart: Cart = EMPTY_CART;
  for (let i = 0; i < MAX_LINES + 5; i += 1) cart = addLine(cart, line(`p${i}`));
  assert.equal(cart.lines.length, MAX_LINES);
});

test('removing a product that is not in the bag changes nothing', () => {
  const cart = addLine(EMPTY_CART, line('p1'));
  assert.equal(removeLine(cart, 'nope'), cart, 'should return the same object, not a copy');
});

/* --------------------------------------------------------------- totals */

test('totals are integer paise', () => {
  let cart = addLine(EMPTY_CART, line('p1', { pricePaise: 59900, mrpPaise: 69900, bvCenti: 30000 }));
  cart = addLine(cart, { ...line('p2', { pricePaise: 44900, mrpPaise: 54900, bvCenti: 22000 }), quantity: 3 });

  const t = totals(cart);
  assert.equal(t.subtotalPaise, 59900 + 44900 * 3);
  assert.equal(t.mrpTotalPaise, 69900 + 54900 * 3);
  assert.equal(t.savingsPaise, t.mrpTotalPaise - t.subtotalPaise);
  assert.equal(t.bvCenti, 30000 + 22000 * 3);
  assert.equal(t.itemCount, 4);
  assert.equal(t.lineCount, 2);
  assert.ok(Number.isInteger(t.subtotalPaise));
});

test('a price above MRP never produces a negative saving', () => {
  // A data error in the catalogue should not render as "you saved -₹100".
  const cart = addLine(EMPTY_CART, line('p1', { pricePaise: 70000, mrpPaise: 50000 }));
  assert.equal(totals(cart).savingsPaise, 0);
});

test('checkout sends ids and quantities, never prices', () => {
  // The cart cannot be allowed to name its own price. This is the assertion
  // that says so out loud.
  const cart = addLine(EMPTY_CART, { ...line('p1'), quantity: 2 });
  const payload = checkoutLines(cart);

  assert.deepEqual(payload, [{ productId: 'p1', quantity: 2 }]);
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes('59900'), 'no price may appear in the checkout payload');
  assert.ok(!serialised.includes('pricePaise'));
  assert.ok(!serialised.includes('snapshot'));
});

/* -------------------------------------------------------- wallet gating */

test('an empty bag cannot be checked out', () => {
  assert.deepEqual(
    checkoutBlock({ cart: EMPTY_CART, shoppingBalancePaise: 1_000_00, hasAddress: true }),
    { kind: 'empty' },
  );
});

test('no delivery address blocks checkout before the balance is even considered', () => {
  const cart = addLine(EMPTY_CART, line('p1'));
  assert.deepEqual(
    checkoutBlock({ cart, shoppingBalancePaise: 0, hasAddress: false }),
    { kind: 'address' },
  );
});

test('a balance short of the total blocks checkout and reports the shortfall', () => {
  // The rule the whole site is built on: no card, no COD. Pay from the wallet
  // or the order does not happen.
  const cart = addLine(EMPTY_CART, line('p1', { pricePaise: 59900 }));
  const block = checkoutBlock({ cart, shoppingBalancePaise: 20000, hasAddress: true });

  assert.deepEqual(block, { kind: 'insufficient', shortfallPaise: 39900 });
});

test('the quoted total wins over the cart subtotal', () => {
  // GST depends on the delivery state, so the server's quote is higher than
  // the cart's own arithmetic. Gating on the subtotal would let an order
  // through that the wallet cannot actually cover.
  const cart = addLine(EMPTY_CART, line('p1', { pricePaise: 100000 }));

  assert.equal(
    checkoutBlock({ cart, shoppingBalancePaise: 100000, hasAddress: true }),
    null,
    'covers the subtotal exactly',
  );
  assert.deepEqual(
    checkoutBlock({ cart, shoppingBalancePaise: 100000, payablePaise: 118000, hasAddress: true }),
    { kind: 'insufficient', shortfallPaise: 18000 },
    'but not the quoted total with GST',
  );
});

test('exact balance is enough', () => {
  const cart = addLine(EMPTY_CART, line('p1', { pricePaise: 59900 }));
  assert.equal(checkoutBlock({ cart, shoppingBalancePaise: 59900, hasAddress: true }), null);
});

test('the recharge suggestion rounds up to a whole rupee', () => {
  // A recharge one paisa short of the order total is the most annoying
  // possible failure, and nobody types paise into a UPI app.
  assert.equal(rechargeSuggestion(23950), 24000);
  assert.equal(rechargeSuggestion(24000), 24000);
  assert.equal(rechargeSuggestion(1), 100);
  assert.equal(rechargeSuggestion(0), 0);
  assert.equal(rechargeSuggestion(-500), 0);
});

/* -------------------------------------------------------------- storage */

test('a bag survives a round trip through storage', () => {
  const storage = fakeStorage();
  const cart = addLine(EMPTY_CART, { ...line('p1'), quantity: 3 });

  writeCart(storage, cart);
  const restored = readCart(storage);

  assert.equal(restored.lines.length, 1);
  assert.equal(restored.lines[0].quantity, 3);
  assert.equal(restored.lines[0].snapshot.pricePaise, 59900);
});

test('corrupt or tampered storage degrades to an empty bag', () => {
  for (const bad of ['not json', '{"lines":"nope"}', 'null', '[]', '{}']) {
    assert.deepEqual(readCart(fakeStorage({ [CART_STORAGE_KEY]: bad })), EMPTY_CART);
  }
});

test('a line with an edited price is dropped, not repaired', () => {
  // Storage is editable by the member. A repaired price is a wrong price shown
  // confidently; dropping the row is the safe failure.
  const tampered = JSON.stringify({
    lines: [
      { productId: 'p1', slug: 'a', quantity: 1, snapshot: { name: 'A', pricePaise: 1.5, mrpPaise: 100, bvCenti: 0 } },
      { productId: 'p2', slug: 'b', quantity: 1, snapshot: { name: 'B', pricePaise: -5000, mrpPaise: 100, bvCenti: 0 } },
      { productId: 'p3', slug: 'c', quantity: 1, snapshot: { name: 'C', pricePaise: 44900, mrpPaise: 54900, bvCenti: 100 } },
    ],
    updatedAt: 1,
  });

  const cart = readCart(fakeStorage({ [CART_STORAGE_KEY]: tampered }));
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].productId, 'p3');
});

test('duplicate product ids in storage collapse to one line', () => {
  const dupes = JSON.stringify({
    lines: [
      { productId: 'p1', slug: 'a', quantity: 2, snapshot: { name: 'A', pricePaise: 1000, mrpPaise: 1000, bvCenti: 0 } },
      { productId: 'p1', slug: 'a', quantity: 9, snapshot: { name: 'A', pricePaise: 1000, mrpPaise: 1000, bvCenti: 0 } },
    ],
    updatedAt: 1,
  });

  const cart = readCart(fakeStorage({ [CART_STORAGE_KEY]: dupes }));
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 2, 'the first wins');
});

test('blocked storage never throws', () => {
  // Safari private mode throws on both read and write.
  const throwing: StorageLike = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.doesNotThrow(() => readCart(throwing));
  assert.deepEqual(readCart(throwing), EMPTY_CART);
  assert.doesNotThrow(() => writeCart(throwing, addLine(EMPTY_CART, line('p1'))));
  assert.doesNotThrow(() => readCart(null));
});

test('clearing produces an empty bag with a fresh timestamp', () => {
  const cleared = clearCart(12345);
  assert.deepEqual(cleared.lines, []);
  assert.equal(cleared.updatedAt, 12345);
});

/* ------------------------------------------------------------- GST states */

/**
 * The checkout's state list against the backend's.
 *
 * The delivery state decides CGST+SGST versus IGST. A name the backend cannot
 * resolve falls back to inter-state, so a state offered in the form but spelled
 * differently from the backend's table would quietly tax every order in that
 * state the wrong way — with a correct-looking invoice.
 */
test('every state offered at checkout resolves in the backend table', () => {
  const backend = readFileSync(
    join(process.cwd(), '..', 'backend', 'src', 'common', 'gst-state.ts'),
    'utf8',
  );
  const block = /export const STATE_CODES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(backend);
  assert.ok(block, 'backend STATE_CODES table not found');

  const backendCodes = new Map<string, string>();
  for (const [, name, code] of block![1].matchAll(/'([^']+)':\s*'(\d{2})'/g)) {
    backendCodes.set(name, code);
  }

  assert.equal(
    INDIAN_STATES.length, backendCodes.size,
    'the form offers a different number of states than the backend recognises',
  );

  for (const s of INDIAN_STATES) {
    // Matching the backend's own normalisation: lowercase, punctuation out.
    const key = s.name.trim().toLowerCase().replace(/[^a-z\s&]/g, '').replace(/\s+/g, ' ');
    assert.ok(
      backendCodes.has(key),
      `"${s.name}" is offered at checkout but the backend cannot resolve it — orders there would be taxed as inter-state`,
    );
    assert.equal(backendCodes.get(key), s.code, `${s.name} has code ${s.code} here and ${backendCodes.get(key)} in the backend`);
  }
});

test('state lookup is case-insensitive', () => {
  assert.equal(stateCodeFor('west bengal'), '19');
  assert.equal(stateCodeFor('West Bengal'), '19');
  assert.equal(stateCodeFor('  WEST BENGAL '), '19');
  assert.equal(stateCodeFor('Nowhere'), null);
});

/* ------------------------------------------------------- amount parsing */

test('typed rupee amounts become exact integer paise', () => {
  // The float route (Number(x) * 100) lands a paisa off on some of these, and
  // on a wallet that funds every order the member eventually notices.
  const cases: [string, number][] = [
    ['100', 10000],
    ['100.10', 10010],
    ['100.1', 10010],
    ['100.05', 10005],
    ['0.01', 1],
    ['1.15', 115],
    ['8.29', 829],
    ['1099.99', 109999],
    ['.5', 50],
    ['500.', 50000],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseRupeeInput(input), expected, `"${input}"`);
  }
});

test('more than two decimals truncates rather than rounds up', () => {
  // Crediting a paisa the member did not pay is the wrong direction to err in.
  assert.equal(parseRupeeInput('100.999'), 10099);
  assert.equal(parseRupeeInput('1.005'), 100);
});

test('unparseable amounts are zero, not a plausible guess', () => {
  for (const bad of ['', '   ', '.', 'abc', '1.2.3', '-5', '1e3', '₹100', '100,00', 'NaN', 'Infinity']) {
    assert.equal(parseRupeeInput(bad), 0, `"${bad}" must not parse`);
  }
});

/* ------------------------------------------------- double-submit safety */

/**
 * Checkout's duplicate protection.
 *
 * This is the one write path where the client supplies the dedupe key. The API
 * reads `requestId` off the checkout **body** and derives its ledger
 * idempotency key from it; there is no `Idempotency-Key` header interceptor, so
 * sending one looks like protection and provides none.
 *
 * That mistake has no symptom until a member on bad mobile data taps Pay twice
 * and is charged twice, so it is asserted rather than remembered.
 */
test('the checkout request carries a requestId in the body, not a header', () => {
  const raw = readFileSync(join(process.cwd(), 'components', 'CheckoutView.tsx'), 'utf8');

  // Comments stripped FIRST. The comment above this call says the word
  // "requestId", so asserting against the raw source passes even when the
  // field itself has been deleted — which is exactly how this test first
  // failed to catch the bug it was written for.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const post = /api<[^>]*>\('\/orders',\s*\{([\s\S]*?)\n      \}\)/.exec(src);
  assert.ok(post, 'could not find the POST /orders call in CheckoutView');

  const bodyLine = /body:\s*\{[^}]*\}/.exec(post![1]);
  assert.ok(bodyLine, 'the POST /orders call has no body object');
  assert.match(
    bodyLine![0], /requestId/,
    'the checkout body must carry requestId — without it a double-tapped Pay button places two orders',
  );

  // And must not rely on a header that nothing reads.
  assert.ok(
    !/idempotencyKey/.test(src),
    'CheckoutView must not pass an idempotencyKey: no interceptor reads that header',
  );
});

test('newRequestId produces a v4 UUID the server will accept', () => {
  // The server validates it with z.string().uuid(). A fallback that produced
  // something merely random-looking would be rejected at the one moment it is
  // needed — an insecure context, where crypto.randomUUID is unavailable.
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  // globalThis.crypto is getter-only in Node, so the fallback is forced with
  // defineProperty rather than assignment.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    for (let i = 0; i < 200; i += 1) {
      const id = newRequestId();
      assert.match(id, V4, `fallback produced a non-v4 id: ${id}`);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }

  // And the real path, where it is available.
  assert.match(newRequestId(), V4);
});

test('no component reaches for an idempotency header', () => {
  // The three other write paths dedupe server-side. A generic header helper
  // would get reached for on all of them and quietly do nothing, so there is
  // deliberately no such helper — this asserts nobody reintroduced one.
  for (const file of [
    'lib/api.ts',
    'components/RechargeView.tsx',
    'components/WithdrawView.tsx',
    'components/admin/RechargeQueue.tsx',
  ]) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    // Matches the header being *set* or a helper being *called* — not the
    // comment in lib/api.ts that explains why neither exists.
    assert.ok(
      !/['"]Idempotency-Key['"]\s*:/.test(src),
      `${file} sets an Idempotency-Key header, which this API does not read`,
    );
    assert.ok(
      !/newIdempotencyKey\s*\(/.test(src),
      `${file} calls newIdempotencyKey, which no longer exists for good reason`,
    );
  }
});
