/**
 * Money and volume formatting for the browser.
 *
 * The API sends money as `{ paise, display }` and never as a float — see
 * `src/common/serialization.ts`. This file formats; it never does arithmetic on
 * a displayed value. Any sum that matters is computed on the server in paise.
 *
 * The one exception is a cart subtotal, which is arithmetic the member can
 * check by eye and which the server recomputes before charging anything. It is
 * done in paise here too, so the number shown matches the number charged.
 */

/** What the API sends for every money field. */
export interface MoneyView {
  paise: number;
  /** Rupees with two decimals, e.g. "599.50" — see src/common/serialization.ts. */
  amount: string;
  display: string;
}

/** Business volume, carried as centi-BV so 0.5 BV is representable. */
export interface VolumeView {
  centi: number;
  display: string;
}

/**
 * Rupees, grouped the Indian way: ₹1,23,456 — lakhs and crores, not thousands.
 *
 * `en-IN` does this correctly in every browser that matters. Worth being exact
 * about: ₹1,23,456 rendered as ₹123,456 reads as a different number to the
 * audience, and this is a site where members check their own balance daily.
 */
export function formatRupees(paise: number, opts: { paise?: boolean } = {}): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.paise ? 2 : 0,
    maximumFractionDigits: opts.paise ? 2 : 0,
  }).format(rupees);
}

/** Prefers the server's own string, so one place decides how money reads. */
export const showMoney = (m: MoneyView | null | undefined): string =>
  m?.display ?? formatRupees(0);

export const showVolume = (v: VolumeView | null | undefined): string =>
  v?.display ?? '0 BV';

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

/** Cart arithmetic, in paise. Never on a formatted string. */
export const lineTotalPaise = (pricePaise: number, quantity: number): number =>
  pricePaise * quantity;

export const sumPaise = (values: number[]): number =>
  values.reduce((total, v) => total + v, 0);

/** "20% off" — for a discount badge. Floors, so it never overstates the saving. */
export function discountPercent(mrpPaise: number, pricePaise: number): number | null {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return null;
  return Math.floor(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

/**
 * Dates as a member reads them.
 *
 * Asia/Kolkata explicitly: the server sends UTC, the audience is in India, and
 * an order placed at 1am IST must not display as the previous day.
 */
export function formatDate(iso: string | Date, opts: { time?: boolean } = {}): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(opts.time ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
  }).format(d);
}

/**
 * Parse what a member typed into integer paise.
 *
 * `Math.round(Number(input) * 100)` looks equivalent and is not: floats make
 * some two-decimal rupee values land a paisa off, and on a wallet that funds
 * every order the member will eventually notice. This splits on the decimal
 * point and works in integers throughout.
 *
 * Returns 0 for anything unparseable, so a caller can treat 0 as "not a valid
 * amount yet" without a second check.
 */
export function parseRupeeInput(input: string): number {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return 0;
  // One optional decimal point, digits either side. Rejects "1.2.3", "1e3",
  // "-5" and "₹100" rather than coercing them into something plausible.
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return 0;

  const [whole = '', frac = ''] = trimmed.split('.');
  // More than two decimals is truncated, never rounded up: crediting a paisa
  // the member did not pay is the wrong direction to be wrong in.
  const paise = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  return Number.isSafeInteger(paise) && paise >= 0 ? paise : 0;
}
