import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  initEncryption, setKeyringForTesting, loadKeyring, encryptField, decryptField,
  isEncrypted, encryptIfNeeded, decryptIfNeeded, blindIndex, blindIndexMatches,
  lastFour, maskUpi, rotateField, needsRotation, EncryptionError, ctx,
} from '../common/crypto';

const KEY_V1 = randomBytes(32).toString('base64');
const KEY_V2 = randomBytes(32).toString('base64');

before(() => {
  initEncryption({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv);
});

/* ------------------------------------------------------------ round trip */

test('a bank account round trips', () => {
  const account = '50100234567890';
  const stored = encryptField(account, ctx.payoutAccount('m1'));
  assert.notEqual(stored, account);
  assert.equal(stored.includes(account), false, 'the plaintext is visible in the ciphertext');
  assert.equal(decryptField(stored, ctx.payoutAccount('m1')), account);
});

test('the same value encrypts differently every time', () => {
  const a = encryptField('50100234567890', ctx.payoutAccount('m1'));
  const b = encryptField('50100234567890', ctx.payoutAccount('m1'));
  // A random IV per encryption. Without it, identical accounts would produce
  // identical ciphertext and a dump would reveal which members share one.
  assert.notEqual(a, b);
  assert.equal(decryptField(a, ctx.payoutAccount('m1')), decryptField(b, ctx.payoutAccount('m1')));
});

test('unicode and long values survive', () => {
  for (const value of ['প্রিয়া@ybl', '9876500002@paytm', 'x'.repeat(2000), '']) {
    const stored = encryptField(value, 'test:1:field');
    assert.equal(decryptField(stored, 'test:1:field'), value);
  }
});

/* ------------------------------------------------------ record binding */

test('an encrypted value cannot be moved to another member', () => {
  // The attack: someone with write access copies a member's encrypted account
  // number into their own row, and withdrawals start landing in the wrong bank
  // account. Encryption alone does not stop this; the AAD binding does.
  const victim = encryptField('50100234567890', ctx.payoutAccount('victim'));
  assert.throws(
    () => decryptField(victim, ctx.payoutAccount('attacker')),
    /altered or moved from another record/,
  );
  assert.equal(decryptField(victim, ctx.payoutAccount('victim')), '50100234567890');
});

test('a value cannot be moved between columns of the same record either', () => {
  const upi = encryptField('9876500002@ybl', ctx.payoutUpi('m1'));
  assert.throws(() => decryptField(upi, ctx.payoutAccount('m1')), EncryptionError);
});

test('tampering with the ciphertext is detected, not decrypted into garbage', () => {
  const stored = encryptField('50100234567890', ctx.payoutAccount('m1'));
  const [v, iv, tag, ct] = stored.split(':');
  // Flip a byte in the ciphertext. GCM authenticates, so this must fail.
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 0xff;
  assert.throws(() => decryptField(`${v}:${iv}:${tag}:${flipped.toString('base64url')}`, ctx.payoutAccount('m1')), EncryptionError);
  // An altered auth tag likewise.
  assert.throws(() => decryptField(`${v}:${iv}:${Buffer.alloc(16).toString('base64url')}:${ct}`, ctx.payoutAccount('m1')), EncryptionError);
});

test('malformed stored values are rejected cleanly', () => {
  for (const bad of ['', 'plaintext', 'v1:only:three', 'nope:a:b:c']) {
    assert.throws(() => decryptField(bad, 'test:1:field'), EncryptionError);
  }
});

/* --------------------------------------------------------- key handling */

test('a missing or wrong-sized key fails at load, not at first use', () => {
  assert.throws(() => loadKeyring({} as NodeJS.ProcessEnv), /FIELD_ENCRYPTION_KEY is not set/);
  assert.throws(
    () => loadKeyring({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    /required in production/,
  );
  assert.throws(
    () => loadKeyring({ FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') } as NodeJS.ProcessEnv),
    /must be exactly 32 bytes/,
  );
});

test('a value encrypted under a different key cannot be read', () => {
  const stored = encryptField('secret', 'test:1:field');
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V2, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv));
  assert.throws(() => decryptField(stored, 'test:1:field'), EncryptionError);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv));
});

/* ------------------------------------------------------------ rotation */

test('rotating a key leaves old rows readable and new writes on the new key', () => {
  const account = '50100234567890';
  const context = ctx.payoutAccount('m1');
  const underV1 = encryptField(account, context);
  assert.equal(needsRotation(underV1), false);

  // Rotation: the new key becomes current, the old one is retained.
  setKeyringForTesting(loadKeyring({
    FIELD_ENCRYPTION_KEY: KEY_V2, FIELD_ENCRYPTION_KEY_VERSION: '2', FIELD_ENCRYPTION_KEY_V1: KEY_V1,
  } as NodeJS.ProcessEnv));

  // Old rows still decrypt — no downtime, no big-bang migration.
  assert.equal(decryptField(underV1, context), account);
  assert.equal(needsRotation(underV1), true);

  const rotated = rotateField(underV1, context);
  assert.ok(rotated.startsWith('v2:'));
  assert.equal(decryptField(rotated, context), account);
  assert.equal(needsRotation(rotated), false);
  // Re-running the backfill is a no-op rather than a double encryption.
  assert.equal(rotateField(rotated, context), rotated);
});

test('retiring a key without keeping it is reported, not silently swallowed', () => {
  const orphan = 'v9:' + ['a', 'b', 'c'].map((c) => Buffer.from(c.repeat(12)).toString('base64url')).join(':');
  assert.throws(() => decryptField(orphan, 'test:1:field'), /No key for version 9/);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv));
});

