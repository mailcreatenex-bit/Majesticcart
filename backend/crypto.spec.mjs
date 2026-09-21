// src/__tests__/crypto.spec.ts
import assert from "node:assert/strict";
import { test, before } from "node:test";
import { randomBytes as randomBytes2 } from "node:crypto";

// src/common/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
var ALGORITHM = "aes-256-gcm";
var IV_BYTES = 12;
var KEY_BYTES = 32;
var EncryptionError = class extends Error {
};
var keyring = null;
function loadKeyring(env = process.env) {
  const parseKey = (raw, label) => {
    const key = Buffer.from(raw, "base64");
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError(`${label} must be exactly ${KEY_BYTES} bytes of base64 (got ${key.length}). Generate one with: openssl rand -base64 32`);
    }
    return key;
  };
  const currentRaw = env.FIELD_ENCRYPTION_KEY;
  if (!currentRaw) {
    if (env.NODE_ENV === "production") {
      throw new EncryptionError("FIELD_ENCRYPTION_KEY is required in production. Payout details and TOTP secrets cannot be stored without it.");
    }
    throw new EncryptionError("FIELD_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const version = Number(env.FIELD_ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new EncryptionError("FIELD_ENCRYPTION_KEY_VERSION must be a positive integer");
  const all = /* @__PURE__ */ new Map();
  all.set(version, parseKey(currentRaw, "FIELD_ENCRYPTION_KEY"));
  for (const [name, value] of Object.entries(env)) {
    const m = /^FIELD_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (m && value) {
      const v = Number(m[1]);
      if (v !== version) all.set(v, parseKey(value, name));
    }
  }
  return { current: { version, key: all.get(version) }, all };
}
function initEncryption(env = process.env) {
  keyring = loadKeyring(env);
}
function setKeyringForTesting(ring2) {
  keyring = ring2;
}
function ring() {
  if (!keyring) keyring = loadKeyring();
  return keyring;
}
var b64 = (b) => b.toString("base64url");
var unb64 = (s) => Buffer.from(s, "base64url");
function encryptField(plaintext, context) {
  if (typeof plaintext !== "string") throw new EncryptionError("Only strings can be encrypted");
  if (!context) throw new EncryptionError("An encryption context is required \u2014 it binds the value to its record");
  const { version, key } = ring().current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(`v${version}:${context}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v${version}:${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(ciphertext)}`;
}
function decryptField(stored, context) {
  if (!stored) throw new EncryptionError("Nothing to decrypt");
  const parts = stored.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new EncryptionError("That value is not in the expected encrypted format");
  }
  const version = Number(parts[0].slice(1));
  const key = ring().all.get(version);
  if (!key) {
    throw new EncryptionError(`No key for version ${version}. Set FIELD_ENCRYPTION_KEY_V${version} \u2014 retiring a key without keeping it orphans every row written under it.`);
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, unb64(parts[1]));
    decipher.setAAD(Buffer.from(`v${version}:${context}`, "utf8"));
    decipher.setAuthTag(unb64(parts[2]));
    return Buffer.concat([decipher.update(unb64(parts[3])), decipher.final()]).toString("utf8");
  } catch {
    throw new EncryptionError("This value could not be decrypted. It may have been altered or moved from another record.");
  }
}
var isEncrypted = (value) => !!value && /^v\d+:[\w-]+:[\w-]+:[\w-]+$/.test(value);
function encryptIfNeeded(value, context) {
  if (!value) return null;
  return isEncrypted(value) ? value : encryptField(value, context);
}
function decryptIfNeeded(value, context) {
  if (!value) return null;
  return isEncrypted(value) ? decryptField(value, context) : value;
}
function blindIndex(value, purpose) {
  const { key } = ring().current;
  return createHmac("sha256", key).update(`${purpose}:${value.trim().toLowerCase()}`).digest("base64url");
}
function blindIndexMatches(stored, value, purpose) {
  const a = Buffer.from(stored);
  const b = Buffer.from(blindIndex(value, purpose));
  return a.length === b.length && timingSafeEqual(a, b);
}
var lastFour = (accountNumber) => accountNumber.replace(/\D/g, "").slice(-4);
function maskUpi(upi) {
  const [handle, provider] = upi.split("@");
  if (!provider || handle.length <= 4) return upi;
  return `${handle.slice(0, 2)}${"\u2022".repeat(Math.max(3, handle.length - 4))}${handle.slice(-2)}@${provider}`;
}
function rotateField(stored, context) {
  const version = Number(stored.split(":")[0].slice(1));
  if (version === ring().current.version) return stored;
  return encryptField(decryptField(stored, context), context);
}
var needsRotation = (stored) => isEncrypted(stored) && Number(stored.split(":")[0].slice(1)) !== ring().current.version;
var ctx = {
  payoutAccount: (memberId) => `payout:${memberId}:account`,
  payoutUpi: (memberId) => `payout:${memberId}:upi`,
  payoutIfsc: (memberId) => `payout:${memberId}:ifsc`,
  totpSecret: (adminId) => `admin:${adminId}:totp`
};

