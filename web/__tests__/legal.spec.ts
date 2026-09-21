import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEGAL_DOCUMENTS, PRIVACY_POLICY, TERMS, REFUND_POLICY, SHIPPING_POLICY,
  getLegalDocument, auditDocument, auditAll, assertLegalPagesReady, ENTITY,
} from '@/lib/legal';
import { findIncomeClaims } from '@/lib/seo';

test('all four policy documents exist and are addressable', () => {
  assert.deepEqual(LEGAL_DOCUMENTS.map((d) => d.slug).sort(),
    ['privacy-policy', 'refund-policy', 'shipping-policy', 'terms']);
  for (const doc of LEGAL_DOCUMENTS) {
    assert.equal(getLegalDocument(doc.slug), doc);
  }
  assert.equal(getLegalDocument('nonsense'), undefined);
});

test('section ids are unique within a document, so anchors work', () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const ids = doc.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${doc.slug} has duplicate section ids`);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${doc.slug}: "${id}" is not anchor-safe`);
  }
});

/* --------------------------------------------- statutory coverage */

test('the privacy policy covers what the DPDP Act requires', () => {
  const audit = auditDocument(PRIVACY_POLICY);
  const bases = audit.statutorySections.map((s) => s.basis).join(' ');
  // Identity of the fiduciary, itemised collection, purpose, rights, grievance contact.
  for (const required of ['s.5', 's.4', 'ss.11-14', 's.9', 's.13']) {
    assert.ok(bases.includes(required), `privacy policy has no section citing DPDP ${required}`);
  }
});

test('the terms cover the Direct Selling Rules that make or break the model', () => {
  const bases = auditDocument(TERMS).statutorySections.map((s) => s.basis).join(' ');
  assert.ok(bases.includes('Direct Selling'), 'terms cite no Direct Selling Rules requirement');
  assert.ok(bases.includes('E-Commerce'), 'terms cite no E-Commerce Rules requirement');
});

test('the entry-fee prohibition is stated, not implied', () => {
  const joining = TERMS.sections.find((s) => s.id === 'joining');
  const text = joining!.body.join(' ').toLowerCase();
  assert.ok(text.includes('registration is free'));
  assert.ok(text.includes('not a fee'), 'the minimum first order must be distinguished from a fee');
});

test('the terms state that income comes from sales, not recruitment', () => {
  const income = TERMS.sections.find((s) => s.id === 'income');
  const text = income!.body.join(' ').toLowerCase();
  assert.ok(text.includes('sold and delivered'));
  assert.ok(text.includes('no income is paid for recruiting'));
  assert.ok(text.includes('no guarantee') || text.includes('no representation'));
});

test('buy-back is present, since it is a statutory obligation and easy to forget', () => {
  const buyBack = REFUND_POLICY.sections.find((s) => s.id === 'buy-back');
  assert.ok(buyBack, 'refund policy has no buy-back section');
  assert.ok(buyBack!.statutory?.basis.includes('Direct Selling'));
});

test('commission reversal on a return is disclosed to members up front', () => {
  const refunds = REFUND_POLICY.sections.find((s) => s.id === 'refunds');
  const text = refunds!.body.join(' ').toLowerCase();
  // The engine can push an income wallet negative. Members must be told.
  assert.ok(text.includes('reversed'));
  assert.ok(text.includes('below zero') || text.includes('future earnings'));
});

test('a grievance officer is named in both the policies that require one', () => {
  for (const doc of [PRIVACY_POLICY, TERMS]) {
    const text = JSON.stringify(doc).toLowerCase();
    assert.ok(text.includes('grievance'), `${doc.slug} does not name a grievance contact`);
    assert.ok(text.includes(ENTITY.grievanceOfficer.email.toLowerCase()));
  }
});

/* ------------------------------------------------------ draft audit */

test('the audit reports every unfilled placeholder', () => {
  const audit = auditDocument(SHIPPING_POLICY);
  assert.equal(audit.ready, false);
  const flagged = audit.unfilledPlaceholders.flatMap((p) => p.placeholders);
  assert.ok(flagged.includes('N'), 'the delivery window placeholder was not caught');
  assert.ok(audit.unfilledPlaceholders.some((p) => p.section === 'Effective date'));
});

test('the audit lists what the business still owes each document', () => {
  const audit = auditDocument(REFUND_POLICY);
  assert.ok(audit.outstandingWork.length > 0);
  const buyBackWork = audit.outstandingWork.find((w) => w.section.includes('Buy-back'));
  assert.ok(buyBackWork, 'buy-back terms are not flagged as outstanding');
  assert.match(buyBackWork!.needs.join(' '), /lawyer/);
});

test('every shipped document is currently a draft, and honestly reported as one', () => {
  // If this ever passes as ready without a lawyer having filled it in, the
  // scaffolding has been mistaken for finished work.
  const audits = auditAll();
  assert.equal(audits.every((a) => !a.ready), true);
  assert.throws(() => assertLegalPagesReady(), /not ready to publish/);
});

test('the readiness error names the documents and the reason', () => {
  try {
    assertLegalPagesReady();
    assert.fail('expected the guard to throw');
  } catch (e) {
    const msg = (e as Error).message;
    for (const doc of LEGAL_DOCUMENTS) assert.ok(msg.includes(doc.title), `${doc.title} missing from the report`);
    assert.match(msg, /placeholders|empty|awaiting/);
  }
});

/* --------------------------------------------- no income claims */

test('no policy page carries an income claim', () => {
  for (const doc of LEGAL_DOCUMENTS) {
    const copy = doc.sections.flatMap((s) => [...s.body, ...(s.bullets ?? [])]).join(' ');
    assert.deepEqual(findIncomeClaims(copy), [], `${doc.slug} contains an income claim`);
  }
});

test('the wallet is described as not an investment', () => {
  const wallet = TERMS.sections.find((s) => s.id === 'wallet');
  const text = wallet!.body.join(' ').toLowerCase();
  for (const phrase of ['not a deposit', 'investment', 'no interest']) {
    assert.ok(text.includes(phrase), `the wallet section does not say it is "${phrase}"`);
  }
});
