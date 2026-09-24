import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma, CouponType } from '@prisma/client';
import { z } from 'zod';
import { rupeesToPaise, Paise } from '../common/money';
import { Tx } from '../ledger/ledger.service';

/**
 * Discount coupons.
 *
 * Two amounts are computed at two different times, deliberately:
 *
 *   • preview() runs outside any transaction, off the same read a member's
 *     cart screen already does. It tells them what a code is worth before
 *     they commit to checkout — but it does not reserve anything, so it can
 *     be stale by the time they actually pay.
 *   • redeem() runs *inside* the checkout transaction, against a locked read
 *     of the coupon row. This is what actually enforces usageLimit and
 *     perMemberLimit — two members racing for the last use of a
 *     usageLimit-capped code cannot both win, because the second one's
 *     UPDATE ... WHERE usedCount < usageLimit affects zero rows.
 *
 * A coupon is never deleted once redeemed against a real order — see
 * Order.couponId's onDelete: SetNull. Deactivating is the only destructive
 * action exposed to the admin console.
 */

export const CouponInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,24}$/, 'Code: 3 to 24 letters, digits or hyphens'),
  description: z.string().trim().max(200).optional(),
  type: z.enum(['PERCENT', 'FIXED']),
  // PERCENT is entered as a plain percentage (e.g. "10" for 10%); FIXED as rupees.
  value: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  maxDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  minOrder: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
  usageLimit: z.number().int().positive().optional(),
  perMemberLimit: z.number().int().positive().default(1),
  firstOrderOnly: z.boolean().default(false),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
});
export type CouponInput = z.infer<typeof CouponInputSchema>;

