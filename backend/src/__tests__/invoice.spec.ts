import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateCode, isIntraState, amountInWords } from '../invoice/invoice.service';
import { slugify } from '../catalog/catalog.service';
import { rupeesToPaise, gstInclusiveComponent, formatInr } from '../common/money';

/* ---------------------------------------------------------- state codes */

test('state names resolve to their GST codes', () => {
  assert.equal(stateCode('West Bengal'), '19');
  assert.equal(stateCode('Maharashtra'), '27');
  assert.equal(stateCode('Delhi'), '07');
  assert.equal(stateCode('Tamil Nadu'), '33');
});

test('casing, spacing, abbreviations and old names all resolve to one code', () => {
  // Members type these however they like, and an address that fails to match
  // silently becomes inter-state — IGST where CGST+SGST was due.
  for (const variant of ['west bengal', 'WEST BENGAL', '  West   Bengal  ', 'WB', 'wb', 'West Bengal.']) {
    assert.equal(stateCode(variant), '19', `"${variant}" did not resolve`);
  }
  assert.equal(stateCode('Orissa'), stateCode('Odisha'));
  assert.equal(stateCode('Pondicherry'), stateCode('Puducherry'));
  assert.equal(stateCode('New Delhi'), '07');
});

test('an unrecognised state is null rather than a wrong guess', () => {
  assert.equal(stateCode('Atlantis'), null);
  assert.equal(stateCode(''), null);
  assert.equal(stateCode(undefined as unknown as string), null);
});

/* ------------------------------------------------- intra vs inter state */

test('same state is intra-state, different state is inter-state', () => {
  assert.equal(isIntraState('West Bengal', 'West Bengal'), true);
  assert.equal(isIntraState('West Bengal', 'WB'), true);
  assert.equal(isIntraState('West Bengal', 'Bihar'), false);
  assert.equal(isIntraState('West Bengal', 'Maharashtra'), false);
});

test('an unknown state falls back to inter-state, which is the safer error', () => {
  // IGST filed where CGST+SGST was due is correctable by amendment. The
  // reverse leaves the buyer unable to claim input credit at all.
  assert.equal(isIntraState('West Bengal', 'Atlantis'), false);
  assert.equal(isIntraState('Atlantis', 'Atlantis'), false);
});

/* ------------------------------------------------------------ tax split */

/** The split as invoice.service performs it, isolated for exhaustive checking. */
function splitTax(inclusivePaise: bigint, gstBp: number, intra: boolean) {
  const gst = gstInclusiveComponent(inclusivePaise, gstBp);
  const taxable = inclusivePaise - gst;
  const cgst = intra ? gst / 2n : 0n;
  const sgst = intra ? gst - cgst : 0n; // remainder, never recomputed
  const igst = intra ? 0n : gst;
  return { taxable, gst, cgst, sgst, igst };
}

test('an 18% intra-state sale splits into 9% CGST and 9% SGST', () => {
  const { taxable, cgst, sgst, igst } = splitTax(rupeesToPaise(599), 1800, true);
  assert.equal(taxable, rupeesToPaise('507.63'));
  assert.equal(cgst, rupeesToPaise('45.68'));
  assert.equal(sgst, rupeesToPaise('45.69')); // takes the odd paise
  assert.equal(igst, 0n);
  assert.equal(taxable + cgst + sgst, rupeesToPaise(599));
});

test('the same sale inter-state is one IGST line', () => {
  const { taxable, cgst, sgst, igst } = splitTax(rupeesToPaise(599), 1800, false);
  assert.equal(cgst, 0n);
  assert.equal(sgst, 0n);
  assert.equal(igst, rupeesToPaise('91.37'));
  assert.equal(taxable + igst, rupeesToPaise(599));
});

test('intra and inter-state charge the buyer exactly the same total', () => {
  // The buyer pays one price. Only the heads it is filed under differ.
  for (const price of [249, 599, 1099, 1599]) {
    const intra = splitTax(rupeesToPaise(price), 1800, true);
    const inter = splitTax(rupeesToPaise(price), 1800, false);
    assert.equal(intra.cgst + intra.sgst, inter.igst, `totals differ at ₹${price}`);
    assert.equal(intra.taxable, inter.taxable);
  }
});

test('CGST plus SGST always reconstructs the tax exactly, across every price', () => {
  // Halving and rounding each half independently loses a paise on odd amounts.
  // Taking SGST as the remainder is what prevents it.
  let oddCases = 0;
  for (let rupees = 1; rupees <= 2000; rupees++) {
    for (const gstBp of [500, 1200, 1800, 2800]) {
      const inclusive = rupeesToPaise(rupees);
      const { taxable, gst, cgst, sgst } = splitTax(inclusive, gstBp, true);
      assert.equal(cgst + sgst, gst, `₹${rupees} at ${gstBp}bp: halves do not sum to the tax`);
      assert.equal(taxable + cgst + sgst, inclusive, `₹${rupees} at ${gstBp}bp: does not reconcile to the price`);
      if (gst % 2n === 1n) oddCases++;
    }
  }
  assert.ok(oddCases > 0, 'no odd-paise cases were exercised, so the remainder rule was never tested');
});

