import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upiIntentUri, upiQrSvg, upiAppLinks } from '../recharge/upi-qr';

/**
 * The UPI intent URI.
 *
 * This is the string inside the QR the member scans to send money. A field in
 * the wrong shape does not throw anywhere — it produces a QR that some UPI apps
 * open with a blank payee and others reject outright, and the member's only
 * signal is that "the QR does not work".
 */

test('a valid payee produces a well-formed intent', () => {
  const uri = upiIntentUri({ vpa: 'majesticcart@hdfcbank', name: 'Majestic Cart' });

  assert.ok(uri.startsWith('upi://pay?'));
  const params = new URLSearchParams(uri.slice('upi://pay?'.length));
  assert.equal(params.get('pa'), 'majesticcart@hdfcbank');
  assert.equal(params.get('pn'), 'Majestic Cart');
  assert.equal(params.get('cu'), 'INR');
});

test('spaces in the payee name are percent-encoded, not plus-encoded', () => {
  // URLSearchParams encodes a space as "+", which several UPI apps render
  // literally — the member sees "Majestic+Cart" as the payee and hesitates.
  const uri = upiIntentUri({ vpa: 'store@hdfcbank', name: 'Majestic Cart Private Limited' });

  assert.ok(uri.includes('Majestic%20Cart%20Private%20Limited'));
  assert.ok(!uri.includes('+'), 'no plus-encoding anywhere in the intent');
});

test('an absent amount is omitted rather than sent empty', () => {
  // `am=` with no value makes some apps reject the intent instead of
  // prompting for an amount.
  const uri = upiIntentUri({ vpa: 'store@hdfcbank', name: 'Majestic' });
  assert.ok(!uri.includes('am='), 'no empty amount parameter');

  const withAmount = upiIntentUri({ vpa: 'store@hdfcbank', name: 'Majestic', amountRupees: '499.00' });
  assert.equal(new URLSearchParams(withAmount.slice(10)).get('am'), '499.00');
});

test('an invalid UPI ID throws rather than producing a scannable QR', () => {
  // The failure has to happen here. A QR built from a malformed VPA still
  // scans — it just goes nowhere, after the member has already paid attention
  // to it.
  for (const bad of [
    '', 'nope', '@bank', 'user@', 'user@@bank', 'user bank@x',
    'a@b',        // one character either side is not a real VPA
    'user@hdfc1', // digits are not valid in the handle
  ]) {
    assert.throws(() => upiIntentUri({ vpa: bad, name: 'X' }), /not a valid UPI ID/, `"${bad}"`);
  }
});

test('the rendered QR is an SVG carrying the intent', async () => {
  const svg = await upiQrSvg({ vpa: 'majesticcart@hdfcbank', name: 'Majestic Cart' });
  assert.ok(svg.startsWith('<?xml') || svg.startsWith('<svg'), 'must be an SVG document');
  assert.ok(svg.includes('viewBox'), 'must scale, so it stays sharp when zoomed to scan');
  assert.ok(svg.length > 500, 'suspiciously small for a QR of this payload');
});

test('a payee name with reserved characters survives the round trip', () => {
  const name = 'Shah & Co. (India)';
  const uri = upiIntentUri({ vpa: 'store@hdfcbank', name });
  assert.equal(new URLSearchParams(uri.slice('upi://pay?'.length)).get('pn'), name);
});

test('every app link carries the same payee, amount and note as the standard intent', () => {
  const payee = { vpa: 'store@hdfcbank', name: 'Majestic Cart', amountRupees: '500.00', note: 'Wallet MC100005' };
  const links = upiAppLinks(payee);
  const query = (u: string) => new URLSearchParams(u.slice(u.indexOf('?') + 1));
  const expected = [...query(links.upi).entries()];
  for (const [name, link] of Object.entries(links)) {
    assert.deepEqual([...query(link).entries()], expected, name);
  }
  const q = query(links.upi);
  assert.equal(q.get('pa'), 'store@hdfcbank');
  assert.equal(q.get('am'), '500.00');
  assert.equal(q.get('tn'), 'Wallet MC100005');
});

test('each app opens through its own scheme', () => {
  const links = upiAppLinks({ vpa: 'store@hdfcbank', name: 'Majestic Cart', amountRupees: '100.00' });
  assert.ok(links.upi.startsWith('upi://pay?'));
  assert.ok(links.gpayAndroid.startsWith('tez://upi/pay?'));
  assert.ok(links.gpayIos.startsWith('gpay://upi/pay?'));
  assert.ok(links.phonepe.startsWith('phonepe://pay?'));
  assert.ok(links.paytm.startsWith('paytmmp://pay?'));
});

test('an invalid UPI ID cannot produce app links either', () => {
  assert.throws(() => upiAppLinks({ vpa: 'not a vpa', name: 'X' }));
});
