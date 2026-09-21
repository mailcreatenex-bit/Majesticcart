import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base32Encode, base32Decode, hotp, totp, totpStep, verifyTotp,
  generateTotpSecret, totpProvisioningUri,
} from '../auth/totp';
import {
  checkPasswordPolicy, generateOtpCode, hashOtpCode, otpMatches,
  hashToken, nextLockout, isLockedOut, lockoutMessage,
} from '../auth/credentials';
import {
  childPath, ancestorIds, uplineIds, downlinePrefix, isDescendantOf,
  assertNoCycle, rewriteSubtree, formatMemberCode, parseMemberCode, MAX_DEPTH,
} from '../member/genealogy';

/* ------------------------------------------------------------------ base32 */

test('base32 round trips and matches RFC 4648 vectors', () => {
  assert.equal(base32Encode(Buffer.from('f')), 'MY======');
  assert.equal(base32Encode(Buffer.from('fo')), 'MZXQ====');
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI======');
  assert.equal(base32Decode('MZXW6YTBOI======').toString(), 'foobar');

  for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'majestic cart secret']) {
    assert.equal(base32Decode(base32Encode(Buffer.from(s))).toString(), s);
  }
  assert.throws(() => base32Decode('MZXW6YTB01'), /not valid base32/); // 0 and 1 are excluded
});

/* -------------------------------------------------------------------- HOTP */

test('HOTP matches the RFC 4226 Appendix D test vectors', () => {
  const secret = Buffer.from('12345678901234567890');
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotp(secret, counter), code, `counter ${counter}`));
});

/* -------------------------------------------------------------------- TOTP */

test('TOTP matches the RFC 6238 Appendix B test vectors', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totp(secret, seconds * 1000, { digits: 8 }), code, `t=${seconds}`);
  }
});

test('a freshly generated secret produces a verifiable 6-digit code', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+=*$/);
  const now = Date.now();
  const code = totp(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, { atMs: now }).valid, true);
});

test('TOTP tolerates one step of clock drift either way, but not two', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totp(secret, now);

  assert.equal(verifyTotp(secret, code, { atMs: now + 30_000 }).valid, true); // one step late
  assert.equal(verifyTotp(secret, code, { atMs: now - 30_000 }).valid, true); // one step early
  assert.equal(verifyTotp(secret, code, { atMs: now + 90_000 }).valid, false); // three steps
});

test('a used TOTP code cannot be replayed inside its own window', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totp(secret, now);

  const first = verifyTotp(secret, code, { atMs: now });
  assert.equal(first.valid, true);
  assert.equal(first.step, totpStep(now));

  // Same code, 5 seconds later, still inside the 30-second window.
  const replay = verifyTotp(secret, code, { atMs: now + 5_000, lastAcceptedStep: first.step });
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, 'REPLAYED');

  // The next step's code still works.
  const nextCode = totp(secret, now + 30_000);
  assert.equal(verifyTotp(secret, nextCode, { atMs: now + 30_000, lastAcceptedStep: first.step }).valid, true);
});

test('malformed TOTP input is rejected without throwing', () => {
  const secret = generateTotpSecret();
  for (const bad of ['', '12345', '1234567', 'abcdef', '   ', '12 34 56']) {
    assert.equal(verifyTotp(secret, bad).valid, false);
  }
});

test('the provisioning URI carries what an authenticator app needs', () => {
  const uri = totpProvisioningUri({ secretBase32: 'JBSWY3DPEHPK3PXP', accountName: 'admin@majesticcart.in', issuer: 'Majestic Cart' });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=Majestic\+Cart/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

/* ---------------------------------------------------------- password policy */

test('short, numeric and common passwords are refused', () => {
  assert.equal(checkPasswordPolicy('abc123').ok, false);
  assert.equal(checkPasswordPolicy('12345678').ok, false);
  assert.equal(checkPasswordPolicy('password1').ok, false);
  assert.match(checkPasswordPolicy('87654321').problems.join(' '), /only numbers/);
});

test('a password containing the owner\'s own details is refused', () => {
  assert.equal(checkPasswordPolicy('9876500002xyz', { phone: '9876500002' }).ok, false);
  assert.equal(checkPasswordPolicy('priyasharma99', { name: 'Priya Sharma' }).ok, false);
  assert.equal(checkPasswordPolicy('ayan.dey@2026', { email: 'ayan.dey@cre8nex.in' }).ok, false);
  // A short name fragment must not trip it: "dey" is only 3 characters.
  assert.equal(checkPasswordPolicy('monsoonRiver7', { name: 'Ayan Dey' }).ok, true);
});

test('a reasonable passphrase passes', () => {
  assert.equal(checkPasswordPolicy('correct horse battery').ok, true);
  assert.equal(checkPasswordPolicy('Kolkata-Monsoon-88').ok, true);
});

/* ---------------------------------------------------------------- OTP codes */

test('OTP codes are six digits and keep their leading zeros', () => {
  for (let i = 0; i < 500; i++) assert.match(generateOtpCode(), /^\d{6}$/);
});

test('OTP verification works on the hash, with a pepper', () => {
  const pepper = 'a'.repeat(32);
  const hash = hashOtpCode('048213', pepper);

  assert.notEqual(hash, '048213'); // never stored in the clear
  assert.equal(otpMatches(hash, '048213', pepper), true);
  assert.equal(otpMatches(hash, '048214', pepper), false);
  // A leaked database without the pepper is not enough.
  assert.equal(otpMatches(hash, '048213', 'b'.repeat(32)), false);
});

test('refresh tokens are stored as hashes, not as themselves', () => {
  const token = 'abc123token';
  assert.notEqual(hashToken(token), token);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken('abc123toke'));
});

/* ------------------------------------------------------------------ lockout */

test('lockout kicks in on the fifth failure and backs off exponentially', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  let state = { failedLogins: 0, lockedUntil: null as Date | null };

  for (let i = 0; i < 4; i++) {
    state = nextLockout(state, 5, now);
    assert.equal(state.lockedUntil, null, `attempt ${i + 1} should not lock`);
  }
  state = nextLockout(state, 5, now); // fifth
  assert.equal(state.failedLogins, 5);
  assert.equal(state.lockedUntil!.getTime() - now.getTime(), 60_000); // 1 minute

  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil!.getTime() - now.getTime(), 120_000); // 2 minutes

  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil!.getTime() - now.getTime(), 240_000); // 4 minutes
});

