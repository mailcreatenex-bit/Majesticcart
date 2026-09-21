import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Field-level encryption for the handful of columns that must not be readable
 * from a database dump.
 *
 * Three things are encrypted:
 *   • payout bank account numbers — a dump otherwise hands over every member's
 *     account, which is both a fraud vector and a reportable breach
 *   • admin TOTP secrets — a plaintext seed means anyone with database access
 *     can generate valid codes, which makes the two-factor requirement theatre
 *   • UPI IDs, which are personal identifiers tied to a phone number
 *
 * AES-256-GCM, because it authenticates as well as encrypts: a tampered
 * ciphertext fails to decrypt rather than yielding plausible garbage.
 *
 * ── Why the AAD matters ──────────────────────────────────────────────────
 * Every value is bound to the record it belongs to. Without that binding,
 * encryption stops a dump being read but does nothing about an attacker with
 * write access copying one member's encrypted account number into another
 * member's row — the value still decrypts, and withdrawals start landing in
 * the wrong bank account. Binding makes that swap fail.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Format: v<keyVersion>:<iv>:<tag>:<ciphertext>, all base64url.
 * The version prefix is what makes key rotation possible without a migration:
 * old values keep decrypting under the old key while new writes use the new one.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM standard
const KEY_BYTES = 32;

export class EncryptionError extends Error {}

interface KeyRing {
  current: { version: number; key: Buffer };
  all: Map<number, Buffer>;
}

let keyring: KeyRing | null = null;

/**
 * Load keys from the environment.
 *
 *   FIELD_ENCRYPTION_KEY    the current key, base64, 32 bytes
 *   FIELD_ENCRYPTION_KEY_V1 previous keys, kept so old rows still decrypt
 *
 * Generate one with: openssl rand -base64 32
 */
export function loadKeyring(env: NodeJS.ProcessEnv = process.env): KeyRing {
  const parseKey = (raw: string, label: string): Buffer => {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError(`${label} must be exactly ${KEY_BYTES} bytes of base64 (got ${key.length}). Generate one with: openssl rand -base64 32`);
    }
    return key;
  };

  const currentRaw = env.FIELD_ENCRYPTION_KEY;
  if (!currentRaw) {
    // Fail at boot, not on the first member who saves a bank account.
    if (env.NODE_ENV === 'production') {
      throw new EncryptionError('FIELD_ENCRYPTION_KEY is required in production. Payout details and TOTP secrets cannot be stored without it.');
    }
    throw new EncryptionError('FIELD_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32');
  }

  const version = Number(env.FIELD_ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isInteger(version) || version < 1) throw new EncryptionError('FIELD_ENCRYPTION_KEY_VERSION must be a positive integer');

  const all = new Map<number, Buffer>();
  all.set(version, parseKey(currentRaw, 'FIELD_ENCRYPTION_KEY'));

  // Retired keys, so a rotation does not orphan existing rows.
  for (const [name, value] of Object.entries(env)) {
    const m = /^FIELD_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (m && value) {
      const v = Number(m[1]);
      if (v !== version) all.set(v, parseKey(value, name));
    }
  }

  return { current: { version, key: all.get(version)! }, all };
}

export function initEncryption(env: NodeJS.ProcessEnv = process.env): void {
  keyring = loadKeyring(env);
}

/** Test seam. */
export function setKeyringForTesting(ring: KeyRing | null): void {
  keyring = ring;
}

