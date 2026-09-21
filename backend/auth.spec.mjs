// src/__tests__/auth.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/auth/totp.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = value << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[value << 5 - bits & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}
function base32Decode(input) {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`"${ch}" is not valid base32`);
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}
function hotp(secret, counter, opts = {}) {
  const digits = opts.digits ?? 6;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(opts.algorithm ?? "sha1", secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac[offset] & 127) << 24 | (mac[offset + 1] & 255) << 16 | (mac[offset + 2] & 255) << 8 | mac[offset + 3] & 255;
  return String(code % 10 ** digits).padStart(digits, "0");
}
var totpStep = (atMs, stepSeconds = 30) => Math.floor(atMs / 1e3 / stepSeconds);
function totp(secretBase32, atMs = Date.now(), opts = {}) {
  return hotp(base32Decode(secretBase32), totpStep(atMs, opts.stepSeconds ?? 30), opts);
}
function verifyTotp(secretBase32, code, opts = {}) {
  const digits = opts.digits ?? 6;
  const candidate = (code ?? "").trim().replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return { valid: false, reason: "BAD_CODE" };
  const secret = base32Decode(secretBase32);
  const stepSeconds = opts.stepSeconds ?? 30;
  const current = totpStep(opts.atMs ?? Date.now(), stepSeconds);
  const window = opts.window ?? 1;
  for (let drift = -window; drift <= window; drift++) {
    const step = current + drift;
    const expected = hotp(secret, step, opts);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (opts.lastAcceptedStep != null && step <= opts.lastAcceptedStep) {
        return { valid: false, reason: "REPLAYED" };
      }
      return { valid: true, step };
    }
  }
  return { valid: false, reason: "BAD_CODE" };
}
function totpProvisioningUri(args) {
  const label = encodeURIComponent(`${args.issuer}:${args.accountName}`);
  const params = new URLSearchParams({
    secret: args.secretBase32.replace(/=+$/, ""),
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(args.digits ?? 6),
    period: String(args.stepSeconds ?? 30)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// src/auth/credentials.ts
import { createHash, randomInt, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import * as argon2 from "argon2";
var COMMON = /* @__PURE__ */ new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwerty123",
  "iloveyou",
  "admin123",
  "welcome1",
  "abc12345",
  "india123",
  "majestic",
  "11111111"
]);
function checkPasswordPolicy(plain, context = {}) {
  const problems = [];
  const pw = plain ?? "";
  if (pw.length < 8) problems.push("Use at least 8 characters.");
  if (pw.length > 128) problems.push("Keep it under 128 characters.");
  if (/^\d+$/.test(pw)) problems.push("Don't use only numbers.");
  if (COMMON.has(pw.toLowerCase())) problems.push("That password is too common. Pick something else.");
  const lower = pw.toLowerCase();
  if (context.phone && lower.includes(context.phone.toLowerCase())) problems.push("Don't put your phone number in your password.");
  if (context.email && context.email.split("@")[0].length > 3 && lower.includes(context.email.split("@")[0].toLowerCase())) {
    problems.push("Don't put your email in your password.");
  }
  if (context.name) {
    for (const part of context.name.toLowerCase().split(/\s+/)) {
      if (part.length > 3 && lower.includes(part)) {
        problems.push("Don't put your name in your password.");
        break;
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
var generateOtpCode = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, "0");
var hashOtpCode = (code, pepper) => createHash("sha256").update(`${pepper}:${code}`).digest("hex");
function otpMatches(storedHash, code, pepper) {
  const candidate = Buffer.from(hashOtpCode(code, pepper));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual2(candidate, stored);
}
var hashToken = (token) => createHash("sha256").update(token).digest("hex");
function nextLockout(state, threshold = 5, now = /* @__PURE__ */ new Date()) {
  const failedLogins = state.failedLogins + 1;
  if (failedLogins < threshold) return { failedLogins, lockedUntil: state.lockedUntil };
  const overshoot = failedLogins - threshold;
  const minutes = Math.min(60, 2 ** overshoot);
  return { failedLogins, lockedUntil: new Date(now.getTime() + minutes * 6e4) };
}
var isLockedOut = (state, now = /* @__PURE__ */ new Date()) => !!state.lockedUntil && state.lockedUntil.getTime() > now.getTime();
function lockoutMessage(state, now = /* @__PURE__ */ new Date()) {
  if (!state.lockedUntil) return "Too many attempts. Try again shortly.";
  const minutes = Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 6e4));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

// src/member/genealogy.ts
import { BadRequestException } from "@nestjs/common";
var MAX_DEPTH = 200;
function childPath(sponsor) {
  if (!sponsor.ancestorPath.startsWith("/") || !sponsor.ancestorPath.endsWith("/")) {
    throw new Error(`Malformed ancestorPath on ${sponsor.id}: "${sponsor.ancestorPath}"`);
  }
  const depth = sponsor.depth + 1;
  if (depth > MAX_DEPTH) {
    throw new BadRequestException("This sponsor sits too deep in the network. Contact support.");
  }
  return { ancestorPath: `${sponsor.ancestorPath}${sponsor.id}/`, depth };
}
var ancestorIds = (ancestorPath) => ancestorPath.split("/").filter(Boolean);
var uplineIds = (ancestorPath) => ancestorIds(ancestorPath).reverse();
var downlinePrefix = (member) => `${member.ancestorPath}${member.id}/`;
var isDescendantOf = (candidate, ancestor) => candidate.ancestorPath.startsWith(downlinePrefix(ancestor));
function assertNoCycle(member, newSponsor) {
  if (member.id === newSponsor.id) {
    throw new BadRequestException("A member cannot sponsor themselves.");
  }
  if (isDescendantOf(newSponsor, member)) {
    throw new BadRequestException("That sponsor is already in this member's downline. The placement would form a loop.");
  }
}
function rewriteSubtree(moved, newSponsor, descendants) {
  assertNoCycle(moved, newSponsor);
  const next = childPath(newSponsor);
  const oldPrefix = downlinePrefix(moved);
  const newPrefix = `${next.ancestorPath}${moved.id}/`;
  const depthShift = next.depth - moved.depth;
  const out = [{ id: moved.id, ancestorPath: next.ancestorPath, depth: next.depth }];
  for (const d of descendants) {
    if (!d.ancestorPath.startsWith(oldPrefix)) continue;
    out.push({
      id: d.id,
      ancestorPath: newPrefix + d.ancestorPath.slice(oldPrefix.length),
      depth: d.depth + depthShift
    });
  }
  return out;
}
var formatMemberCode = (n, prefix = "MC") => `${prefix}${n}`;
function parseMemberCode(code, prefix = "MC") {
  const m = new RegExp(`^${prefix}(\\d+)$`, "i").exec((code ?? "").trim());
  return m ? Number(m[1]) : null;
}

// src/__tests__/auth.spec.ts
test("base32 round trips and matches RFC 4648 vectors", () => {
  assert.equal(base32Encode(Buffer.from("f")), "MY======");
  assert.equal(base32Encode(Buffer.from("fo")), "MZXQ====");
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI======");
  assert.equal(base32Decode("MZXW6YTBOI======").toString(), "foobar");
  for (const s of ["", "a", "ab", "abc", "abcd", "abcde", "majestic cart secret"]) {
    assert.equal(base32Decode(base32Encode(Buffer.from(s))).toString(), s);
  }
  assert.throws(() => base32Decode("MZXW6YTB01"), /not valid base32/);
});
test("HOTP matches the RFC 4226 Appendix D test vectors", () => {
  const secret = Buffer.from("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(secret, counter), code, `counter ${counter}`));
});
test("TOTP matches the RFC 6238 Appendix B test vectors", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2e9, "69279037"],
    [2e10, "65353130"]
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totp(secret, seconds * 1e3, { digits: 8 }), code, `t=${seconds}`);
  }
});
test("a freshly generated secret produces a verifiable 6-digit code", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+=*$/);
  const now = Date.now();
  const code = totp(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, { atMs: now }).valid, true);
});
test("TOTP tolerates one step of clock drift either way, but not two", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totp(secret, now);
  assert.equal(verifyTotp(secret, code, { atMs: now + 3e4 }).valid, true);
  assert.equal(verifyTotp(secret, code, { atMs: now - 3e4 }).valid, true);
  assert.equal(verifyTotp(secret, code, { atMs: now + 9e4 }).valid, false);
});
test("a used TOTP code cannot be replayed inside its own window", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = totp(secret, now);
  const first = verifyTotp(secret, code, { atMs: now });
  assert.equal(first.valid, true);
  assert.equal(first.step, totpStep(now));
  const replay = verifyTotp(secret, code, { atMs: now + 5e3, lastAcceptedStep: first.step });
  assert.equal(replay.valid, false);
  assert.equal(replay.reason, "REPLAYED");
  const nextCode = totp(secret, now + 3e4);
  assert.equal(verifyTotp(secret, nextCode, { atMs: now + 3e4, lastAcceptedStep: first.step }).valid, true);
});
test("malformed TOTP input is rejected without throwing", () => {
  const secret = generateTotpSecret();
  for (const bad of ["", "12345", "1234567", "abcdef", "   ", "12 34 56"]) {
    assert.equal(verifyTotp(secret, bad).valid, false);
  }
});
test("the provisioning URI carries what an authenticator app needs", () => {
  const uri = totpProvisioningUri({ secretBase32: "JBSWY3DPEHPK3PXP", accountName: "admin@majesticcart.in", issuer: "Majestic Cart" });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=Majestic\+Cart/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
test("short, numeric and common passwords are refused", () => {
  assert.equal(checkPasswordPolicy("abc123").ok, false);
  assert.equal(checkPasswordPolicy("12345678").ok, false);
  assert.equal(checkPasswordPolicy("password1").ok, false);
  assert.match(checkPasswordPolicy("87654321").problems.join(" "), /only numbers/);
});
test("a password containing the owner's own details is refused", () => {
  assert.equal(checkPasswordPolicy("9876500002xyz", { phone: "9876500002" }).ok, false);
  assert.equal(checkPasswordPolicy("priyasharma99", { name: "Priya Sharma" }).ok, false);
  assert.equal(checkPasswordPolicy("ayan.dey@2026", { email: "ayan.dey@cre8nex.in" }).ok, false);
  assert.equal(checkPasswordPolicy("monsoonRiver7", { name: "Ayan Dey" }).ok, true);
});
test("a reasonable passphrase passes", () => {
  assert.equal(checkPasswordPolicy("correct horse battery").ok, true);
  assert.equal(checkPasswordPolicy("Kolkata-Monsoon-88").ok, true);
});
test("OTP codes are six digits and keep their leading zeros", () => {
  for (let i = 0; i < 500; i++) assert.match(generateOtpCode(), /^\d{6}$/);
});
test("OTP verification works on the hash, with a pepper", () => {
  const pepper = "a".repeat(32);
  const hash2 = hashOtpCode("048213", pepper);
  assert.notEqual(hash2, "048213");
  assert.equal(otpMatches(hash2, "048213", pepper), true);
  assert.equal(otpMatches(hash2, "048214", pepper), false);
  assert.equal(otpMatches(hash2, "048213", "b".repeat(32)), false);
});
test("refresh tokens are stored as hashes, not as themselves", () => {
  const token = "abc123token";
  assert.notEqual(hashToken(token), token);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken("abc123toke"));
});
test("lockout kicks in on the fifth failure and backs off exponentially", () => {
  const now = /* @__PURE__ */ new Date("2026-09-12T10:00:00Z");
  let state = { failedLogins: 0, lockedUntil: null };
  for (let i = 0; i < 4; i++) {
    state = nextLockout(state, 5, now);
    assert.equal(state.lockedUntil, null, `attempt ${i + 1} should not lock`);
  }
  state = nextLockout(state, 5, now);
  assert.equal(state.failedLogins, 5);
  assert.equal(state.lockedUntil.getTime() - now.getTime(), 6e4);
  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil.getTime() - now.getTime(), 12e4);
  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil.getTime() - now.getTime(), 24e4);
});
test("backoff caps at an hour so an account cannot be locked out forever", () => {
  const now = /* @__PURE__ */ new Date("2026-09-12T10:00:00Z");
  let state = { failedLogins: 40, lockedUntil: null };
  state = nextLockout(state, 5, now);
  assert.equal(state.lockedUntil.getTime() - now.getTime(), 60 * 6e4);
});
test("a lockout expires on its own", () => {
  const now = /* @__PURE__ */ new Date("2026-09-12T10:00:00Z");
  const locked = { failedLogins: 5, lockedUntil: new Date(now.getTime() + 6e4) };
  assert.equal(isLockedOut(locked, now), true);
  assert.equal(isLockedOut(locked, new Date(now.getTime() + 61e3)), false);
  assert.match(lockoutMessage(locked, now), /try again in 1 minute/i);
});
var node = (id, ancestorPath, depth) => ({ id, ancestorPath, depth });
test("the company root sits at the top and its children hang off it", () => {
  const company = node("company", "/", 0);
  const priya = childPath(company);
  assert.deepEqual(priya, { ancestorPath: "/company/", depth: 1 });
  const ananya = childPath(node("priya", priya.ancestorPath, priya.depth));
  assert.deepEqual(ananya, { ancestorPath: "/company/priya/", depth: 2 });
});
test("the upline reads nearest-first, which is the order commission walks", () => {
  const path = "/company/priya/ananya/sneha/";
  assert.deepEqual(ancestorIds(path), ["company", "priya", "ananya", "sneha"]);
  assert.deepEqual(uplineIds(path), ["sneha", "ananya", "priya", "company"]);
});
test("a member with no upline yields an empty chain rather than a stray empty string", () => {
  assert.deepEqual(ancestorIds("/"), []);
  assert.deepEqual(uplineIds("/"), []);
});
test("the downline prefix cannot bleed into a similarly named member", () => {
  const m1 = node("m1", "/company/", 1);
  const m12 = node("m12", "/company/", 1);
  const childOfM12 = node("x", "/company/m12/", 2);
  assert.equal(downlinePrefix(m1), "/company/m1/");
  assert.equal(isDescendantOf(childOfM12, m1), false);
  assert.equal(isDescendantOf(childOfM12, m12), true);
});
test("descendants are recognised at any depth", () => {
  const priya = node("priya", "/company/", 1);
  const deep = node("deep", "/company/priya/a/b/c/", 5);
  assert.equal(isDescendantOf(deep, priya), true);
  assert.equal(isDescendantOf(priya, deep), false);
});
test("a placement that would form a loop is refused", () => {
  const priya = node("priya", "/company/", 1);
  const ananya = node("ananya", "/company/priya/", 2);
  assert.throws(() => assertNoCycle(priya, priya), /cannot sponsor themselves/);
  assert.throws(() => assertNoCycle(priya, ananya), /would form a loop/);
  assert.doesNotThrow(() => assertNoCycle(ananya, node("rahul", "/company/", 1)));
});
test("the depth ceiling is enforced", () => {
  const deep = node("x", "/" + Array.from({ length: MAX_DEPTH }, (_, i) => `n${i}`).join("/") + "/", MAX_DEPTH);
  assert.throws(() => childPath(deep), /too deep/);
});
test("a malformed path is caught rather than silently producing a broken child", () => {
  assert.throws(() => childPath(node("x", "company/", 1)), /Malformed ancestorPath/);
  assert.throws(() => childPath(node("x", "/company", 1)), /Malformed ancestorPath/);
});
test("re-parenting rewrites the whole subtree consistently", () => {
  const moved = node("ananya", "/company/priya/", 2);
  const newSponsor = node("rahul", "/company/", 1);
  const descendants = [
    node("sneha", "/company/priya/ananya/", 3),
    node("moumita", "/company/priya/ananya/sneha/", 4),
    node("unrelated", "/company/priya/", 2)
  ];
  const rows = rewriteSubtree(moved, newSponsor, descendants);
  assert.deepEqual(rows, [
    { id: "ananya", ancestorPath: "/company/rahul/", depth: 2 },
    { id: "sneha", ancestorPath: "/company/rahul/ananya/", depth: 3 },
    { id: "moumita", ancestorPath: "/company/rahul/ananya/sneha/", depth: 4 }
  ]);
  assert.deepEqual(uplineIds(rows[2].ancestorPath), ["sneha", "ananya", "rahul", "company"]);
});
test("member codes format and parse round trip", () => {
  assert.equal(formatMemberCode(100002), "MC100002");
  assert.equal(parseMemberCode("MC100002"), 100002);
  assert.equal(parseMemberCode("mc100002"), 100002);
  assert.equal(parseMemberCode("  MC100002  "), 100002);
  assert.equal(parseMemberCode("XX100002"), null);
  assert.equal(parseMemberCode("MC"), null);
});
