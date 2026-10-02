import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SearchIndex, editDistance, normalise, type SearchRow } from '../catalog/search';

const row = (id: string, name: string, category: string, brand: string | null = null, description = '', sold = 0): SearchRow => ({
  id, name, sku: `MC-${id}`, description, sold, brand, category, parentCategory: null,
});

const index = SearchIndex.build([
  row('lotion', 'Rose Gold Radiance Body Lotion', 'Body Care', 'Majestic Cart', 'Deep-moisturising lotion with rose extract'),
  row('butter', 'Cocoa & Shea Body Butter', 'Body Care'),
  row('mist', 'Jasmine Night Body Mist', 'Fragrance'),
  row('lipstick', 'Velvet Matte Lipstick, Royal Rose', 'Makeup', null, 'Weightless matte colour', 9),
  row('foundation', 'Silk Finish Foundation SPF 20', 'Makeup'),
  row('kajal', 'Kohl Intense Kajal', 'Makeup'),
  row('serum', 'Vitamin C Brightening Serum', 'Skin Care'),
  row('sunscreen', 'Sun Shield Gel SPF 50', 'Skin Care'),
  row('aloe', 'Lotus Aloe Soothing Gel', 'Skin Care'),
]);

const ids = (q: string) => index.search(q).ids;

test('an exact word finds its product', () => {
  assert.deepEqual(ids('kajal'), ['kajal']);
});

test('a prefix finds it while the word is still being typed', () => {
  assert.ok(ids('lips').includes('lipstick'));
  assert.ok(ids('vitam').includes('serum'));
});

test('a misspelling is forgiven, and a correction is offered', () => {
  assert.ok(ids('lipstck').includes('lipstick'));
  assert.ok(ids('foundaton').includes('foundation'));
  assert.equal(index.search('foundaton').didYouMean, 'foundation');
  assert.equal(index.search('foundation').didYouMean, null);
});

test('swapped neighbouring letters count as one slip', () => {
  assert.equal(editDistance('serum', 'sreum', 1), 1);
  assert.ok(ids('sreum').includes('serum'));
});

test('short words are not fuzzed: one slip in "gel" is another word', () => {
  assert.deepEqual(ids('gem'), []);
});

test('every typed word has to be found', () => {
  assert.deepEqual(ids('rose lotion'), ['lotion']);
  assert.deepEqual(ids('rose zebra'), []);
});

test('Hindi words find the English catalogue', () => {
  assert.ok(ids('लिपस्टिक').includes('lipstick'));
  assert.ok(ids('काजल').includes('kajal'));
  assert.ok(ids('सनस्क्रीन').includes('sunscreen'));
  assert.ok(ids('सीरम').includes('serum'));
});

test('Bengali words find the English catalogue', () => {
  assert.ok(ids('লিপস্টিক').includes('lipstick'));
  assert.ok(ids('কাজল').includes('kajal'));
  assert.ok(ids('ফাউন্ডেশন').includes('foundation'));
  assert.ok(ids('ময়েশ্চারাইজার').includes('lotion')); // its description says "moisturising"
});

test('Hinglish spellings work, and a Hindi word can be combined with an English one', () => {
  assert.ok(ids('kaajal').includes('kajal'));
  assert.deepEqual(ids('गुलाब lotion'), ['lotion']);
});

test('a department word matches everything filed under it', () => {
  const found = ids('makeup');
  for (const id of ['lipstick', 'foundation', 'kajal']) assert.ok(found.includes(id), id);
  assert.ok(!found.includes('serum'));
  assert.ok(ids('मेकअप').includes('kajal'));
});

test('a name match outranks a description match, and ties go to the best seller', () => {
  const found = ids('rose');
  assert.equal(found.length, 2);
  // "Rose Gold … Lotion" has it first in the name; the lipstick has it too but sells more.
  assert.deepEqual(new Set(found), new Set(['lotion', 'lipstick']));
  assert.equal(found[0], 'lipstick');
});

test('empty and punctuation-only queries match nothing', () => {
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('  ,, '), []);
});

test('normalisation removes the marks that vary between keyboards', () => {
  assert.equal(normalise('Cocoa & Shea'), 'cocoa and shea');
  assert.equal(normalise('क़ाजल'), normalise('काजल'));
});
