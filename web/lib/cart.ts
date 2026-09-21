/**
 * The bag.
 *
 * Pure functions plus a localStorage-backed store. No React, no DOM beyond the
 * storage handle it is passed, so all of it is testable without a browser.
 *
 * What the cart stores, and what it deliberately does not:
 *
 *   • It stores **slug, quantity and a price snapshot**. The snapshot is for
 *     display only — so a bag restored a week later can show something rather
 *     than nothing while the real prices load.
 *   • It is **never the basis for what is charged.** Checkout sends product ids
 *     and quantities; the server prices the order from the catalogue. A cart
 *     that could set its own prices is a cart that will.
 *
 * That split is the whole design. Everything else here is bookkeeping.
 */

export interface CartLine {
  slug: string;
  productId: string;
  quantity: number;
  /** Display-only snapshot. Never sent to the server, never trusted. */
  snapshot: {
    name: string;
    pricePaise: number;
    mrpPaise: number;
    bvCenti: number;
    imageUrl?: string;
    category?: string;
  };
  addedAt: number;
}

export interface Cart {
  lines: CartLine[];
  updatedAt: number;
}

export const EMPTY_CART: Cart = { lines: [], updatedAt: 0 };

export const CART_STORAGE_KEY = 'mc.cart.v1';

/** One member can reasonably want a few of something; 99 is a typo. */
export const MAX_QUANTITY = 20;
/** Distinct products, not units. Past this it is a data-entry error. */
export const MAX_LINES = 30;

/* ------------------------------------------------------------ mutations */

const clampQty = (n: number): number => {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(Math.floor(n), MAX_QUANTITY));
};

/**
 * Add, or increase an existing line.
 *
 * Adding something already in the bag increases its quantity rather than
 * appending a second line — two lines for one product is a bug the member has
 * to fix by hand, and it makes the subtotal look wrong even when it is not.
 */
export function addLine(cart: Cart, line: Omit<CartLine, 'addedAt' | 'quantity'> & { quantity?: number }, now = Date.now()): Cart {
  const quantity = clampQty(line.quantity ?? 1);
  const existing = cart.lines.find((l) => l.productId === line.productId);

  if (existing) {
    return setQuantity(cart, line.productId, existing.quantity + quantity, now);
  }
  if (cart.lines.length >= MAX_LINES) return cart;

  return {
    lines: [...cart.lines, { ...line, quantity, addedAt: now }],
    updatedAt: now,
  };
}

export function setQuantity(cart: Cart, productId: string, quantity: number, now = Date.now()): Cart {
  // Zero or less removes the line. It is what a member means when they tap the
  // minus button on a quantity of one.
  if (quantity <= 0) return removeLine(cart, productId, now);

  return {
    lines: cart.lines.map((l) => (l.productId === productId ? { ...l, quantity: clampQty(quantity) } : l)),
    updatedAt: now,
  };
}

export function removeLine(cart: Cart, productId: string, now = Date.now()): Cart {
  const lines = cart.lines.filter((l) => l.productId !== productId);
  if (lines.length === cart.lines.length) return cart;
  return { lines, updatedAt: now };
}

export const clearCart = (now = Date.now()): Cart => ({ lines: [], updatedAt: now });

/* --------------------------------------------------------------- totals */

export interface CartTotals {
  itemCount: number;
  lineCount: number;
  subtotalPaise: number;
  mrpTotalPaise: number;
  savingsPaise: number;
  bvCenti: number;
}

/**
 * Totals in paise, from the snapshot.
 *
 * Integer arithmetic throughout, matching the server. Floating-point rupees
 * would show ₹1,799.99 against a charge of ₹1,800 — a one-paisa gap that costs
 * nothing and destroys trust in every other number on the page.
 *
 * GST is not computed here. It depends on the delivery state (CGST+SGST within
 * the state, IGST across it) which the cart does not know, so the checkout gets
 * it from the server rather than guessing.
 */
export function totals(cart: Cart): CartTotals {
  let subtotalPaise = 0;
  let mrpTotalPaise = 0;
  let bvCenti = 0;
  let itemCount = 0;

  for (const l of cart.lines) {
    subtotalPaise += l.snapshot.pricePaise * l.quantity;
    mrpTotalPaise += l.snapshot.mrpPaise * l.quantity;
    bvCenti += l.snapshot.bvCenti * l.quantity;
    itemCount += l.quantity;
  }

  return {
    itemCount,
    lineCount: cart.lines.length,
    subtotalPaise,
    mrpTotalPaise,
    // Never negative: a price above MRP is a data error, not a negative saving.
    savingsPaise: Math.max(0, mrpTotalPaise - subtotalPaise),
    bvCenti,
  };
}

/** What checkout sends. Ids and quantities only — no prices. */
export const checkoutLines = (cart: Cart): { productId: string; quantity: number }[] =>
  cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));

/* -------------------------------------------------------- wallet gating */

