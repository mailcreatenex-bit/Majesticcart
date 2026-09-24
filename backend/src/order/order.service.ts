import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma, OrderStatus } from '@prisma/client';
import { LedgerService, Tx, idempotencyKey } from '../ledger/ledger.service';
import { CommissionService } from '../commission/commission.service';
import { CouponService } from '../coupon/coupon.service';
import { parsePlan } from '../plan/plan.config';
import { priceOrder, applyCouponDiscount, assertJoiningMinimum, normaliseCart, CartLine, PriceableItem } from './pricing';
import { formatInr } from '../common/money';
import { money, volume } from '../common/serialization';
import { isIntraState } from '../common/gst-state';

/**
 * Orders.
 *
 * Checkout is the hairiest transaction in the platform: it touches product
 * stock, the member's wallet, the joining rule and first-purchase detection all
 * at once, and every one of those is a race under load.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GLOBAL LOCK ORDER — products (ascending id), then wallets (ascending id).
 * Every code path that touches both must follow it, or two concurrent
 * transactions will grab them in opposite orders and deadlock. Checkout,
 * cancellation and returns all obey this.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [], // returns go through returnDelivered(), not a transition
  CANCELLED: [],
};

export interface CheckoutInput {
  memberId: string;
  lines: CartLine[];
  shipping: {
    name: string;
    phone: string;
    line: string;
    city: string;
    state: string;
    pincode: string;
  };
  /** Client-supplied, so a double-tapped Pay button cannot place two orders. */
  requestId?: string;
  couponCode?: string;
}

