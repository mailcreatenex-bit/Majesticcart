import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UI } from '@/lib/phrases/ui';
import { MEMBER } from '@/lib/phrases/member';
import { PAGES } from '@/lib/phrases/pages';
import { MISC } from '@/lib/phrases/misc';
import { translatePhrase } from '@/lib/phrases';

const ALL = [...UI, ...MEMBER, ...PAGES, ...MISC];
const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('no phrase has an empty English, Hindi or Bengali side', () => {
  for (const [en, hi, bn] of ALL) {
    assert.ok(en.trim() && hi.trim() && bn.trim(), `blank side in: ${en}`);
  }
});

test('a translation carries exactly the same {tokens} as its English, so a name or amount is never lost', () => {
  for (const [en, hi, bn] of ALL) {
    assert.equal(tokens(hi), tokens(en), `Hindi tokens differ for: ${en}`);
    assert.equal(tokens(bn), tokens(en), `Bengali tokens differ for: ${en}`);
  }
});

test('no English phrase is listed twice with different translations (the first would silently win)', () => {
  const seen = new Map<string, string>();
  for (const [en, hi, bn] of ALL) {
    const key = norm(en);
    const value = `${hi}|${bn}`;
    if (seen.has(key)) assert.equal(seen.get(key), value, `conflicting entries for: ${en}`);
    seen.set(key, value);
  }
});

test('plain text matches whole strings only, ignoring surrounding whitespace and curly quotes', () => {
  assert.equal(translatePhrase('  Log in ', 'hi'), 'लॉग इन');
  assert.equal(translatePhrase('Log in now', 'hi'), null);
  assert.equal(translatePhrase("Didn’t get a code?", 'bn'), 'কোড পাননি?');
});

test('a pattern carries the matched name across into the translation', () => {
  assert.match(translatePhrase('Want to sell like Priya? See how to join →', 'hi') ?? '', /^Priya की तरह/);
  assert.match(translatePhrase('Shop Dot & Key', 'bn') ?? '', /^Dot & Key/);
});

test('{n} patterns match numbers only, so they cannot swallow unrelated text', () => {
  assert.equal(translatePhrase('23 Brands', 'hi'), '23 ब्रांड');
  assert.equal(translatePhrase('Kama off', 'hi'), null);
  assert.equal(translatePhrase('Brands', 'hi'), null);
});

test('text with no entry is left alone rather than guessed at', () => {
  assert.equal(translatePhrase('Cocoa & Shea Body Butter', 'hi'), null);
  assert.equal(translatePhrase('', 'hi'), null);
});

test('the legal documents are deliberately not in the table', () => {
  assert.equal(translatePhrase('Privacy Policy', 'hi'), null);
  assert.equal(translatePhrase('This document is a draft', 'hi'), null);
});
