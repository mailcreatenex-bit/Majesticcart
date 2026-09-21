import { BadRequestException } from '@nestjs/common';
import { Paise, BvCenti, gstInclusiveComponent, formatInr, centiToBvString } from '../common/money';
import { PlanConfig } from '../plan/plan.config';

/**
 * Order arithmetic and the checkout rules, with no database access.
 *
 * Split out from OrderService so the money maths can be tested exhaustively
 * without a Postgres instance. Everything here is a pure function.
 */

export interface PriceableItem {
  productId: string;
  name: string;
  pricePaise: Paise; // GST-inclusive shelf price
  mrpPaise: Paise;
  bvCenti: BvCenti;
  gstBp: number;
  quantity: number;
}

export interface OrderTotals {
  subtotalPaise: Paise; // net of GST
  gstPaise: Paise;
  totalPaise: Paise; // what the member actually pays
  mrpTotalPaise: Paise;
  discountPaise: Paise;
  totalBvCenti: BvCenti;
}

/**
 * Prices in India are quoted GST-inclusive, so the tax is extracted from the
 * shelf price rather than added to it. GST is computed per line and then summed
 * — products can sit at different slabs (hair oil at 5%, cosmetics at 18%), so
 * a single blended rate over the cart total would be wrong.
 */
export function priceOrder(items: PriceableItem[]): OrderTotals {
  if (items.length === 0) throw new BadRequestException('Your bag is empty.');

  let totalPaise = 0n;
  let gstPaise = 0n;
  let mrpTotalPaise = 0n;
  let totalBvCenti = 0;

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new BadRequestException(`Quantity for ${item.name} must be a whole number of at least 1.`);
    }
    const qty = BigInt(item.quantity);
    const lineTotal = item.pricePaise * qty;
    totalPaise += lineTotal;
    gstPaise += gstInclusiveComponent(lineTotal, item.gstBp);
    mrpTotalPaise += item.mrpPaise * qty;
    totalBvCenti += item.bvCenti * item.quantity;
  }

  return {
    subtotalPaise: totalPaise - gstPaise,
    gstPaise,
    totalPaise,
    mrpTotalPaise,
    discountPaise: mrpTotalPaise - totalPaise,
    totalBvCenti,
  };
}

/**
 * Apply a coupon on top of an already-priced order.
 *
 * Deliberately separate from `discountPaise` above, which is the markdown
 * already baked into the shelf price (MRP minus selling price) — a coupon is
 * a second, independent reduction, and conflating the two would make an
 * order's invoice lie about which discount came from where.
 *
 * GST and subtotal scale down with the same ratio as the total rather than
 * being recomputed line-by-line: correct to the paisa for a single flat or
 * percentage-off-the-total coupon, and simple enough to audit on an invoice.
 * BV is untouched — a coupon reduces what the member pays, not what the
 * order is worth to the plan.
 */
export function applyCouponDiscount(totals: OrderTotals, couponDiscountPaise: Paise): OrderTotals & { couponDiscountPaise: Paise } {
  const capped = couponDiscountPaise > totals.totalPaise ? totals.totalPaise : couponDiscountPaise;
  if (capped <= 0n) return { ...totals, couponDiscountPaise: 0n };

  const newTotal = totals.totalPaise - capped;
  const newGst = totals.totalPaise === 0n ? 0n : (totals.gstPaise * newTotal) / totals.totalPaise;
  return {
    ...totals,
    totalPaise: newTotal,
    gstPaise: newGst,
    subtotalPaise: newTotal - newGst,
    couponDiscountPaise: capped,
  };
}

/**
 * The joining rule.
 *
 * Modelled as a minimum first *product purchase*, never as a registration fee.
 * Registration itself is always free — that distinction is what keeps the plan
 * on the right side of the Direct Selling Rules, so it is enforced here in code
 * rather than left to how the admin words the UI.
 */
export function assertJoiningMinimum(plan: PlanConfig, isFirstPurchase: boolean, totals: OrderTotals): void {
  if (!isFirstPurchase || plan.joining.mode !== 'MIN_FIRST_PURCHASE') return;

  const required = plan.joining.minFirstPurchase;
  if (plan.joining.unit === 'BV') {
    if (totals.totalBvCenti < required) {
      throw new BadRequestException(
        `Your first order needs to be at least ${centiToBvString(required)} BV. ` +
          `This bag has ${centiToBvString(totals.totalBvCenti)} BV. Add more products to continue.`,
      );
    }
    return;
  }
  if (totals.totalPaise < BigInt(required)) {
    throw new BadRequestException(
      `Your first order needs to be at least ${formatInr(BigInt(required))}. ` +
        `This bag has ${formatInr(totals.totalPaise)}. Add more products to continue.`,
    );
  }
}

export interface CartLine {
  productId: string;
  quantity: number;
}

/**
 * Collapse repeated lines and reject nonsense before anything hits the database.
 * A cart posting the same product twice should buy two, not fail a stock check
 * against itself.
 */
export function normaliseCart(lines: CartLine[], maxPerProduct = 99): CartLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new BadRequestException('Your bag is empty.');

  const merged = new Map<string, number>();
  for (const line of lines) {
    if (!line?.productId) throw new BadRequestException('An item in your bag is invalid.');
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw new BadRequestException('Quantities must be whole numbers of at least 1.');
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + qty);
  }
  for (const [productId, qty] of merged) {
    if (qty > maxPerProduct) {
      throw new BadRequestException(`You can order at most ${maxPerProduct} units of one product per order.`);
    }
    merged.set(productId, qty);
  }
  // Sorted by product id: this is the lock ordering the whole system relies on.
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}