export type CheckoutBlock =
  | { kind: 'empty' }
  | { kind: 'insufficient'; shortfallPaise: number }
  | { kind: 'address' }
  | null;

/**
 * Whether this bag can be checked out, and if not, why.
 *
 * This is the rule the whole site is built around: **nobody buys directly.**
 * There is no card, no netbanking, no cash on delivery. An order is paid from
 * the shopping wallet or it does not happen.
 *
 * So the interesting case is not "can they pay" but "how much short are they",
 * because that number is what the recharge page needs to pre-fill. A member who
 * is ₹240 short should not have to work out that they need ₹240.
 */
export function checkoutBlock(args: {
  cart: Cart;
  /** Shopping wallet balance in paise. Income wallet cannot buy. */
  shoppingBalancePaise: number;
  /** The total the server quoted, including GST and shipping. */
  payablePaise?: number;
  hasAddress: boolean;
}): CheckoutBlock {
  const { cart, shoppingBalancePaise, payablePaise, hasAddress } = args;

  if (cart.lines.length === 0) return { kind: 'empty' };
  if (!hasAddress) return { kind: 'address' };

  // Falls back to the subtotal before the server has quoted, so the button is
  // disabled from the first render rather than becoming disabled a moment
  // later — which reads as the page breaking.
  const due = payablePaise ?? totals(cart).subtotalPaise;
  if (shoppingBalancePaise < due) {
    return { kind: 'insufficient', shortfallPaise: due - shoppingBalancePaise };
  }

  return null;
}

/**
 * What to add to the wallet, rounded up to a whole rupee.
 *
 * A shortfall of ₹239.50 asks for ₹240. UPI apps take paise, but nobody types
 * them, and a recharge one paisa short of the order total is the most annoying
 * possible failure.
 */
export const rechargeSuggestion = (shortfallPaise: number): number =>
  Math.ceil(Math.max(0, shortfallPaise) / 100) * 100;

/* -------------------------------------------------------------- storage */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the bag.
 *
 * Every failure path returns an empty bag rather than throwing. Safari's
 * private mode throws on access, stored JSON can be corrupt, and a member's
 * bag is not worth a blank page — the worst case is they add their items again.
 */
export function readCart(storage: StorageLike | null | undefined): Cart {
  if (!storage) return EMPTY_CART;
  try {
    const raw = storage.getItem(CART_STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as unknown;
    return sanitise(parsed);
  } catch {
    return EMPTY_CART;
  }
}

export function writeCart(storage: StorageLike | null | undefined, cart: Cart): void {
  if (!storage) return;
  try {
    storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Quota exceeded or private mode. The in-memory cart still works for this
    // session, which is better than failing the click.
  }
}

/**
 * Coerce whatever was stored into a valid cart.
 *
 * Storage is attacker-controlled in the sense that matters: a member can edit
 * it, and a stale version of the app can have written a different shape. Rows
 * that do not make sense are dropped rather than repaired, because a repaired
 * price is a wrong price shown confidently.
 */
function sanitise(value: unknown): Cart {
  if (!value || typeof value !== 'object') return EMPTY_CART;
  const raw = value as { lines?: unknown; updatedAt?: unknown };
  if (!Array.isArray(raw.lines)) return EMPTY_CART;

  const seen = new Set<string>();
  const lines: CartLine[] = [];

  for (const entry of raw.lines) {
    if (!entry || typeof entry !== 'object') continue;
    const l = entry as Record<string, unknown>;
    const snap = (l.snapshot ?? {}) as Record<string, unknown>;

    const productId = typeof l.productId === 'string' ? l.productId : '';
    const slug = typeof l.slug === 'string' ? l.slug : '';
    if (!productId || !slug || seen.has(productId)) continue;

    const pricePaise = Number(snap.pricePaise);
    // A non-integer or negative price means the row was tampered with or
    // written by an older version. Dropping it is safe; keeping it is not.
    if (!Number.isInteger(pricePaise) || pricePaise < 0) continue;

    const mrpPaise = Number.isInteger(Number(snap.mrpPaise)) ? Number(snap.mrpPaise) : pricePaise;
    const bvCenti = Number.isInteger(Number(snap.bvCenti)) ? Math.max(0, Number(snap.bvCenti)) : 0;

    seen.add(productId);
    lines.push({
      productId,
      slug,
      quantity: clampQty(Number(l.quantity)),
      snapshot: {
        name: typeof snap.name === 'string' ? snap.name : slug,
        pricePaise,
        mrpPaise: Math.max(mrpPaise, pricePaise),
        bvCenti,
        imageUrl: typeof snap.imageUrl === 'string' ? snap.imageUrl : undefined,
        category: typeof snap.category === 'string' ? snap.category : undefined,
      },
      addedAt: Number.isFinite(Number(l.addedAt)) ? Number(l.addedAt) : 0,
    });

    if (lines.length >= MAX_LINES) break;
  }

  return { lines, updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0 };
}
