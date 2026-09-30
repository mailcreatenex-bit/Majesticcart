import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findIncomeClaims, assertNoIncomeClaims } from '../common/income-claims';

/**
 * The one check standing between an admin editing the About/Join/FAQ pages
 * at runtime and the site publishing an income claim — see the interface
 * comment on ThemeSettingValue in settings.service.ts for why this exists.
 */

test('ordinary business copy passes clean', () => {
  assert.deepEqual(findIncomeClaims('Registering is free. Income is earned only on products sold and delivered.'), []);
});

test('a specific earnings figure is caught', () => {
  // Deliberately also has "month" in it, so this legitimately trips both the
  // earnings-figure pattern and the per-period pattern — more than one
  // finding is correct here, not a bug.
  const findings = findIncomeClaims('You can earn ₹50,000 in your first month.');
  assert.equal(findings.length > 0, true);
  assert.equal(findings.some((f) => /earnings figure/.test(f.note)), true);
});

test('a per-period figure is caught regardless of word order', () => {
  assert.equal(findIncomeClaims('₹40,000 every month, guaranteed.').length > 0, true);
  assert.equal(findIncomeClaims('monthly income of ₹40,000').length > 0, true);
});

test('a guaranteed-income claim is caught even with no figure', () => {
  const findings = findIncomeClaims('This plan offers a guaranteed income for every member.');
  assert.equal(findings.length, 1);
  assert.match(findings[0].note, /guaranteed-income/);
});

test('lifestyle-inducement phrases are caught', () => {
  assert.equal(findIncomeClaims('Achieve financial freedom and quit your job.').length > 0, true);
  assert.equal(findIncomeClaims('Double your money in 90 days.').length > 0, true);
});

test('rupee amounts in unrelated sentences do not trip the earnings pattern', () => {
  // A price or BV mention alone, with no earn/period word nearby, is not a claim.
  assert.deepEqual(findIncomeClaims('This serum costs ₹499 and carries 250 BV per unit.'), []);
});

test('assertNoIncomeClaims throws with the offending phrase named', () => {
  assert.throws(
    () => assertNoIncomeClaims('Earn ₹1,00,000 a month working from home.', 'The Join page'),
    /The Join page reads as.*earnings figure.*₹1,00,000/,
  );
});

test('assertNoIncomeClaims is silent on clean copy', () => {
  assert.doesNotThrow(() => assertNoIncomeClaims('Nobody is paid for recruiting.', 'The Join page'));
});
