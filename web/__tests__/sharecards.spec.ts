import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareMessages, buildShareSvg } from '@/lib/sharecards';
import { findIncomeClaims } from '@/lib/seo';

const d = { name: 'Amal Dey', code: 'MC100005', link: 'https://example.com/mc/MC100005' };

test('share messages make no income claims', () => {
  for (const m of shareMessages(d)) {
    assert.deepEqual(findIncomeClaims(m.text), [], `income claim in "${m.id}"`);
  }
});

test('every message carries the link', () => {
  for (const m of shareMessages(d)) assert.ok(m.text.includes(d.link), m.id);
});

test('share images embed the member id and stay valid SVG for long names', () => {
  const long = { ...d, name: 'Bhattacharyya Chandrashekhar Venkataraman', logo: null, qrSvg: null };
  for (const kind of ['post', 'story'] as const) {
    const svg = buildShareSvg(kind, long);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes(d.code));
    assert.ok(svg.includes('textLength'), 'long names are squeezed to fit');
  }
});
