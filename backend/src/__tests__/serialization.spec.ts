import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeBigInts, money, volume, percent, parseMoneyInput } from '../common/serialization';
import { rupeesToPaise, bvToCenti } from '../common/money';

test('a bigint in a response becomes a decimal string, not a number', () => {
  const out = serializeBigInts({ totalPaise: 59950n }) as Record<string, unknown>;
  assert.equal(out.totalPaise, '59950');
  assert.equal(typeof out.totalPaise, 'string');
});

test('the naive fix would have failed silently past 90 crore', () => {
  // Number(paise) is lossy well before bigint is, and loses quietly.
  const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
  assert.notEqual(Number(huge).toString(), huge.toString());
  assert.equal(serializeBigInts(huge), huge.toString()); // exact
});

test('JSON.stringify works on a serialized payload, and throws without it', () => {
  const payload = { order: { totalPaise: 59950n, items: [{ bv: 30000, pricePaise: 19990n }] } };
  assert.throws(() => JSON.stringify(payload), /BigInt/);
  assert.doesNotThrow(() => JSON.stringify(serializeBigInts(payload)));
});

test('dates, buffers, null and undefined survive intact', () => {
  const when = new Date('2026-09-12T10:00:00.000Z');
  const out = serializeBigInts({ when, blob: Buffer.from('hi'), nothing: null, missing: undefined }) as any;
  assert.equal(out.when, '2026-09-12T10:00:00.000Z');
  assert.equal(out.blob, Buffer.from('hi').toString('base64'));
  assert.equal(out.nothing, null);
  assert.equal(out.missing, undefined);
});

test('nested arrays and objects are walked all the way down', () => {
  const out = serializeBigInts({ a: [{ b: [{ c: 1n }] }] }) as any;
  assert.equal(out.a[0].b[0].c, '1');
});

test('a self-referencing graph does not blow the stack', () => {
  const node: any = { amountPaise: 100n };
  node.self = node; // Prisma relation includes can produce these
  assert.doesNotThrow(() => serializeBigInts(node));
});

test('money views carry an exact value and a display string', () => {
  const view = money(rupeesToPaise('599.50'));
  assert.deepEqual(view, { paise: '59950', amount: '599.50', display: '₹599.50' });
});

test('volume and percent views never make the client guess the scale', () => {
  assert.deepEqual(volume(bvToCenti(300)), { centi: 30000, bv: '300', display: '300 BV' });
  assert.deepEqual(percent(1900), { bp: 1900, display: '19%' });
});

test('money arriving as a float is rejected outright', () => {
  assert.throws(() => parseMoneyInput(599.5), /must be sent as a string/);
  assert.throws(() => parseMoneyInput(1000), /must be sent as a string/);
});

test('money arriving as a decimal string parses exactly', () => {
  assert.equal(parseMoneyInput('599.50'), 59950n);
  assert.equal(parseMoneyInput('0.01'), 1n);
  assert.equal(parseMoneyInput('2000'), 200000n);
  assert.throws(() => parseMoneyInput('10.999'), /at most two decimals/);
  assert.throws(() => parseMoneyInput('-5'), /at most two decimals/);
  assert.throws(() => parseMoneyInput('abc'), /at most two decimals/);
});
