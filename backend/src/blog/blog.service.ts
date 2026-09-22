import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { renderMarkdown } from '../common/markdown';

export const BlogPostInputSchema = z.object({
  title: z.string().trim().min(3, 'Title is too short').max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only'),
  excerpt: z.string().trim().max(300).optional(),
  contentMd: z.string().trim().min(1, 'Write something first'),
  coverImageUrl: z.string().trim().max(500).optional(),
  isPublished: z.boolean().default(false),
});

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaClient) {}

  /* --------------------------------------------------------------- public */

  async list(cursor?: string) {
    const rows = await this.prisma.blogPost.findMany({
      where: { isPublished: true },
      orderBy: { publishedAt: 'desc' },
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true },
    });
    const page = rows.slice(0, 20);
    return { items: page, nextCursor: rows.length > 20 ? page[page.length - 1].id : null };
  }

  async bySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, isPublished: true },
      include: { author: { select: { name: true } } },
    });
    if (!post) throw new NotFoundException('Post not found.');
    return { ...post, contentHtml: renderMarkdown(post.contentMd) };
  }

  /* ---------------------------------------------------------------- admin */

  adminList() {
    return this.prisma.blogPost.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, slug: true, title: true, isPublished: true, publishedAt: true, updatedAt: true,
        author: { select: { name: true } },
      },
    });
  }

  async adminGet(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found.');
    return post;
  }

  async create(input: z.infer<typeof BlogPostInputSchema>, authorId: string) {
    await this.assertSlugFree(input.slug);
    return this.prisma.blogPost.create({
      data: {
        ...input,
        authorId,
        publishedAt: input.isPublished ? new Date() : null,
      },
    });
  }

  async update(id: string, input: z.infer<typeof BlogPostInputSchema>) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found.');
    if (input.slug !== existing.slug) await this.assertSlugFree(input.slug);

    return this.prisma.blogPost.update({
      where: { id },
      data: {
        ...input,
        // Set once, the first time a post goes live — re-publishing after an
        // unpublish should not bump its date to today, or "published" stops
        // meaning when the post first went out.
        publishedAt: input.isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
      },
    });
  }

  async delete(id: string) {
    await this.prisma.blogPost.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Post not found.');
    });
    return { ok: true as const };
  }

  private async assertSlugFree(slug: string) {
    const existing = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException('That slug is already used by another post.');
  }
}
