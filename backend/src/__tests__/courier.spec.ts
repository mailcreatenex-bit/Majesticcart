import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trackingUrl, courierLabel, isDeliveredStatus, parseWebhook, COURIER_KEYS } from '../order/courier';

test('a tracking link is built from the courier and AWB, and encodes the AWB', () => {
  assert.equal(trackingUrl('delhivery', '1234567890'), 'https://www.delhivery.com/track-v2/package/1234567890');
  assert.match(trackingUrl('dtdc', 'A B/1') ?? '', /A%20B%2F1$/);
});

test('"other" courier, unknown courier or missing AWB give no link rather than a broken one', () => {
  assert.equal(trackingUrl('other', 'ABC1234'), null);
  assert.equal(trackingUrl('nope', 'ABC1234'), null);
  assert.equal(trackingUrl('delhivery', null), null);
  assert.equal(trackingUrl(null, 'ABC1234'), null);
});

test('every courier key has a readable label', () => {
  for (const k of COURIER_KEYS) assert.ok(courierLabel(k), k);
});

test('only a status that begins "delivered" counts as delivered', () => {
  assert.equal(isDeliveredStatus('Delivered'), true);
  assert.equal(isDeliveredStatus('DELIVERED to consignee'), true);
  assert.equal(isDeliveredStatus('Undelivered - attempted'), false);
  assert.equal(isDeliveredStatus('Out for delivery'), false);
  assert.equal(isDeliveredStatus(null), false);
});

test('webhook bodies from both couriers are understood; junk is not', () => {
  assert.deepEqual(parseWebhook({ awb: 12345, current_status: 'Delivered' }), { awb: '12345', status: 'Delivered' });
  assert.deepEqual(parseWebhook({ Shipment: { AWB: 'D1', Status: { Status: 'In Transit' } } }), { awb: 'D1', status: 'In Transit' });
  assert.equal(parseWebhook({ hello: 'world' }), null);
  assert.equal(parseWebhook(null), null);
});
