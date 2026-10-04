import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveReferralId, signupLink, canonicalise, normaliseRefCode } from '@/lib/referral';

test('a Referral ID from an invite link wins over whatever the form posts', () => {
  assert.equal(effectiveReferralId('MC100005', 'MC999999'), 'MC100005');
  assert.equal(effectiveReferralId('mc100005', ''), 'MC100005');
});

test('with no valid link the typed Referral ID is used', () => {
  assert.equal(effectiveReferralId(undefined, ' MC100002 '), 'MC100002');
  assert.equal(effectiveReferralId('not-a-code', 'MC100002'), 'MC100002');
  assert.equal(effectiveReferralId(null, ''), undefined);
});

test('the invite link opens the create-account page carrying the Referral ID', () => {
  const link = signupLink('MC100005', 'https://shop.example');
  assert.equal(link, 'https://shop.example/signup?ref=MC100005');
});

test('opening the invite link stores the ID and lands on the clean sign-up address', () => {
  const r = canonicalise('/signup', new URLSearchParams('ref=MC100005'));
  assert.equal(r.ref, 'MC100005');
  assert.equal(r.path, '/signup');
  assert.equal(r.shouldRedirect, true);
});

test('a malformed code in the link is discarded, never stored', () => {
  assert.equal(normaliseRefCode('<script>'), null);
  assert.equal(canonicalise('/signup', new URLSearchParams('ref=bad')).ref, null);
});

test('the admin label page keeps its order ids, and the sign-in notice survives', () => {
  const labels = canonicalise('/admin/orders/print', new URLSearchParams('ids=a,b'));
  assert.equal(labels.shouldRedirect, false);
  assert.equal(labels.path, '/admin/orders/print?ids=a%2Cb');
  assert.equal(canonicalise('/admin/login', new URLSearchParams('notice=2fa')).shouldRedirect, false);
});

test('tracking parameters are still stripped', () => {
  const r = canonicalise('/shop', new URLSearchParams('utm_source=x&fbclid=y'));
  assert.equal(r.path, '/shop');
  assert.equal(r.shouldRedirect, true);
});
