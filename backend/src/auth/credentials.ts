import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Credential primitives.
 *
 * The prototype hashed passwords with SHA-256 in the browser, which is fine for
 * a demo and useless in production: it is fast, unsalted by default, and the
 * hash travels as the effective password. Everything here is server-side.
 */

/**
 * argon2id: memory-hard, so a GPU farm gains far less than it does against
 * bcrypt or PBKDF2. 19 MiB / 2 passes is the OWASP baseline. Raise memoryCost
 * on a box that can afford it and let needsRehash() migrate old hashes on login.
 */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, { ...ARGON_OPTIONS, raw: false });

/**
 * Never throws on a bad hash — a malformed stored hash must read as "wrong
 * password", not as a 500 that tells an attacker the account is special.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    // The stored digest carries its own parameters, so verify reads them from
    // the hash rather than from our current defaults. That is what lets the
    // cost settings be raised later without locking anyone out.
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export const passwordNeedsRehash = (hash: string): boolean => {
  try {
    return argon2.needsRehash(hash, ARGON_OPTIONS);
  } catch {
    return true;
  }
};

/* ------------------------------------------------------------ password policy */

export interface PolicyResult {
  ok: boolean;
  problems: string[];
}

/**
 * Length first, composition second.
 *
 * Deliberately no "must contain a symbol" rule: it pushes people toward
 * Password1! and away from anything memorable. A short blocklist of the
 * passwords that actually get sprayed does more good.
 */
const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty123', 'iloveyou',
  'admin123', 'welcome1', 'abc12345', 'india123', 'majestic', '11111111',
]);

export function checkPasswordPolicy(plain: string, context: { phone?: string; name?: string; email?: string } = {}): PolicyResult {
  const problems: string[] = [];
  const pw = plain ?? '';

  if (pw.length < 8) problems.push('Use at least 8 characters.');
  if (pw.length > 128) problems.push('Keep it under 128 characters.');
  if (/^\d+$/.test(pw)) problems.push("Don't use only numbers.");
  if (COMMON.has(pw.toLowerCase())) problems.push('That password is too common. Pick something else.');

  const lower = pw.toLowerCase();
  if (context.phone && lower.includes(context.phone.toLowerCase())) problems.push("Don't put your phone number in your password.");
  if (context.email && context.email.split('@')[0].length > 3 && lower.includes(context.email.split('@')[0].toLowerCase())) {
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

/* --------------------------------------------------------------------- OTP */

/**
 * randomInt, not Math.random. Math.random is seeded predictably enough that a
 * determined attacker can narrow a 6-digit space considerably.
 */
export const generateOtpCode = (digits = 6): string =>
  String(randomInt(0, 10 ** digits)).padStart(digits, '0');

/**
 * Stored as a hash, with a server-side pepper.
 *
 * The pepper lives in the environment rather than the database, so a dumped
 * OtpChallenge table alone cannot be brute-forced — six digits falls to a
 * trivial rainbow table otherwise.
 */
export const hashOtpCode = (code: string, pepper: string): string =>
  createHash('sha256').update(`${pepper}:${code}`).digest('hex');

export function otpMatches(storedHash: string, code: string, pepper: string): boolean {
  const candidate = Buffer.from(hashOtpCode(code, pepper));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/** Opaque refresh tokens are random, not JWTs; only the sha256 is stored. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/* ---------------------------------------------------------------- lockout */

export interface LockoutState {
  failedLogins: number;
  lockedUntil: Date | null;
}

/**
 * Exponential backoff after repeated failures: 1min, 2, 4, 8 … capped at an
 * hour. Slows credential stuffing without handing an attacker a cheap way to
 * lock a known member out permanently.
 */
export function nextLockout(state: LockoutState, threshold = 5, now: Date = new Date()): LockoutState {
  const failedLogins = state.failedLogins + 1;
  if (failedLogins < threshold) return { failedLogins, lockedUntil: state.lockedUntil };

  const overshoot = failedLogins - threshold;
  const minutes = Math.min(60, 2 ** overshoot);
  return { failedLogins, lockedUntil: new Date(now.getTime() + minutes * 60_000) };
}

export const isLockedOut = (state: LockoutState, now: Date = new Date()): boolean =>
  !!state.lockedUntil && state.lockedUntil.getTime() > now.getTime();

export function lockoutMessage(state: LockoutState, now: Date = new Date()): string {
  if (!state.lockedUntil) return 'Too many attempts. Try again shortly.';
  const minutes = Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 60_000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
