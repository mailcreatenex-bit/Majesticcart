import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP for admin two-factor, per RFC 6238 (which builds on HOTP, RFC 4226).
 *
 * Verified against the published RFC test vectors in src/__tests__/auth.spec.ts.
 * otplib is a perfectly good alternative; the part it does not solve for you is
 * replay prevention, which is why verifyTotp() returns the accepted time step
 * for the caller to persist. See AdminUser.lastTotpStep.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '='; // RFC 4648 padding
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`"${ch}" is not valid base32`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, the RFC 4226 recommendation and what authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export interface TotpOptions {
  digits?: number;
  stepSeconds?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

/** HOTP: a truncated HMAC over a big-endian counter. */
export function hotp(secret: Buffer, counter: number, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const mac = createHmac(opts.algorithm ?? 'sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f; // dynamic truncation
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (atMs: number, stepSeconds = 30): number =>
  Math.floor(atMs / 1000 / stepSeconds);

export function totp(secretBase32: string, atMs: number = Date.now(), opts: TotpOptions = {}): string {
  return hotp(base32Decode(secretBase32), totpStep(atMs, opts.stepSeconds ?? 30), opts);
}

export interface TotpVerifyResult {
  valid: boolean;
  /** The accepted step. Persist it: a code must never be usable twice. */
  step?: number;
  reason?: 'BAD_CODE' | 'REPLAYED';
}

/**
 * Verify a code, tolerating one step of clock drift in each direction.
 *
 * lastAcceptedStep is the replay guard. A TOTP code stays valid for its whole
 * 30-second window, so without it a code read over someone's shoulder — or
 * captured by a proxy — can be used again seconds later. Refusing any step at
 * or below the last accepted one closes that window.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: TotpOptions & { atMs?: number; window?: number; lastAcceptedStep?: number | null } = {},
): TotpVerifyResult {
  const digits = opts.digits ?? 6;
  const candidate = (code ?? '').trim().replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return { valid: false, reason: 'BAD_CODE' };

  const secret = base32Decode(secretBase32);
  const stepSeconds = opts.stepSeconds ?? 30;
  const current = totpStep(opts.atMs ?? Date.now(), stepSeconds);
  const window = opts.window ?? 1;

  for (let drift = -window; drift <= window; drift++) {
    const step = current + drift;
    const expected = hotp(secret, step, opts);
    // Constant-time: a timing oracle on a 6-digit code is a real attack.
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (opts.lastAcceptedStep != null && step <= opts.lastAcceptedStep) {
        return { valid: false, reason: 'REPLAYED' };
      }
      return { valid: true, step };
    }
  }
  return { valid: false, reason: 'BAD_CODE' };
}

/** otpauth:// URI for the QR an authenticator app scans during enrolment. */
export function totpProvisioningUri(args: {
  secretBase32: string;
  accountName: string;
  issuer: string;
  digits?: number;
  stepSeconds?: number;
}): string {
  const label = encodeURIComponent(`${args.issuer}:${args.accountName}`);
  const params = new URLSearchParams({
    secret: args.secretBase32.replace(/=+$/, ''),
    issuer: args.issuer,
    algorithm: 'SHA1',
    digits: String(args.digits ?? 6),
    period: String(args.stepSeconds ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * The enrolment QR as an SVG data URL, same renderer and reasoning as the UPI
 * QR: built server-side from a value the server already holds, not the
 * browser, so a compromised client can't swap in a QR for someone else's
 * secret.
 */
export async function totpQrSvg(otpauthUrl: string): Promise<string> {
  const { toString } = await import('qrcode');
  const svg = await toString(otpauthUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 256 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
