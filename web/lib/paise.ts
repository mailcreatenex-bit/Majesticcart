/**
 * Every `paise` field arrives from the API as a decimal string, not a number
 * — `src/common/serialization.ts` sends bigints that way because a JS number
 * loses precision past about ₹9,00,00,000. Every `MoneyView` on this side of
 * the fence is typed `paise: number` and every comparison in this codebase
 * (`checkoutBlock`, `ProductCard`'s discount badge, the shop's price filter)
 * relies on that. Left as a string, `walletPaise < duePaise` compares two
 * strings lexicographically instead of numerically. Real money amounts here
 * never approach the precision limit, so converting on the way in is safe
 * and keeps every call site typed and used as originally written.
 *
 * No 'use client' here on purpose: this is imported both by lib/api.ts (the
 * browser client) and lib/catalog.ts (server-only fetches at build time), and
 * neither needs it tagged as a client boundary.
 */
export function paiseReviver(key: string, value: unknown): unknown {
  if (key === 'paise' && typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  return value;
}
