import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { renderMarkdown } from '../common/markdown';

export const PageInputSchema = z.object({
  title: z.string().trim().min(2, 'Title is too short').max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only'),
  contentMd: z.string().trim().min(1, 'Write something first'),
  isPublished: z.boolean().default(false),
});

/**
 * Freeform pages (About, Press, Careers, ...), reachable at `/p/:slug` on the
 * storefront. Kept off the reserved top-level paths the app already owns
 * (`shop`, `checkout`, `admin`, ...) at the point a page is created — a page
 * called "shop" would either 404 forever or silently shadow the real one,
 * and neither failure is obvious from the admin form.
 */
const RESERVED_SLUGS = new Set([
  'shop', 'cart', 'checkout', 'admin', 'login', 'signup', 'account', 'orders', 'wallet',
  'recharge', 'network', 'about', 'faq', 'contact', 'join', 'category', 'brand', 'product',
  'blog', 'legal', 'api', 'mc', 'offline', 'shade-finder', 'forgot-password',
]);

@Injectable()
export class PageService {
  constructor(private readonly prisma: PrismaClient) {}

  async bySlug(slug: string) {
    const page = await this.prisma.page.findFirst({ where: { slug, isPublished: true } });
    if (!page) throw new NotFoundException('Page not found.');
    return { ...page, contentHtml: renderMarkdown(page.contentMd) };
  }

  /** Feed for the sitemap. */
  sitemapEntries() {
    return this.prisma.page.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } });
  }

  adminList() {
    return this.prisma.page.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, slug: true, title: true, isPublished: true, updatedAt: true, updatedBy: { select: { name: true } } },
    });
  }

  async adminGet(id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }

  async create(input: z.infer<typeof PageInputSchema>, actorId: string) {
    this.assertSlugAllowed(input.slug);
    await this.assertSlugFree(input.slug);
    return this.prisma.page.create({ data: { ...input, updatedById: actorId } });
  }

  async update(id: string, input: z.infer<typeof PageInputSchema>, actorId: string) {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found.');
    if (input.slug !== existing.slug) {
      this.assertSlugAllowed(input.slug);
      await this.assertSlugFree(input.slug);
    }
    return this.prisma.page.update({ where: { id }, data: { ...input, updatedById: actorId } });
  }

  async delete(id: string) {
    await this.prisma.page.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Page not found.');
    });
    return { ok: true as const };
  }

  private assertSlugAllowed(slug: string) {
    if (RESERVED_SLUGS.has(slug)) throw new BadRequestException(`"${slug}" is a reserved path. Choose a different slug.`);
  }

  private async assertSlugFree(slug: string) {
    const existing = await this.prisma.page.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException('That slug is already used by another page.');
  }
}
