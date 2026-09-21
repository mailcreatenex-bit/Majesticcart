/**
 * Integer money. Every rupee figure in this codebase is a bigint of paise and
 * every BV figure is an integer of centi-BV (BV x 100).
 *
 * Floats are banned in the money path. 0.1 + 0.2 !== 0.3, and on a ledger that
 * pays thousands of members a month that drift becomes a reconciliation
 * nightmare that is very hard to unwind after the fact.
 */

export type Paise = bigint;
export type BvCenti = number;
export type BasisPoints = number;

export const BP_DENOMINATOR = 10_000; // 100% = 10000bp
const PAISE_PER_RUPEE = 100n;
const CENTI_PER_BV = 100;

/* ------------------------------------------------------------ conversions */

export function rupeesToPaise(rupees: number | string): Paise {
  const s = String(rupees).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`"${rupees}" is not a rupee amount with at most 2 decimals`);
  }
  const negative = s.startsWith('-');
  const [whole, frac = ''] = (negative ? s.slice(1) : s).split('.');
  const paise = BigInt(whole) * PAISE_PER_RUPEE + BigInt(frac.padEnd(2, '0'));
  return negative ? -paise : paise;
}

export function paiseToRupeeString(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / PAISE_PER_RUPEE;
  const frac = abs % PAISE_PER_RUPEE;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

/** For display only. Never feed the result back into arithmetic. */
export function formatInr(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = (abs / PAISE_PER_RUPEE).toString();
  const frac = (abs % PAISE_PER_RUPEE).toString().padStart(2, '0');
  const [last3, ...rest] = [whole.slice(-3), whole.slice(0, -3)].filter(Boolean);
  const head = rest.length ? rest[0].replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '';
  return `₹${head}${last3}${frac === '00' ? '' : '.' + frac}`;
}

export function bvToCenti(bv: number | string): BvCenti {
  const s = String(bv).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${bv}" is not a valid BV`);
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * CENTI_PER_BV + Number(frac.padEnd(2, '0'));
}

export function centiToBvString(centi: BvCenti): string {
  const whole = Math.trunc(centi / CENTI_PER_BV);
  const frac = Math.abs(centi % CENTI_PER_BV);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

export function percentToBp(pct: number): BasisPoints {
  const bp = Math.round(pct * 100);
  if (!Number.isFinite(bp)) throw new Error(`"${pct}" is not a percentage`);
  return bp;
}

export const bpToPercent = (bp: BasisPoints): number => bp / 100;

/* ------------------------------------------------------------ commission math */

export interface Split {
  /** What actually gets posted to the ledger. */
  amountPaise: Paise;
  /** Sub-paise dust dropped by rounding. Summed per run for reconciliation. */
  remainderPaise: Paise;
}

/**
 * Commission on a volume.
 *
 * The plan treats 1 BV as ₹1, so centi-BV and paise share a scale and no
 * currency conversion is needed here. If the client ever sets a BV that is not
 * 1:1 with the rupee, this is the single function that changes.
 *
 * Rounds DOWN. A half-paise rounded up on every leg of a deep genealogy quietly
 * overpays the company's liability, and the dust is returned here so the
 * reconciliation report can account for every last paise.
 */
export function commissionOn(bvCenti: BvCenti, pctBp: BasisPoints): Split {
  if (!Number.isInteger(bvCenti) || bvCenti < 0) throw new Error(`bad bvCenti: ${bvCenti}`);
  if (!Number.isInteger(pctBp) || pctBp < 0) throw new Error(`bad pctBp: ${pctBp}`);
  const numerator = BigInt(bvCenti) * BigInt(pctBp);
  const amountPaise = numerator / BigInt(BP_DENOMINATOR);
  return { amountPaise, remainderPaise: numerator % BigInt(BP_DENOMINATOR) };
}

/** Percentage of a money amount — withdrawal deductions, GST, and so on. */
export function pctOfPaise(paise: Paise, pctBp: BasisPoints): Split {
  const numerator = paise * BigInt(pctBp);
  return {
    amountPaise: numerator / BigInt(BP_DENOMINATOR),
    remainderPaise: numerator % BigInt(BP_DENOMINATOR),
  };
}

/**
 * GST already baked into a tax-inclusive price.
 * At 18%, ₹599 inclusive carries ₹91.37 of tax.
 */
export function gstInclusiveComponent(inclusivePaise: Paise, gstBp: BasisPoints): Paise {
  const denom = BigInt(BP_DENOMINATOR + gstBp);
  return (inclusivePaise * BigInt(gstBp)) / denom;
}

/**
 * Split a pool equally without inventing or losing money. The floor share goes
 * to everyone; the leftover paise go one each to the first N members by the
 * caller's ordering (use a stable one — member code, not a Set).
 */
export function splitPool(poolPaise: Paise, headCount: number): { perHead: Paise; extras: number } {
  if (headCount <= 0) throw new Error('cannot split a pool between nobody');
  const heads = BigInt(headCount);
  return { perHead: poolPaise / heads, extras: Number(poolPaise % heads) };
}

export const sumPaise = (xs: Paise[]): Paise => xs.reduce((a, b) => a + b, 0n);
