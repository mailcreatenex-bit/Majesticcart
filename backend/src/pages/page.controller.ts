import { z } from 'zod';
import { Body, Controller, Get, Param, Post, Put, HttpCode } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { Public, RequirePermission, CurrentUser } from '../auth/guards';
import { PageService, PageInputSchema } from './page.service';

@Controller('pages')
export class PageController {
  constructor(private readonly pages: PageService) {}

  /** Feed for the Next.js sitemap. Only indexable pages. */
  @Public()
  @Get('sitemap')
  sitemap() {
    return this.pages.sitemapEntries();
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.pages.bySlug(slug);
  }
}

@RequirePermission('pages.manage')
@Controller('admin/pages')
export class AdminPageController {
  constructor(private readonly pages: PageService) {}

  @Get()
  list() {
    return this.pages.adminList();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.pages.adminGet(id);
  }

  @Post()
  create(@Body(zodBody(PageInputSchema)) body: z.infer<typeof PageInputSchema>, @CurrentUser('sub') adminId: string) {
    return this.pages.create(body, adminId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(zodBody(PageInputSchema)) body: z.infer<typeof PageInputSchema>, @CurrentUser('sub') adminId: string) {
    return this.pages.update(id, body, adminId);
  }

  @Post(':id/delete')
  @HttpCode(200)
  delete(@Param('id') id: string) {
    return this.pages.delete(id);
  }
}