function ring(): KeyRing {
  if (!keyring) keyring = loadKeyring();
  return keyring;
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * Encrypt a value, bound to the record it belongs to.
 *
 * `context` should identify the row and column — for example
 * `payout:ckabc123:account`. It is authenticated but not stored, so the same
 * context must be supplied to decrypt.
 */
export function encryptField(plaintext: string, context: string): string {
  if (typeof plaintext !== 'string') throw new EncryptionError('Only strings can be encrypted');
  if (!context) throw new EncryptionError('An encryption context is required — it binds the value to its record');

  const { version, key } = ring().current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(`v${version}:${context}`, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v${version}:${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(ciphertext)}`;
}

export function decryptField(stored: string, context: string): string {
  if (!stored) throw new EncryptionError('Nothing to decrypt');
  const parts = stored.split(':');
  if (parts.length !== 4 || !parts[0].startsWith('v')) {
    throw new EncryptionError('That value is not in the expected encrypted format');
  }

  const version = Number(parts[0].slice(1));
  const key = ring().all.get(version);
  if (!key) {
    throw new EncryptionError(`No key for version ${version}. Set FIELD_ENCRYPTION_KEY_V${version} — retiring a key without keeping it orphans every row written under it.`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, unb64(parts[1]));
    decipher.setAAD(Buffer.from(`v${version}:${context}`, 'utf8'));
    decipher.setAuthTag(unb64(parts[2]));
    return Buffer.concat([decipher.update(unb64(parts[3])), decipher.final()]).toString('utf8');
  } catch {
    // Either the ciphertext was tampered with, or it was moved to a different
    // record. Both are the same answer: this value is not trustworthy.
    throw new EncryptionError('This value could not be decrypted. It may have been altered or moved from another record.');
  }
}

export const isEncrypted = (value: string | null | undefined): boolean =>
  !!value && /^v\d+:[\w-]+:[\w-]+:[\w-]+$/.test(value);

/** Encrypt only if it is not already encrypted. Makes backfills re-runnable. */
export function encryptIfNeeded(value: string | null | undefined, context: string): string | null {
  if (!value) return null;
  return isEncrypted(value) ? value : encryptField(value, context);
}

export function decryptIfNeeded(value: string | null | undefined, context: string): string | null {
  if (!value) return null;
  return isEncrypted(value) ? decryptField(value, context) : value;
}

/* ------------------------------------------------------------- lookups */

/**
 * Encrypted columns cannot be searched, because the same input produces
 * different ciphertext every time — which is the point.
 *
 * Where a lookup is genuinely needed (has this UPI ID been used by another
 * account?), store a keyed HMAC alongside the ciphertext. It is deterministic,
 * so it can be indexed and compared, and keyed, so a dump cannot be brute-forced
 * against the small space of Indian phone-number-derived UPI IDs the way a plain
 * SHA-256 could.
 */
export function blindIndex(value: string, purpose: string): string {
  const { key } = ring().current;
  return createHmac('sha256', key).update(`${purpose}:${value.trim().toLowerCase()}`).digest('base64url');
}

export function blindIndexMatches(stored: string, value: string, purpose: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(blindIndex(value, purpose));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The last four digits, kept in the clear for display.
 *
 * "Account ending 4417" has to render on a payout screen without decrypting
 * anything, and four digits alone identify nobody.
 */
export const lastFour = (accountNumber: string): string => accountNumber.replace(/\D/g, '').slice(-4);

/** Mask a UPI ID for display: "9876500002@ybl" becomes "98•••••02@ybl". */
export function maskUpi(upi: string): string {
  const [handle, provider] = upi.split('@');
  if (!provider || handle.length <= 4) return upi;
  return `${handle.slice(0, 2)}${'•'.repeat(Math.max(3, handle.length - 4))}${handle.slice(-2)}@${provider}`;
}

/* ----------------------------------------------------------- rotation */

/**
 * Re-encrypt a value under the current key.
 *
 * Rotation is: add the new key as FIELD_ENCRYPTION_KEY, move the old one to
 * FIELD_ENCRYPTION_KEY_V<n>, deploy, then run a backfill calling this. Old rows
 * keep working throughout, so the rotation needs no downtime and no big-bang
 * migration.
 */
export function rotateField(stored: string, context: string): string {
  const version = Number(stored.split(':')[0].slice(1));
  if (version === ring().current.version) return stored;
  return encryptField(decryptField(stored, context), context);
}

export const needsRotation = (stored: string): boolean =>
  isEncrypted(stored) && Number(stored.split(':')[0].slice(1)) !== ring().current.version;

/* ------------------------------------------------------------ contexts */

/** Context builders, so a typo cannot silently produce an unbindable value. */
export const ctx = {
  payoutAccount: (memberId: string) => `payout:${memberId}:account`,
  payoutUpi: (memberId: string) => `payout:${memberId}:upi`,
  payoutIfsc: (memberId: string) => `payout:${memberId}:ifsc`,
  totpSecret: (adminId: string) => `admin:${adminId}:totp`,
  storeSetting: (key: string) => `setting:${key}`,
} as const;