export interface CouponPreview {
  code: string;
  description: string | null;
  discountPaise: Paise;
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaClient) {}

  async list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(input: CouponInput, actorId: string) {
    const value = input.type === 'PERCENT'
      ? Math.round(Number(input.value) * 100) // percent -> basis points
      : Number(rupeesToPaise(input.value));
    if (input.type === 'PERCENT' && (value <= 0 || value > 10000)) {
      throw new BadRequestException('Enter a percentage between 0 and 100.');
    }
    if (input.type === 'FIXED' && value <= 0) {
      throw new BadRequestException('Enter a discount amount greater than zero.');
    }
    if (input.startsAt && input.expiresAt && new Date(input.startsAt) >= new Date(input.expiresAt)) {
      throw new BadRequestException('The end date must be after the start date.');
    }

    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: input.code,
          description: input.description?.trim() || null,
          type: input.type as CouponType,
          value,
          maxDiscountPaise: input.type === 'PERCENT' && input.maxDiscount ? rupeesToPaise(input.maxDiscount) : null,
          minOrderPaise: rupeesToPaise(input.minOrder),
          usageLimit: input.usageLimit ?? null,
          perMemberLimit: input.perMemberLimit,
          firstOrderOnly: input.firstOrderOnly,
          isActive: input.isActive,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdById: actorId,
        },
      });
      await this.audit(actorId, 'coupon.create', { code: coupon.code, type: coupon.type, value: coupon.value });
      return coupon;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Coupon code ${input.code} already exists.`);
      }
      throw e;
    }
  }

  async setActive(id: string, isActive: boolean, actorId: string) {
    const coupon = await this.prisma.coupon.update({ where: { id }, data: { isActive } });
    await this.audit(actorId, isActive ? 'coupon.activate' : 'coupon.deactivate', { code: coupon.code });
    return coupon;
  }

  /**
   * Non-transactional preview for the cart/checkout screen: what this code is
   * worth right now, without reserving it. `redeem()` is the real check.
   */
  async preview(code: string, memberId: string, subtotalPaise: Paise): Promise<CouponPreview> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: this.normalise(code) } });
    this.assertUsable(coupon, subtotalPaise);
    await this.assertFirstOrder(this.prisma, coupon!, memberId);
    const uses = await this.prisma.couponRedemption.count({ where: { couponId: coupon!.id, memberId } });
    if (uses >= coupon!.perMemberLimit) {
      throw new BadRequestException('You have already used this coupon the maximum number of times.');
    }
    return {
      code: coupon!.code,
      description: coupon!.description,
      discountPaise: this.computeDiscount(coupon!, subtotalPaise),
    };
  }

  /**
   * Redeem inside the checkout transaction. Returns the discount actually
   * applied (never more than the order total), or throws if the code no
   * longer qualifies — the same code can go from valid to expired or
   * exhausted between the cart screen and the moment Pay is pressed.
   */
  /**
   * Phase 1, before the order row exists: lock the coupon, check it still
   * qualifies, and claim one use. Split from phase 2 because the order this
   * redemption will be recorded against doesn't have an id yet at this point
   * in checkout() — claiming the use here and recording it in
   * finishRedemption() once the order is created keeps both writes in the
   * same transaction, so either both happen or neither does.
   */
  async lockAndClaim(tx: Tx, code: string, memberId: string, subtotalPaise: Paise): Promise<{ couponId: string; discountPaise: Paise }> {
    // Locks the row so a second concurrent checkout using the last remaining
    // use of a usageLimit-capped coupon sees the updated usedCount, not a
    // stale one — the UPDATE below is what actually enforces the cap.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Coupon" WHERE code = ${this.normalise(code)} FOR UPDATE`;
    if (rows.length === 0) throw new BadRequestException('That coupon code does not exist.');

    const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: rows[0].id } });
    this.assertUsable(coupon, subtotalPaise);
    await this.assertFirstOrder(tx, coupon, memberId);

    const priorUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, memberId } });
    if (priorUses >= coupon.perMemberLimit) {
      throw new BadRequestException('You have already used this coupon the maximum number of times.');
    }

    if (coupon.usageLimit != null) {
      const claimed = await tx.coupon.updateMany({
        where: { id: coupon.id, usedCount: { lt: coupon.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) throw new BadRequestException('This coupon has run out of uses.');
    } else {
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }

    return { couponId: coupon.id, discountPaise: this.computeDiscount(coupon, subtotalPaise) };
  }

  /** Phase 2: the order now has an id, so the per-member usage record can actually be written. */
  finishRedemption(tx: Tx, couponId: string, memberId: string, orderId: string, discountPaise: Paise) {
    return tx.couponRedemption.create({ data: { couponId, memberId, orderId, discountPaise } });
  }

  private assertUsable(coupon: { isActive: boolean; startsAt: Date | null; expiresAt: Date | null; minOrderPaise: bigint } | null, subtotalPaise: Paise): asserts coupon {
    if (!coupon) throw new BadRequestException('That coupon code does not exist.');
    if (!coupon.isActive) throw new BadRequestException('This coupon is no longer active.');
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) throw new BadRequestException('This coupon is not active yet.');
    if (coupon.expiresAt && now > coupon.expiresAt) throw new BadRequestException('This coupon has expired.');
    if (subtotalPaise < coupon.minOrderPaise) {
      throw new BadRequestException(`This coupon needs a minimum order of ${(Number(coupon.minOrderPaise) / 100).toFixed(2)}.`);
    }
  }

  /** A welcome offer only works for a member with no orders yet; a cancelled order does not use it up. */
  private async assertFirstOrder(db: { order: { count: (a: { where: { memberId: string; status: { not: 'CANCELLED' } } }) => Promise<number> } }, coupon: { firstOrderOnly: boolean }, memberId: string) {
    if (!coupon.firstOrderOnly) return;
    const prior = await db.order.count({ where: { memberId, status: { not: 'CANCELLED' } } });
    if (prior > 0) throw new BadRequestException('This offer is for your first order only.');
  }

  private computeDiscount(coupon: { type: CouponType; value: number; maxDiscountPaise: bigint | null }, subtotalPaise: Paise): Paise {
    if (coupon.type === 'FIXED') {
      const flat = BigInt(coupon.value);
      return flat > subtotalPaise ? subtotalPaise : flat;
    }
    let discount = (subtotalPaise * BigInt(coupon.value)) / 10_000n;
    if (coupon.maxDiscountPaise != null && discount > coupon.maxDiscountPaise) discount = coupon.maxDiscountPaise;
    return discount > subtotalPaise ? subtotalPaise : discount;
  }

  private normalise(code: string): string {
    return code.trim().toUpperCase();
  }

  private audit(actorId: string, action: string, detail: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId, action, detail: detail as Prisma.InputJsonValue } });
  }
}
