import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Product reviews.
 *
 * Only a member who has had the product delivered can review it, and each member
 * has one review per product (writing again edits it). That is what lets the
 * storefront call them "verified purchases", and it is the rule that stops a
 * seller or a competitor stuffing a product page with ratings.
 *
 * The product's stored `ratingBp` and `reviewCount` are recomputed from the
 * published reviews on every change, so the star average on a card and in the page
 * markup can only ever be what the reviews on the page add up to. Only a member's
 * first name is shown.
 */

const PAGE = 20;

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async forProduct(slug: string, cursor?: string) {
    const product = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');

    const [rows, groups] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId: product.id, status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, rating: true, title: true, body: true, createdAt: true, member: { select: { name: true } } },
      }),
      this.prisma.review.groupBy({ by: ['rating'], where: { productId: product.id, status: 'PUBLISHED' }, _count: true }),
    ]);

    const dist = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: groups.find((g) => g.rating === stars)?._count ?? 0 }));
    const count = dist.reduce((a, d) => a + d.count, 0);
    const average = count ? dist.reduce((a, d) => a + d.stars * d.count, 0) / count : 0;
    const page = rows.slice(0, PAGE);

    return {
      summary: { count, average: Math.round(average * 10) / 10, distribution: dist },
      reviews: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        at: r.createdAt,
        author: r.member.name.split(' ')[0],
        verified: true,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    };
  }

  /** Whether this member may review this product, and what they wrote already. Backs the form on the product page. */
  async mine(memberId: string, slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const [eligible, existing] = await Promise.all([
      this.hasDelivered(memberId, product.id),
      this.prisma.review.findUnique({ where: { productId_memberId: { productId: product.id, memberId } }, select: { rating: true, title: true, body: true, status: true } }),
    ]);
    return { eligible, review: existing };
  }

  async write(memberId: string, slug: string, input: { rating: number; title?: string; body: string }) {
    const product = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (!(await this.hasDelivered(memberId, product.id))) {
      throw new ForbiddenException('You can review a product once an order with it has been delivered to you.');
    }
    const body = input.body.trim();
    if (body.length < 10) throw new BadRequestException('Tell us a little more - at least 10 characters.');

    await this.prisma.review.upsert({
      where: { productId_memberId: { productId: product.id, memberId } },
      create: { productId: product.id, memberId, rating: input.rating, title: input.title?.trim() || null, body },
      // An edit goes back to published; a hidden review stays hidden until an admin restores it.
      update: { rating: input.rating, title: input.title?.trim() || null, body },
    });
    await this.recompute(product.id);
    return this.mine(memberId, slug);
  }

  /* ------------------------------------------------------------- admin */

  async adminList(status?: 'PUBLISHED' | 'HIDDEN') {
    const rows = await this.prisma.review.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, rating: true, title: true, body: true, status: true, createdAt: true,
        product: { select: { name: true, slug: true } },
        member: { select: { name: true, memberCode: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, rating: r.rating, title: r.title, body: r.body, status: r.status, at: r.createdAt,
      product: r.product.name, productSlug: r.product.slug, author: r.member.name, memberCode: r.member.memberCode,
    }));
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'HIDDEN', actorId: string) {
    const review = await this.prisma.review.update({ where: { id }, data: { status } });
    await this.recompute(review.productId);
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId, action: status === 'HIDDEN' ? 'review.hide' : 'review.show', detail: { reviewId: id, productId: review.productId } },
    });
    return { ok: true as const };
  }

  /* ----------------------------------------------------------- helpers */

  private async hasDelivered(memberId: string, productId: string): Promise<boolean> {
    const n = await this.prisma.orderItem.count({ where: { productId, order: { memberId, status: 'DELIVERED' } } });
    return n > 0;
  }

  private async recompute(productId: string): Promise<void> {
    const agg = await this.prisma.review.aggregate({ where: { productId, status: 'PUBLISHED' }, _avg: { rating: true }, _count: true });
    await this.prisma.product.update({
      where: { id: productId },
      data: { reviewCount: agg._count, ratingBp: Math.round((agg._avg.rating ?? 0) * 1000) },
    });
  }
}
