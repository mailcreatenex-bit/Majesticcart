import { z } from 'zod';
import { Body, Controller, Get, Param, Post, Put, Query, HttpCode } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { Public, RequirePermission, CurrentUser } from '../auth/guards';
import { BlogService, BlogPostInputSchema } from './blog.service';

@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Public()
  @Get()
  list(@Query('cursor') cursor?: string) {
    return this.blog.list(cursor);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.blog.bySlug(slug);
  }
}

@RequirePermission('blog.manage')
@Controller('admin/blog')
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  list() {
    return this.blog.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.blog.adminGet(id);
  }

  @Post()
  create(@Body(zodBody(BlogPostInputSchema)) body: z.infer<typeof BlogPostInputSchema>, @CurrentUser('sub') adminId: string) {
    return this.blog.create(body, adminId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(zodBody(BlogPostInputSchema)) body: z.infer<typeof BlogPostInputSchema>) {
    return this.blog.update(id, body);
  }

  @Post(':id/delete')
  @HttpCode(200)
  delete(@Param('id') id: string) {
    return this.blog.delete(id);
  }
}