test('backoff caps at an hour so an account cannot be locked out forever', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  let state = { failedLogins: 40, lockedUntil: null as Date | null };
  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil!.getTime() - now.getTime(), 60 * 60_000);
});

test('a lockout expires on its own', () => {
  const now = new Date('2026-09-12T10:00:00Z');
  const locked = { failedLogins: 5, lockedUntil: new Date(now.getTime() + 60_000) };
  assert.equal(isLockedOut(locked, now), true);
  assert.equal(isLockedOut(locked, new Date(now.getTime() + 61_000)), false);
  assert.match(lockoutMessage(locked, now), /try again in 1 minute/i);
});

/* --------------------------------------------------------------- genealogy */

const node = (id: string, ancestorPath: string, depth: number) => ({ id, ancestorPath, depth });

test('the company root sits at the top and its children hang off it', () => {
  const company = node('company', '/', 0);
  const priya = childPath(company);
  assert.deepEqual(priya, { ancestorPath: '/company/', depth: 1 });

  const ananya = childPath(node('priya', priya.ancestorPath, priya.depth));
  assert.deepEqual(ananya, { ancestorPath: '/company/priya/', depth: 2 });
});

test('the upline reads nearest-first, which is the order commission walks', () => {
  const path = '/company/priya/ananya/sneha/';
  assert.deepEqual(ancestorIds(path), ['company', 'priya', 'ananya', 'sneha']);
  assert.deepEqual(uplineIds(path), ['sneha', 'ananya', 'priya', 'company']);
});

test('a member with no upline yields an empty chain rather than a stray empty string', () => {
  assert.deepEqual(ancestorIds('/'), []);
  assert.deepEqual(uplineIds('/'), []);
});

test('the downline prefix cannot bleed into a similarly named member', () => {
  const m1 = node('m1', '/company/', 1);
  const m12 = node('m12', '/company/', 1);
  const childOfM12 = node('x', '/company/m12/', 2);

  assert.equal(downlinePrefix(m1), '/company/m1/');
  // Without the trailing slash, "m1" would match "m12" and misroute commission.
  assert.equal(isDescendantOf(childOfM12, m1), false);
  assert.equal(isDescendantOf(childOfM12, m12), true);
});

test('descendants are recognised at any depth', () => {
  const priya = node('priya', '/company/', 1);
  const deep = node('deep', '/company/priya/a/b/c/', 5);
  assert.equal(isDescendantOf(deep, priya), true);
  assert.equal(isDescendantOf(priya, deep), false);
});

test('a placement that would form a loop is refused', () => {
  const priya = node('priya', '/company/', 1);
  const ananya = node('ananya', '/company/priya/', 2);

  assert.throws(() => assertNoCycle(priya, priya), /cannot sponsor themselves/);
  assert.throws(() => assertNoCycle(priya, ananya), /would form a loop/);
  assert.doesNotThrow(() => assertNoCycle(ananya, node('rahul', '/company/', 1)));
});

test('the depth ceiling is enforced', () => {
  const deep = node('x', '/' + Array.from({ length: MAX_DEPTH }, (_, i) => `n${i}`).join('/') + '/', MAX_DEPTH);
  assert.throws(() => childPath(deep), /too deep/);
});

test('a malformed path is caught rather than silently producing a broken child', () => {
  assert.throws(() => childPath(node('x', 'company/', 1)), /Malformed ancestorPath/);
  assert.throws(() => childPath(node('x', '/company', 1)), /Malformed ancestorPath/);
});

test('re-parenting rewrites the whole subtree consistently', () => {
  const moved = node('ananya', '/company/priya/', 2);
  const newSponsor = node('rahul', '/company/', 1);
  const descendants = [
    node('sneha', '/company/priya/ananya/', 3),
    node('moumita', '/company/priya/ananya/sneha/', 4),
    node('unrelated', '/company/priya/', 2),
  ];

  const rows = rewriteSubtree(moved, newSponsor, descendants);
  assert.deepEqual(rows, [
    { id: 'ananya', ancestorPath: '/company/rahul/', depth: 2 },
    { id: 'sneha', ancestorPath: '/company/rahul/ananya/', depth: 3 },
    { id: 'moumita', ancestorPath: '/company/rahul/ananya/sneha/', depth: 4 },
  ]);
  // Every rewritten path still resolves to a sane upline.
  assert.deepEqual(uplineIds(rows[2].ancestorPath), ['sneha', 'ananya', 'rahul', 'company']);
});

test('member codes format and parse round trip', () => {
  assert.equal(formatMemberCode(100002), 'MC100002');
  assert.equal(parseMemberCode('MC100002'), 100002);
  assert.equal(parseMemberCode('mc100002'), 100002); // members type it in lowercase
  assert.equal(parseMemberCode('  MC100002  '), 100002);
  assert.equal(parseMemberCode('XX100002'), null);
  assert.equal(parseMemberCode('MC'), null);
});