// src/__tests__/crypto.spec.ts
var KEY_V1 = randomBytes2(32).toString("base64");
var KEY_V2 = randomBytes2(32).toString("base64");
before(() => {
  initEncryption({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: "1" });
});
test("a bank account round trips", () => {
  const account = "50100234567890";
  const stored = encryptField(account, ctx.payoutAccount("m1"));
  assert.notEqual(stored, account);
  assert.equal(stored.includes(account), false, "the plaintext is visible in the ciphertext");
  assert.equal(decryptField(stored, ctx.payoutAccount("m1")), account);
});
test("the same value encrypts differently every time", () => {
  const a = encryptField("50100234567890", ctx.payoutAccount("m1"));
  const b = encryptField("50100234567890", ctx.payoutAccount("m1"));
  assert.notEqual(a, b);
  assert.equal(decryptField(a, ctx.payoutAccount("m1")), decryptField(b, ctx.payoutAccount("m1")));
});
test("unicode and long values survive", () => {
  for (const value of ["\u09AA\u09CD\u09B0\u09BF\u09AF\u09BC\u09BE@ybl", "9876500002@paytm", "x".repeat(2e3), ""]) {
    const stored = encryptField(value, "test:1:field");
    assert.equal(decryptField(stored, "test:1:field"), value);
  }
});
test("an encrypted value cannot be moved to another member", () => {
  const victim = encryptField("50100234567890", ctx.payoutAccount("victim"));
  assert.throws(
    () => decryptField(victim, ctx.payoutAccount("attacker")),
    /altered or moved from another record/
  );
  assert.equal(decryptField(victim, ctx.payoutAccount("victim")), "50100234567890");
});
test("a value cannot be moved between columns of the same record either", () => {
  const upi = encryptField("9876500002@ybl", ctx.payoutUpi("m1"));
  assert.throws(() => decryptField(upi, ctx.payoutAccount("m1")), EncryptionError);
});
test("tampering with the ciphertext is detected, not decrypted into garbage", () => {
  const stored = encryptField("50100234567890", ctx.payoutAccount("m1"));
  const [v, iv, tag, ct] = stored.split(":");
  const flipped = Buffer.from(ct, "base64url");
  flipped[0] ^= 255;
  assert.throws(() => decryptField(`${v}:${iv}:${tag}:${flipped.toString("base64url")}`, ctx.payoutAccount("m1")), EncryptionError);
  assert.throws(() => decryptField(`${v}:${iv}:${Buffer.alloc(16).toString("base64url")}:${ct}`, ctx.payoutAccount("m1")), EncryptionError);
});
test("malformed stored values are rejected cleanly", () => {
  for (const bad of ["", "plaintext", "v1:only:three", "nope:a:b:c"]) {
    assert.throws(() => decryptField(bad, "test:1:field"), EncryptionError);
  }
});
test("a missing or wrong-sized key fails at load, not at first use", () => {
  assert.throws(() => loadKeyring({}), /FIELD_ENCRYPTION_KEY is not set/);
  assert.throws(
    () => loadKeyring({ NODE_ENV: "production" }),
    /required in production/
  );
  assert.throws(
    () => loadKeyring({ FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    /must be exactly 32 bytes/
  );
});
test("a value encrypted under a different key cannot be read", () => {
  const stored = encryptField("secret", "test:1:field");
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V2, FIELD_ENCRYPTION_KEY_VERSION: "1" }));
  assert.throws(() => decryptField(stored, "test:1:field"), EncryptionError);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: "1" }));
});
test("rotating a key leaves old rows readable and new writes on the new key", () => {
  const account = "50100234567890";
  const context = ctx.payoutAccount("m1");
  const underV1 = encryptField(account, context);
  assert.equal(needsRotation(underV1), false);
  setKeyringForTesting(loadKeyring({
    FIELD_ENCRYPTION_KEY: KEY_V2,
    FIELD_ENCRYPTION_KEY_VERSION: "2",
    FIELD_ENCRYPTION_KEY_V1: KEY_V1
  }));
  assert.equal(decryptField(underV1, context), account);
  assert.equal(needsRotation(underV1), true);
  const rotated = rotateField(underV1, context);
  assert.ok(rotated.startsWith("v2:"));
  assert.equal(decryptField(rotated, context), account);
  assert.equal(needsRotation(rotated), false);
  assert.equal(rotateField(rotated, context), rotated);
});
test("retiring a key without keeping it is reported, not silently swallowed", () => {
  const orphan = "v9:" + ["a", "b", "c"].map((c) => Buffer.from(c.repeat(12)).toString("base64url")).join(":");
  assert.throws(() => decryptField(orphan, "test:1:field"), /No key for version 9/);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: "1" }));
});
test("encrypting is idempotent, so a backfill can be re-run", () => {
  const once = encryptIfNeeded("9876500002@ybl", ctx.payoutUpi("m1"));
  const twice = encryptIfNeeded(once, ctx.payoutUpi("m1"));
  assert.equal(once, twice, "the value was encrypted a second time");
  assert.equal(decryptIfNeeded(twice, ctx.payoutUpi("m1")), "9876500002@ybl");
});
test("plaintext left over from before the migration still reads", () => {
  assert.equal(decryptIfNeeded("9876500002@ybl", ctx.payoutUpi("m1")), "9876500002@ybl");
  assert.equal(isEncrypted("9876500002@ybl"), false);
  assert.equal(encryptIfNeeded(null, "x"), null);
});
test("a blind index is deterministic, so it can be searched", () => {
  const a = blindIndex("9876500002@ybl", "upi");
  const b = blindIndex("  9876500002@YBL  ", "upi");
  assert.equal(a, b);
  assert.notEqual(a, blindIndex("9876500003@ybl", "upi"));
  assert.ok(blindIndexMatches(a, "9876500002@ybl", "upi"));
  assert.equal(blindIndexMatches(a, "9876500003@ybl", "upi"), false);
});
test("the index is keyed, so a dump cannot be brute-forced", () => {
  const underV1 = blindIndex("9876500002@ybl", "upi");
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V2, FIELD_ENCRYPTION_KEY_VERSION: "1" }));
  assert.notEqual(blindIndex("9876500002@ybl", "upi"), underV1);
  setKeyringForTesting(loadKeyring({ FIELD_ENCRYPTION_KEY: KEY_V1, FIELD_ENCRYPTION_KEY_VERSION: "1" }));
});
test("the purpose separates indexes, so one cannot be correlated with another", () => {
  assert.notEqual(blindIndex("9876500002", "upi"), blindIndex("9876500002", "account"));
});
test("the last four digits render without decrypting anything", () => {
  assert.equal(lastFour("50100234567890"), "7890");
  assert.equal(lastFour("5010 0234 5678 90"), "7890");
});
test("a UPI ID masks without losing its shape", () => {
  const masked = maskUpi("9876500002@ybl");
  assert.match(masked, /^98•+02@ybl$/);
  assert.equal(masked.length, "9876500002@ybl".length, "masking changed the visible length");
  assert.equal(/\d{3}/.test(masked.split("@")[0]), false, "three consecutive digits survived");
  assert.equal(maskUpi("ab@ybl"), "ab@ybl");
  assert.equal(maskUpi("notaupi"), "notaupi");
});
test("an admin TOTP secret is bound to that admin", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const stored = encryptField(secret, ctx.totpSecret("admin1"));
  assert.equal(stored.includes(secret), false);
  assert.equal(decryptField(stored, ctx.totpSecret("admin1")), secret);
  assert.throws(() => decryptField(stored, ctx.totpSecret("admin2")), EncryptionError);
});
