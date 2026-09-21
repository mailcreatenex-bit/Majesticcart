import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  safeNextPath, isIssuedTokens, withoutTokens, COOKIES,
  sessionCookieOptions, expiredCookieOptions,
} from '@/lib/session-shared';

/* ----------------------------------------------------- safeNextPath */

test('safeNextPath accepts an ordinary same-site path', () => {
  assert.equal(safeNextPath('/wallet'), '/wallet');
  assert.equal(safeNextPath('/orders/abc123?tab=returns'), '/orders/abc123?tab=returns');
});

test('safeNextPath rejects an absolute URL to another host', () => {
  // The exact attack this guards: a login link whose `next` points off-site,
  // so a real session gets handed to a page the visitor never meant to trust.
  assert.equal(safeNextPath('https://evil.example/phish'), null);
  assert.equal(safeNextPath('http://evil.example'), null);
});

test('safeNextPath rejects a protocol-relative URL', () => {
  // "//evil.example" has no scheme of its own, so the browser resolves it
  // against the current page's — which makes it a same-scheme, different-host
  // redirect that a naive "starts with /" check would wrongly allow.
  assert.equal(safeNextPath('//evil.example'), null);
  assert.equal(safeNextPath('///evil.example'), null);
});

test('safeNextPath rejects a path with no leading slash and empty input', () => {
  assert.equal(safeNextPath('wallet'), null);
  assert.equal(safeNextPath(''), null);
  assert.equal(safeNextPath(null), null);
  assert.equal(safeNextPath(undefined), null);
});

test('safeNextPath enforces an optional prefix', () => {
  assert.equal(safeNextPath('/admin/orders', { prefix: '/admin' }), '/admin/orders');
  assert.equal(safeNextPath('/account', { prefix: '/admin' }), null);
});

/* --------------------------------------------------- token shape checks */

test('isIssuedTokens recognises a login-shaped response', () => {
  assert.equal(isIssuedTokens({ accessToken: 'a', refreshToken: 'b', expiresIn: 900 }), true);
  assert.equal(isIssuedTokens({ accessToken: 'a', refreshToken: 'b' }), true);
});

test('isIssuedTokens rejects ordinary API payloads', () => {
  assert.equal(isIssuedTokens({ ok: true }), false);
  assert.equal(isIssuedTokens({ accessToken: 'a' }), false); // refreshToken missing
  assert.equal(isIssuedTokens(null), false);
  assert.equal(isIssuedTokens('a string'), false);
  assert.equal(isIssuedTokens([]), false);
});

test('withoutTokens strips both tokens and keeps everything else', () => {
  const body = { accessToken: 'a', refreshToken: 'b', memberCode: 'MC100002' };
  const stripped = withoutTokens(body);
  assert.deepEqual(stripped, { memberCode: 'MC100002' });
  assert.equal('accessToken' in stripped, false);
  assert.equal('refreshToken' in stripped, false);
});

/* -------------------------------------------------------- cookie options */

test('member and admin sessions use distinct cookie names', () => {
  // Distinct names, not just distinct values, is the point: an admin cookie
  // and a member cookie must never collide on the same key, or a shared
  // browser profile signed into both would clobber one session with the
  // other's token on every request.
  assert.notEqual(COOKIES.member.access, COOKIES.admin.access);
  assert.notEqual(COOKIES.member.refresh, COOKIES.admin.refresh);
  assert.notEqual(COOKIES.member.access, COOKIES.member.refresh);
});

test('session cookies are always httpOnly, same-site lax, and scoped to the whole site', () => {
  const opts = sessionCookieOptions(900);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.path, '/');
  assert.equal(opts.maxAge, 900);
});

test('expiredCookieOptions clears immediately', () => {
  assert.equal(expiredCookieOptions().maxAge, 0);
});
