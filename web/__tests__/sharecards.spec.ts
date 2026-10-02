import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareMessages, buildShareSvg, buildProductSvg, productMessage, catalogueMessage, videoEmbed, type KitProduct } from '@/lib/sharecards';
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

const lipstick: KitProduct = {
  slug: 'velvet-matte-lipstick-royal-rose', name: 'Velvet Matte Lipstick, Royal Rose', brand: 'Majestic Cart',
  price: { display: '₹549', paise: 54900 }, mrp: { display: '₹649', paise: 64900 },
};

test('a product image carries the name, price, discount and member id, and stays valid with a very long name', () => {
  const svg = buildProductSvg(lipstick, { name: 'Amal Dey', code: d.code, link: d.link, photo: null, logo: null, qrSvg: null });
  assert.ok(svg.startsWith('<svg'));
  for (const part of ['Velvet Matte', '₹549', '15% OFF', d.code]) assert.ok(svg.includes(part), part);
  const long = buildProductSvg({ ...lipstick, name: 'An Extraordinarily Long Product Name That Goes On And On Forever And Ever' }, { name: 'A', code: d.code, link: d.link, photo: null, logo: null, qrSvg: null });
  assert.ok(long.includes('…'), 'a name that cannot fit is shortened, not squeezed');
});

test('product and catalogue messages carry their links and make no income claims', () => {
  const one = productMessage(lipstick, { name: 'Amal Dey', link: 'https://example.com/product/x?ref=MC100005' });
  const cat = catalogueMessage('My favourites', [{ p: lipstick, link: 'https://example.com/product/x?ref=MC100005' }], { name: 'Amal Dey', storefront: d.link });
  for (const text of [one, cat]) {
    assert.ok(text.includes('ref=MC100005'));
    assert.deepEqual(findIncomeClaims(text), []);
  }
  assert.ok(cat.includes(d.link) && cat.includes('₹549'));
});

test('video links are told apart without loading anything', () => {
  assert.deepEqual(videoEmbed('https://youtu.be/dQw4w9WgXcQ'), { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(videoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(videoEmbed('https://vimeo.com/123456789'), { kind: 'vimeo', id: '123456789' });
  assert.deepEqual(videoEmbed('https://cdn.example.com/a/b.mp4'), { kind: 'file', url: 'https://cdn.example.com/a/b.mp4' });
  assert.equal(videoEmbed('http://youtu.be/dQw4w9WgXcQ').kind, 'link', 'plain http is never embedded');
  assert.equal(videoEmbed('not a url').kind, 'link');
});