/* ------------------------------------------------------------- backfill */

test('encrypting is idempotent, so a backfill can be re-run', () => {
  const once = encryptIfNeeded('9876500002@ybl', ctx.payoutUpi('m1'))!;
  const twice = encryptIfNeeded(once, ctx.payoutUpi('m1'))!;
  assert.equal(once, twice, 'the value was encrypted a second time');
  assert.equal(decryptIfNeeded(twice, ctx.payoutUpi('m1')), '9876500002@ybl');
});

test('plaintext left over from before the migration still reads', () => {
  // During the backfill some rows are encrypted and some are not.
  assert.equal(decryptIfNeeded('9876500002@ybl', ctx.payoutUpi('m1')), '9876500002@ybl');
  assert.equal(isEncrypted('9876500002@ybl'), false);
  assert.equal(encryptIfNeeded(null, 'x')!, null);
});

/* ---------------------------------------------------------- blind index */

test('a blind index is deterministic, so it can be searched', () => {
  const a = blindIndex('9876500002@ybl', 'upi');
  const b = blindIndex('  9876500002@YBL  ', 'upi'); // trimmed and lowercased
  assert.equal(a, b);
  assert.notEqual(a, blindIndex('9876500003@ybl', 'upi'));
  assert.ok(blindIndexMatches(a, '9876500002@ybl', 'upi'));
  assert.equal(blindIndexMatches(a, '9876500003@ybl', 'upi'), false);
});

test('the index is keyed, so a dump cannot be brute-forced', () => {
  const underV1 = blindIndex('9876500002@ybl', 'upi');
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V2, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv));
  // Indian UPI IDs are mostly phone-derived — a plain SHA-256 would fall to a
  // rainbow table of ten-digit numbers in minutes. The key is what prevents it.
  assert.notEqual(blindIndex('9876500002@ybl', 'upi'), underV1);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv));
});

test('the purpose separates indexes, so one cannot be correlated with another', () => {
  assert.notEqual(blindIndex('9876500002', 'upi'), blindIndex('9876500002', 'account'));
});

/* -------------------------------------------------------------- display */

test('the last four digits render without decrypting anything', () => {
  assert.equal(lastFour('50100234567890'), '7890');
  assert.equal(lastFour('5010 0234 5678 90'), '7890');
});

test('a UPI ID masks without losing its shape', () => {
  const masked = maskUpi('9876500002@ybl');
  // Asserted by shape, not by a hand-counted string: the first version of this
  // test miscounted the dots and failed against correct code.
  assert.match(masked, /^98•+02@ybl$/);
  assert.equal(masked.length, '9876500002@ybl'.length, 'masking changed the visible length');
  assert.equal(/\d{3}/.test(masked.split('@')[0]), false, 'three consecutive digits survived');

  assert.equal(maskUpi('ab@ybl'), 'ab@ybl'); // too short to mask meaningfully
  assert.equal(maskUpi('notaupi'), 'notaupi');
});

/* ------------------------------------------------------------- the TOTP */

test('an admin TOTP secret is bound to that admin', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const stored = encryptField(secret, ctx.totpSecret('admin1'));
  // A plaintext seed means anyone with database access can generate valid
  // codes, which makes the two-factor requirement decorative.
  assert.equal(stored.includes(secret), false);
  assert.equal(decryptField(stored, ctx.totpSecret('admin1')), secret);
  assert.throws(() => decryptField(stored, ctx.totpSecret('admin2')), EncryptionError);
});