test('a multi-rate cart taxes each line at its own rate', () => {
  // Hair oil at 5% and a lotion at 18% in one order. A blended rate over the
  // cart total would be wrong on both lines.
  const oil = splitTax(rupeesToPaise(379), 500, true);
  const lotion = splitTax(rupeesToPaise(599), 1800, true);
  assert.equal(oil.gst, rupeesToPaise('18.04'));
  assert.equal(lotion.gst, rupeesToPaise('91.37'));
  assert.equal(oil.taxable + oil.gst + lotion.taxable + lotion.gst, rupeesToPaise(978));
});

/* ------------------------------------------------------------ round off */

function roundOff(grandTotal: bigint) {
  const remainder = grandTotal % 100n;
  const adj = remainder === 0n ? 0n : remainder < 50n ? -remainder : 100n - remainder;
  return { adj, payable: grandTotal + adj };
}

test('the invoice total rounds to the nearest rupee, and the adjustment is shown', () => {
  assert.deepEqual(roundOff(rupeesToPaise('978.40')), { adj: -40n, payable: rupeesToPaise(978) });
  assert.deepEqual(roundOff(rupeesToPaise('978.60')), { adj: 40n, payable: rupeesToPaise(979) });
  assert.deepEqual(roundOff(rupeesToPaise('978.50')), { adj: 50n, payable: rupeesToPaise(979) });
  assert.deepEqual(roundOff(rupeesToPaise(978)), { adj: 0n, payable: rupeesToPaise(978) });
});

test('rounding never moves the total by more than fifty paise', () => {
  for (let p = 1; p <= 1000; p++) {
    const { adj } = roundOff(BigInt(p));
    assert.ok(adj >= -49n && adj <= 50n, `adjustment of ${adj} at ${p} paise`);
  }
});

/* -------------------------------------------------------- amount in words */

test('amounts render on the Indian scale, not the international one', () => {
  // "Two Million Rupees" on an Indian invoice reads as an error.
  assert.equal(amountInWords(rupeesToPaise(2_000_000)), 'Twenty Lakh Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(10_000_000)), 'One Crore Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(12_34_567)), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only');
});

test('common invoice amounts read correctly', () => {
  assert.equal(amountInWords(rupeesToPaise(599)), 'Five Hundred Ninety Nine Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(1599)), 'One Thousand Five Hundred Ninety Nine Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(3997)), 'Three Thousand Nine Hundred Ninety Seven Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(100)), 'One Hundred Rupees Only');
  assert.equal(amountInWords(0n), 'Zero Rupees Only');
});

test('the teens and the tens boundary are right', () => {
  // Off-by-one here produces "Ten One" or "Twenty Zero" on a legal document.
  assert.equal(amountInWords(rupeesToPaise(11)), 'Eleven Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(19)), 'Nineteen Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(20)), 'Twenty Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(21)), 'Twenty One Rupees Only');
  assert.equal(amountInWords(rupeesToPaise(90)), 'Ninety Rupees Only');
});

test('paise are spelled out when present', () => {
  assert.equal(amountInWords(rupeesToPaise('599.50')), 'Five Hundred Ninety Nine Rupees and Fifty Paise Only');
  assert.equal(amountInWords(rupeesToPaise('0.99')), 'Zero Rupees and Ninety Nine Paise Only');
});

test('a credit note amount renders as negative rather than silently positive', () => {
  assert.match(amountInWords(-rupeesToPaise(500)), /^Minus Five Hundred Rupees Only$/);
});

/* -------------------------------------------------------------- slugs */

test('product slugs are URL-safe and stable', () => {
  assert.equal(slugify('Rose Gold Radiance Body Lotion'), 'rose-gold-radiance-body-lotion');
  assert.equal(slugify('Velvet Matte Lipstick, Royal Rose'), 'velvet-matte-lipstick-royal-rose');
  assert.equal(slugify('Onion & Bhringraj Hair Oil'), 'onion-bhringraj-hair-oil');
  assert.equal(slugify('  Extra   Spaces  '), 'extra-spaces');
  assert.equal(slugify('SPF 50 Gel'), 'spf-50-gel');
});

test('a slug never starts or ends with a hyphen', () => {
  for (const name of ['---Leading', 'Trailing---', '!!!Symbols!!!', '  ']) {
    const slug = slugify(name);
    assert.equal(slug.startsWith('-'), false, `"${name}" -> "${slug}"`);
    assert.equal(slug.endsWith('-'), false, `"${name}" -> "${slug}"`);
  }
});

/* ------------------------------------------------------------ end to end */

test('a realistic two-line intra-state invoice reconciles completely', () => {
  const lines = [
    { inclusive: rupeesToPaise(1599) * 2n, gstBp: 1800 }, // Oud Royale x2
    { inclusive: rupeesToPaise(379), gstBp: 500 },        // Hair oil x1
  ].map((l) => splitTax(l.inclusive, l.gstBp, true));

  const taxable = lines.reduce((a, l) => a + l.taxable, 0n);
  const cgst = lines.reduce((a, l) => a + l.cgst, 0n);
  const sgst = lines.reduce((a, l) => a + l.sgst, 0n);
  const grand = taxable + cgst + sgst;

  assert.equal(grand, rupeesToPaise(3577), 'the invoice total does not match what the buyer paid');
  const { payable } = roundOff(grand);
  assert.equal(formatInr(payable), '₹3,577');
  assert.equal(amountInWords(payable), 'Three Thousand Five Hundred Seventy Seven Rupees Only');
});