@Injectable()
export class OrderService {
  private readonly log = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly commission: CommissionService,
    private readonly coupons: CouponService,
  ) {}

  /**
   * Allocate the next number in a gapless series.
   *
   * Takes a row lock, so concurrent checkouts serialise on this one row. That
   * is a deliberate trade: a Postgres sequence would be faster but burns
   * numbers on rollback, and a GST invoice series may not have holes.
   */
  private async nextNumber(tx: Tx, key: string, prefix: string): Promise<string> {
    const rows = await tx.$queryRaw<{ prefix: string; nextValue: number }[]>`
      INSERT INTO "NumberSeries" (key, prefix, "nextValue", "updatedAt")
      VALUES (${key}, ${prefix}, 2, NOW())
      ON CONFLICT (key) DO UPDATE SET "nextValue" = "NumberSeries"."nextValue" + 1, "updatedAt" = NOW()
      RETURNING prefix, "nextValue" - 1 AS "nextValue"
    `;
    const row = rows[0];
    return `${row.prefix}${row.nextValue}`;
  }

  /**
   * Price a bag without placing it.
   *
   * Read-only: no lock, no write, no stock reservation. The checkout screen
   * needs the real payable total before it can decide whether the wallet
   * covers it, and that total is not something a browser can work out — GST is
   * extracted per line at each product's own slab, so a cart mixing a 5% and
   * an 18% item has no single blended rate.
   *
   * It deliberately does NOT promise the price. The authoritative pricing
   * happens inside the checkout transaction against rows read under a lock, so
   * a price the admin changes between this call and that one is caught there.
   * A quote that bound the price would be a way to hold yesterday's price open
   * indefinitely by leaving a tab open.
   */
  async quote(input: { memberId: string; lines: CartLine[]; state: string; pincode?: string; couponCode?: string }) {
    const lines = normaliseCart(input.lines);

    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) }, isActive: true },
      orderBy: { id: 'asc' },
    });

    const byId = new Map(products.map((p: any) => [p.id, p]));
    const missing = lines.filter((l) => !byId.has(l.productId));
    if (missing.length > 0) {
      throw new BadRequestException('An item in your bag is no longer sold. Remove it to continue.');
    }

    const items: PriceableItem[] = lines.map((line) => {
      const p = byId.get(line.productId);
      return {
        productId: p.id,
        name: p.name,
        pricePaise: p.pricePaise,
        mrpPaise: p.mrpPaise,
        bvCenti: p.bvCenti,
        gstBp: p.gstBp,
        quantity: line.quantity,
      };
    });

    const priced = priceOrder(items);

    // A bad or expired code must not break pricing the rest of the bag — the
    // checkout screen shows the coupon's own error next to its own field and
    // still quotes the order without it.
    let coupon: { code: string; description: string | null; discountPaise: bigint } | null = null;
    let couponError: string | null = null;
    if (input.couponCode?.trim()) {
      try {
        coupon = await this.coupons.preview(input.couponCode, input.memberId, priced.subtotalPaise);
      } catch (err) {
        couponError = err instanceof Error ? err.message : 'That coupon could not be applied.';
      }
    }
    const totals = coupon ? applyCouponDiscount(priced, coupon.discountPaise) : { ...priced, couponDiscountPaise: 0n };

    const [wallet, settings] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { memberId_kind: { memberId: input.memberId, kind: 'SHOPPING' } },
        select: { balancePaise: true },
      }),
      this.prisma.storeSetting.findUnique({ where: { key: 'store' } }),
    ]);

    const balancePaise: bigint = wallet?.balancePaise ?? 0n;
    const sellerState = ((settings?.value ?? {}) as Record<string, string>).state ?? 'West Bengal';
    const intraState = isIntraState(sellerState, input.state);

    return {
      // Indian prices are quoted GST-inclusive, so `total` is the sum of the
      // shelf prices and `gst` is a component of it, not an addition to it.
      // Presenting it any other way makes the arithmetic look wrong.
      total: money(totals.totalPaise),
      taxable: money(totals.subtotalPaise),
      gst: money(totals.gstPaise),
      mrpTotal: money(totals.mrpTotalPaise),
      discount: money(totals.discountPaise),
      businessVolume: volume(totals.totalBvCenti),
      coupon: coupon ? { code: coupon.code, description: coupon.description, discount: money(totals.couponDiscountPaise) } : null,
      couponError,
      // Which heads the GST falls under, so the checkout can show the same
      // split the invoice will carry.
      tax: {
        intraState,
        placeOfSupply: input.state,
        heads: intraState ? ['CGST', 'SGST'] : ['IGST'],
      },
      wallet: {
        shopping: money(balancePaise),
        // Computed here rather than in the browser: the client's own check is
        // a convenience for disabling a button, this is the answer.
        affordable: balancePaise >= totals.totalPaise,
        shortfall: money(balancePaise >= totals.totalPaise ? 0n : totals.totalPaise - balancePaise),
      },
    };
  }

  async checkout(input: CheckoutInput) {
    const lines = normaliseCart(input.lines); // sorted by product id — the lock order
    const shipping = this.validateShipping(input.shipping);

    return this.prisma.$transaction(
      async (tx) => {
        const planRow = await tx.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
        const plan = parsePlan(planRow.config);

        // --- 1. products first, in id order ---------------------------------
        const products = await tx.product.findMany({
          where: { id: { in: lines.map((l) => l.productId) } },
          orderBy: { id: 'asc' },
        });
        if (products.length !== lines.length) {
          throw new BadRequestException('An item in your bag is no longer sold. Remove it to continue.');
        }
        const byId = new Map(products.map((p: any) => [p.id, p]));

        const items: PriceableItem[] = lines.map((line) => {
          const p = byId.get(line.productId);
          if (!p.isActive) throw new BadRequestException(`${p.name} is no longer available.`);
          return {
            productId: p.id,
            name: p.name,
            pricePaise: p.pricePaise,
            mrpPaise: p.mrpPaise,
            bvCenti: p.bvCenti,
            gstBp: p.gstBp,
            quantity: line.quantity,
          };
        });

        const totals = priceOrder(items);

        // --- 2. member and wallet -------------------------------------------
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        if (member.status !== 'ACTIVE') {
          throw new BadRequestException('Your account is on hold. Contact support to place orders.');
        }

        // The joining minimum is checked against the pre-coupon total —
        // otherwise a coupon would double as a way to duck under it.
        const priorOrders = await tx.order.count({
          where: { memberId: member.id, status: { not: 'CANCELLED' } },
        });
        const isFirstPurchase = priorOrders === 0;
        assertJoiningMinimum(plan, isFirstPurchase, totals);

        // Claimed before the wallet lock: a bad or exhausted code should fail
        // fast, before this checkout takes a lock any other member's checkout
        // might be waiting on.
        const couponClaim = input.couponCode?.trim()
          ? await this.coupons.lockAndClaim(tx, input.couponCode, member.id, totals.subtotalPaise)
          : null;
        const finalTotals = couponClaim ? applyCouponDiscount(totals, couponClaim.discountPaise) : { ...totals, couponDiscountPaise: 0n };

        // Locking the wallet here also serialises checkout per member.
        await this.ledger.lockWallets(tx, [{ memberId: member.id, wallet: 'SHOPPING' }]);

        // --- 3. stock, atomically -------------------------------------------
        // A conditional UPDATE rather than read-then-write: the WHERE clause is
        // the check, so two buyers racing for the last unit cannot both win.
        for (const item of items) {
          const claimed = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity }, sold: { increment: item.quantity } },
          });
          if (claimed.count === 0) {
            const fresh = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
            throw new ConflictException(
              `Only ${fresh?.stock ?? 0} left of ${item.name}. Lower the quantity to continue.`,
            );
          }
        }

        // --- 4. the order itself ---------------------------------------------
        const orderNo = await this.nextNumber(tx, 'order', 'OD');
        const order = await tx.order.create({
          data: {
            orderNo,
            memberId: member.id,
            status: 'PLACED',
            subtotalPaise: finalTotals.subtotalPaise,
            gstPaise: finalTotals.gstPaise,
            totalPaise: finalTotals.totalPaise,
            totalBvCenti: finalTotals.totalBvCenti,
            couponId: couponClaim?.couponId,
            couponCode: couponClaim ? input.couponCode!.trim().toUpperCase() : null,
            discountPaise: finalTotals.couponDiscountPaise,
            isFirstPurchase,
            shipName: shipping.name,
            shipPhone: shipping.phone,
            shipLine: shipping.line,
            shipCity: shipping.city,
            shipState: shipping.state,
            shipPincode: shipping.pincode,
            items: {
              create: items.map((i) => ({
                productId: i.productId,
                nameSnapshot: i.name, // snapshot: a price edit next month must not rewrite history
                pricePaise: i.pricePaise,
                mrpPaise: i.mrpPaise,
                bvCenti: i.bvCenti,
                gstBp: i.gstBp,
                quantity: i.quantity,
              })),
            },
            events: { create: { status: 'PLACED' } },
          },
          include: { items: true },
        });

        if (couponClaim) {
          await this.coupons.finishRedemption(tx, couponClaim.couponId, member.id, order.id, finalTotals.couponDiscountPaise);
        }

        // --- 5. pay from the shopping wallet ---------------------------------
        // Throws InsufficientFundsError and rolls back everything above,
        // including the stock decrements.
        await this.ledger.post(tx, {
          memberId: member.id,
          wallet: 'SHOPPING',
          direction: 'DEBIT',
          amountPaise: finalTotals.totalPaise,
          category: 'ORDER_PAYMENT',
          idempotencyKey: input.requestId
            ? idempotencyKey('order-pay', member.id, input.requestId)
            : idempotencyKey('order-pay', order.id),
          refType: 'order',
          refId: order.id,
          note: `Order ${orderNo}`,
        });

        await tx.member.update({
          where: { id: member.id },
          data: {
            addressLine: shipping.line,
            city: shipping.city,
            state: shipping.state,
            pincode: shipping.pincode,
          },
        });

        await tx.notification.create({
          data: {
            memberId: member.id,
            title: 'Order placed',
            body: `${orderNo} for ${formatInr(finalTotals.totalPaise)} is confirmed. Income is credited once it's delivered.`,
            kind: 'ORDER',
          },
        });

        this.log.log(`${orderNo}: ${formatInr(finalTotals.totalPaise)}, ${finalTotals.totalBvCenti} centi-BV, first=${isFirstPurchase}${couponClaim ? `, coupon=${input.couponCode}` : ''}`);
        return order;
      },
      { isolationLevel: 'ReadCommitted', timeout: 20_000 },
    );
  }

  /**
   * Move an order along the fulfilment chain.
   *
   * DELIVERED does not pay commission inline. It enqueues a job, so a slow
   * genealogy walk cannot hold a database transaction open while an admin waits
   * on a button, and a transient failure is retried by the queue rather than
   * losing the payout.
   */
  async transition(orderId: string, next: OrderStatus, args: { actorId?: string; note?: string } = {}) {
    const order = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: OrderStatus }[]>`
        SELECT id, status FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `;
      if (locked.length === 0) throw new BadRequestException('Order not found.');
      const current = locked[0].status;

      if (!ALLOWED_TRANSITIONS[current].includes(next)) {
        throw new ConflictException(`An order that is ${current.toLowerCase()} can't be marked ${next.toLowerCase()}.`);
      }
      if (next === 'CANCELLED') return this.applyCancellation(tx, orderId, args);

      const patch: Record<string, unknown> = { status: next };
      if (next === 'DELIVERED') {
        patch.deliveredAt = new Date();
        // Pin the plan now, so a rate change tomorrow cannot alter this payout.
        patch.planVersionId = (await tx.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } })).id;
        patch.invoiceNo = await this.nextNumber(tx, `invoice:${financialYear()}`, `INV/${financialYear()}/`);
        patch.invoicedAt = new Date();
      }

      const updated = await tx.order.update({ where: { id: orderId }, data: patch });
      await tx.orderEvent.create({ data: { orderId, status: next, note: args.note, actorId: args.actorId } });
      await tx.notification.create({
        data: {
          memberId: updated.memberId,
          title: next === 'DELIVERED' ? 'Order delivered' : `Order ${next.toLowerCase()}`,
          body: `${updated.orderNo} is ${next.toLowerCase()}.`,
          kind: 'ORDER',
        },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: args.actorId, action: 'order.transition', detail: { orderId, from: current, to: next } },
      });
      return updated;
    });

    if (next === 'DELIVERED') await this.enqueueCommission(orderId);
    return order;
  }

  /**
   * Refund and restock. Only reachable before delivery, so no commission has
   * run yet and there is nothing to claw back.
   */
  private async applyCancellation(tx: Tx, orderId: string, args: { actorId?: string; note?: string }) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.commissionRunAt) {
      throw new ConflictException('Commission has already been paid on this order. Use the return flow instead.');
    }

    // Products first, ascending id — the global lock order.
    const items = [...order.items].sort((a: any, b: any) => a.productId.localeCompare(b.productId));
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity }, sold: { decrement: item.quantity } },
      });
    }

    await this.ledger.post(tx, {
      memberId: order.memberId,
      wallet: 'SHOPPING',
      direction: 'CREDIT',
      amountPaise: order.totalPaise,
      category: 'ORDER_REFUND',
      idempotencyKey: idempotencyKey('order-refund', order.id),
      refType: 'order',
      refId: order.id,
      note: `Refund for ${order.orderNo}`,
    });

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    await tx.orderEvent.create({ data: { orderId, status: 'CANCELLED', note: args.note, actorId: args.actorId } });
    await tx.notification.create({
      data: {
        memberId: order.memberId,
        title: 'Order cancelled',
        body: `${order.orderNo} was cancelled${args.note ? ` (${args.note})` : ''}. ${formatInr(order.totalPaise)} is back in your shopping wallet.`,
        kind: 'ORDER',
      },
    });
    return updated;
  }

  /**
   * A delivered order coming back.
   *
   * This is the expensive path the delivery-time payout rule exists to keep
   * rare: commission has already landed in income wallets and may already have
   * been withdrawn, so reversing it can push a wallet negative. That is
   * deliberate — the debt is recorded rather than silently written off, and
   * finance decides how to recover it.
   */
  async returnDelivered(orderId: string, args: { actorId: string; reason: string; restock?: boolean }) {
    const reason = args.reason?.trim();
    if (!reason) throw new BadRequestException('Record why the order is being returned.');

    const reversed = await this.commission.reverseOrderRun(orderId, reason, args.actorId);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      if (order.status !== 'DELIVERED') throw new ConflictException('Only a delivered order can be returned.');

      if (args.restock !== false) {
        const items = [...order.items].sort((a: any, b: any) => a.productId.localeCompare(b.productId));
        for (const item of items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity }, sold: { decrement: item.quantity } },
          });
        }
      }

      // Roll back the volume this order contributed, or ranks drift upward
      // permanently on returned goods.
      const buyer = await tx.member.findUniqueOrThrow({ where: { id: order.memberId } });
      const ancestorIds = buyer.ancestorPath.split('/').filter(Boolean);
      await tx.member.update({
        where: { id: buyer.id },
        data: {
          selfBvCenti: { decrement: BigInt(order.totalBvCenti) },
          groupBvCenti: { decrement: BigInt(order.totalBvCenti) },
        },
      });
      if (ancestorIds.length > 0) {
        await tx.member.updateMany({
          where: { id: { in: ancestorIds } },
          data: { groupBvCenti: { decrement: BigInt(order.totalBvCenti) } },
        });
      }

      await this.ledger.post(tx, {
        memberId: order.memberId,
        wallet: 'SHOPPING',
        direction: 'CREDIT',
        amountPaise: order.totalPaise,
        category: 'ORDER_REFUND',
        idempotencyKey: idempotencyKey('order-return', order.id),
        refType: 'order',
        refId: order.id,
        note: `Return of ${order.orderNo}: ${reason}`,
      });

      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
      await tx.orderEvent.create({ data: { orderId, status: 'CANCELLED', note: `Returned: ${reason}`, actorId: args.actorId } });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: args.actorId,
          action: 'order.return',
          detail: { orderId, reason, reversedEntries: reversed, refundPaise: order.totalPaise.toString() },
        },
      });

      this.log.warn(`${order.orderNo} returned. ${reversed} commission entries reversed — check for negative income wallets.`);
      return { ok: true as const, reversedEntries: reversed };
    });
  }

  /**
   * Hand the payout to BullMQ. The jobId makes a duplicate enqueue a no-op, and
   * the engine's own idempotency keys make a duplicate *run* a no-op too —
   * belt and braces, because this is the money path.
   */
  private async enqueueCommission(orderId: string) {
    // Injected in the real module; kept as a hook so this file stays testable.
    await this.commissionQueue?.add(
      'run',
      { orderId },
      {
        // A dash, not a colon: BullMQ (v5+) refuses a custom job id containing ':', which made every
        // delivery fail with a 500 after the order was already marked delivered - so no payout ran.
        jobId: `commission-${orderId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: false, // a failed payout must stay visible for triage
      },
    );
  }

  /**
   * Safety net for the payout: enqueue the commission run for any delivered order that has not had one.
   *
   * Delivery marks the order delivered first and hands the payout to the queue second, so a
   * failure between the two (the queue down, a bad job id, a restart) leaves a delivered order
   * that never paid anyone. This finds those and queues them again. It is safe to run any time:
   * the job id dedupes the queue and `runForOrder` does nothing for an order that has already run.
   */
  async sweepCommissions(): Promise<number> {
    const stuck = await this.prisma.order.findMany({
      where: { status: 'DELIVERED', commissionRunAt: null, deliveredAt: { lt: new Date(Date.now() - 60_000) } },
      orderBy: { deliveredAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const o of stuck) {
      await this.enqueueCommission(o.id).catch((e) => this.log.error(`commission sweep: could not queue ${o.id}: ${e instanceof Error ? e.message : e}`));
    }
    if (stuck.length) this.log.warn(`commission sweep: re-queued ${stuck.length} delivered order(s) with no payout run`);
    return stuck.length;
  }

  /** Set by OrderModule. Typed loosely so the queue is not a test dependency. */
  commissionQueue?: { add(name: string, data: unknown, opts: unknown): Promise<unknown> };

  private validateShipping(s: CheckoutInput['shipping']) {
    const name = s?.name?.trim() ?? '';
    const phone = (s?.phone ?? '').replace(/\s/g, '');
    const line = s?.line?.trim() ?? '';
    const city = s?.city?.trim() ?? '';
    const state = s?.state?.trim() ?? '';
    const pincode = (s?.pincode ?? '').trim();

    if (!name) throw new BadRequestException("Enter the recipient's name.");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new BadRequestException('Enter a valid 10-digit mobile number for delivery.');
    if (line.length < 6) throw new BadRequestException('Enter the full street address.');
    if (!city) throw new BadRequestException('Enter the city.');
    if (!state) throw new BadRequestException('Choose the state.');
    if (!/^[1-9]\d{5}$/.test(pincode)) throw new BadRequestException('Enter a valid 6-digit PIN code.');

    return { name, phone, line, city, state, pincode };
  }
}

/** Indian financial year label: April to March. "2026-27". */
export function financialYear(d: Date = new Date()): string {
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}
