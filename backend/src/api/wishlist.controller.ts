import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { MemberOnly, CurrentUser } from '../auth/guards';
import { WishlistService } from '../catalog/wishlist.service';
import { publicProduct } from './catalog.controller';

@MemberOnly()
@Controller('me/wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  /** Just the saved slugs: what every heart on the site needs to know. */
  @Get('slugs')
  slugs(@CurrentUser('sub') memberId: string) {
    return this.wishlist.slugs(memberId);
  }

  @Get()
  async list(@CurrentUser('sub') memberId: string) {
    const rows = await this.wishlist.list(memberId);
    return { items: rows.map((r) => ({ ...publicProduct(r.product), alertWhenBack: r.alertWhenBack })) };
  }

  @Put(':slug')
  @HttpCode(200)
  add(@CurrentUser('sub') memberId: string, @Param('slug') slug: string) {
    return this.wishlist.add(memberId, slug);
  }

  @Delete(':slug')
  @HttpCode(200)
  remove(@CurrentUser('sub') memberId: string, @Param('slug') slug: string) {
    return this.wishlist.remove(memberId, slug);
  }
}
