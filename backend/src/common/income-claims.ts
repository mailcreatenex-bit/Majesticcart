/**
 * Blocks an income claim from ever being saved through the admin console.
 *
 * This is the same pattern web/lib/seo.ts enforces at build time for the
 * about/join/faq pages when their copy is hardcoded — duplicated here (the
 * backend and frontend are separate deploys with no shared package) because
 * that content moved into the CMS: it is admin-edited at runtime now, so the
 * check has to run where a save actually happens, not just at build time.
 * See ADR context in web/lib/seo.ts for why each pattern exists.
 */

const EARN_WORDS = 'earn|earning|earnings|income|profit|make money|कमाई|कमाएं|আয়|উপার্জন';
const PERIOD_WORDS = [
  'month', 'day', 'week', 'monthly', 'daily', 'weekly',
  'mahina', 'mahine', 'মাস', 'মাসে', 'দিনে', 'সপ্তাহে', 'महीने', 'महीना', 'दिन',
].join('|');
const DIGITS = '[\\d\\u09E6-\\u09EF\\u0966-\\u096F]';
const MONEY = `(?:₹|৳|\\b(?:rs\\.?|inr)|टका|টাকা|রুপি)\\s?${DIGITS}[${DIGITS.slice(1, -1)},]*`;

const INCOME_CLAIM_PATTERNS: { pattern: RegExp; note: string }[] = [
  { pattern: new RegExp(`(?:${EARN_WORDS})[^.!?]{0,40}${MONEY}`, 'iu'), note: 'a specific earnings figure' },
  { pattern: new RegExp(`${MONEY}[^.!?]{0,25}(?:${PERIOD_WORDS})`, 'iu'), note: 'a per-period earnings figure' },
  { pattern: new RegExp(`(?:${PERIOD_WORDS})[^.!?]{0,25}${MONEY}`, 'iu'), note: 'a per-period earnings figure' },
  { pattern: /\b(?:guaranteed|assured|fixed)\s+(?:income|earning|return|profit)/i, note: 'a guaranteed-income claim' },
  { pattern: /\b(?:passive income|financial freedom|quit your job|become a millionaire)\b/i, note: 'an income-opportunity claim' },
  { pattern: /\b(?:double|triple)\s+your\s+(?:money|investment)/i, note: 'an investment-return claim' },
];

export interface ClaimFinding {
  note: string;
  match: string;
}

export function findIncomeClaims(copy: string): ClaimFinding[] {
  const out: ClaimFinding[] = [];
  for (const { pattern, note } of INCOME_CLAIM_PATTERNS) {
    const m = pattern.exec(copy);
    if (m) out.push({ note, match: m[0].trim() });
  }
  return out;
}

/** Throws a message naming the offending phrase, meant to surface directly as the admin's save error. */
export function assertNoIncomeClaims(copy: string, where: string): void {
  const findings = findIncomeClaims(copy);
  if (findings.length > 0) {
    throw new Error(
      `${where} reads as ${findings.map((f) => `${f.note} ("${f.match}")`).join(', ')}. ` +
        'Income claims are not allowed on public pages — rewrite it without a figure or a guarantee.',
    );
  }
}
