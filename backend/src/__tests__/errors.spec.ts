import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, isNoise } from '../monitoring/error.service';

const stack = (line: number) => `Error: boom\n    at placeOrder (/app/dist/order/order.service.js:${line}:17)\n    at next (/app/node_modules/x/index.js:5:1)`;

test('the same bug has the same fingerprint however many ids and numbers are in its message', () => {
  const a = fingerprint('api', 'Order cmx7abc1234567890abcdefgh failed for member 41', stack(120));
  const b = fingerprint('api', 'Order cmy9zzz1234567890abcdefgh failed for member 9007', stack(120));
  assert.equal(a, b);
});

test('a line number moving after a deploy does not make it a new bug', () => {
  assert.equal(fingerprint('api', 'boom', stack(120)), fingerprint('api', 'boom', stack(133)));
});

test('different bugs, or the same message from the server and the browser, are different rows', () => {
  assert.notEqual(fingerprint('api', 'boom', stack(1)), fingerprint('api', 'bang', stack(1)));
  assert.notEqual(fingerprint('api', 'boom'), fingerprint('web', 'boom'));
});

test('browser noise is not recorded, real errors are', () => {
  for (const n of ['ResizeObserver loop completed with undelivered notifications.', 'Script error.', 'Failed to fetch', 'AbortError: The user aborted a request.', '']) {
    assert.equal(isNoise(n), true, n);
  }
  for (const real of ["Cannot read properties of undefined (reading 'price')", 'x is not a function']) {
    assert.equal(isNoise(real), false, real);
  }
});
