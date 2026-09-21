/**
 * Billing period keys.
 *
 * Every process must run with TZ=Asia/Kolkata. A member in Kolkata buying at
 * 11pm on the 30th must land in that month, not the next one, and getMonth()
 * follows the process timezone — so the timezone is part of the correctness
 * of the monthly repurchase gate, not a formatting detail.
 */
export function isoPeriod(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
