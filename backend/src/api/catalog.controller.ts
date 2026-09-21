import { z } from 'zod';
import { Controller, Get, Post, Put, Patch, Body, Param, Query, Res, HttpCode, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { zodBody } from '../common/zod.pipe';
import { Public, AdminOnly, MemberOnly, CurrentUser } from '../auth/guards';
import { CatalogService, ProductInputSchema, StockAdjustSchema, COSMETICS_HSN } from '../catalog/catalog.service';
import { InvoiceService } from '../invoice/invoice.service';
import { money, volume } from '../common/serialization';
import { rupeesToPaise, bvToCenti } from '../common/money';
import { PrismaClient } from '@prisma/client';

/**
 * Catalogue and invoices.
 *
 * The browse routes are @Public() — they feed the statically generated
 * storefront, which is the only part of the site a crawler sees. Everything
 * that writes is admin-only.
 */

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('brands')
  brands() {
    return this.catalog.activeBrands().then((rows) => rows.map((b) => ({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoUrl })));
  }

  @Public()
  @Get('products')
  async products(
    // `category` is a slug, as the storefront's URLs carry it. `categoryId` is
    // kept for the admin console, which works in ids.
    @Query('category') categorySlug?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brand') brandSlug?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('sort') sort?: 'price_asc' | 'price_desc' | 'newest' | 'popular',
    @Query('q') q?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const { items, nextCursor } = await this.catalog.list({
      categorySlug, categoryId, brandSlug, minPrice, maxPrice, sort, search: q ?? search, cursor,
    });
    const capped = limit ? items.slice(0, Math.max(1, Math.min(Number(limit) || 0, 50))) : items;
    return { items: capped.map(publicProduct), nextCursor: capped === items ? nextCursor : null };
  }

  @Public()
  @Get('product/:slug')
  async product(@Param('slug') slug: string) {
    return publicProduct(await this.catalog.bySlug(slug));
  }

  /** Feed for the Next.js sitemap. Only indexable products. */
  @Public()
  @Get('sitemap')
  sitemap() {
    return this.catalog.sitemapEntries();
  }

  /**
   * Backs a member's `/mc/:code` storefront banner. Not found and not active
   * return the same 404 rather than distinguishing them — see
   * `CatalogService.storefrontMember` for why.
   */
  @Public()
  @Get('storefront/:code')
  async storefront(@Param('code') code: string) {
    const member = await this.catalog.storefrontMember(code);
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }
}

const BrandInputSchema = z.object({
  name: z.string().trim().min(2, 'Brand name is too short').max(80),
  description: z.string().trim().max(500).optional(),
  logoUrl: z.string().trim().max(500).optional(),
});

@AdminOnly('ADMIN')
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  list(
    @Query('category') categoryId?: string,
    @Query('brand') brandId?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.catalog.list({ categoryId, brandId, search: q, includeInactive: true, cursor });
  }

  /** HSN suggestions for the product form. A convenience, not a whitelist. */
  @Get('hsn-codes')
  hsnCodes() {
    return COSMETICS_HSN;
  }

  /**
   * Cost a product's economics before saving it.
   *
   * BV drives every payout, so a product whose BV is too close to its price
   * cannot fund the commission it generates. The admin sees that here rather
   * than discovering it in a month of margin reports.
   */
  @Post('price-check')
  @HttpCode(200)
  priceCheck(@Body(zodBody(z.object({ price: z.string(), bv: z.string() }))) body: { price: string; bv: string }) {
    return this.catalog.priceCheck(rupeesToPaise(body.price), bvToCenti(body.bv));
  }

  @Post('products')
  create(@CurrentUser('sub') adminId: string, @Body(zodBody(ProductInputSchema)) body: z.infer<typeof ProductInputSchema>) {
    return this.catalog.create(body, adminId);
  }

  @Put('products/:id')
  update(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(ProductInputSchema)) body: z.infer<typeof ProductInputSchema>,
  ) {
    return this.catalog.update(id, body, adminId);
  }

  /** Deactivates rather than deletes: order history references the product. */
  @Patch('products/:id/active')
  setActive(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ isActive: z.boolean() }))) body: { isActive: boolean },
  ) {
    return this.catalog.setActive(id, body.isActive, adminId);
  }

  /** A delta, never an absolute set — two admins counting at once must compose. */
  @Post('products/:id/stock')
  @HttpCode(200)
  adjustStock(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(StockAdjustSchema)) body: z.infer<typeof StockAdjustSchema>,
  ) {
    return this.catalog.adjustStock(id, body.delta, body.reason, adminId);
  }

  @Get('low-stock')
  lowStock(@Query('threshold') threshold = '10') {
    return this.catalog.lowStock(Math.max(0, Number(threshold) || 10));
  }

  @Post('categories')
  createCategory(
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ name: z.string().trim().min(2) }))) body: { name: string },
  ) {
    return this.catalog.createCategory(body.name, adminId);
  }

  @Post('categories/:id/delete')
  @HttpCode(200)
  deleteCategory(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.catalog.deleteCategory(id, adminId);
  }

  /* ----------------------------------------------------------- brands */

  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Post('brands')
  createBrand(
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(BrandInputSchema)) body: z.infer<typeof BrandInputSchema>,
  ) {
    return this.catalog.createBrand(body, adminId);
  }

  @Put('brands/:id')
  updateBrand(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(BrandInputSchema.extend({ isActive: z.boolean().default(true) }))) body: z.infer<typeof BrandInputSchema> & { isActive: boolean },
  ) {
    return this.catalog.updateBrand(id, body, adminId);
  }

  @Post('brands/:id/delete')
  @HttpCode(200)
  deleteBrand(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.catalog.deleteBrand(id, adminId);
  }
}

/* ------------------------------------------------------------- invoices */

@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * A member downloads their own invoice; an admin downloads anyone's.
   *
   * Ownership is checked here because an invoice carries a name, a full
   * delivery address and a phone number — enumerable order ids would otherwise
   * expose the customer list.
   */
  @MemberOnly()
  @Get('order/:orderId')
  async mine(@Param('orderId') orderId: string, @CurrentUser('sub') memberId: string) {
    await this.assertOwner(orderId, memberId);
    return this.invoices.build(orderId);
  }

  @MemberOnly()
  @Get('order/:orderId/html')
  async mineHtml(@Param('orderId') orderId: string, @CurrentUser('sub') memberId: string, @Res() res: Response) {
    await this.assertOwner(orderId, memberId);
    res.type('html').send(await this.invoices.renderHtml(orderId));
  }

  @AdminOnly('ADMIN', 'FINANCE', 'SUPPORT')
  @Get('admin/order/:orderId/html')
  async adminHtml(@Param('orderId') orderId: string, @Res() res: Response) {
    res.type('html').send(await this.invoices.renderHtml(orderId));
  }

  private async assertOwner(orderId: string, memberId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { memberId: true } });
    // Same answer whether the order does not exist or belongs to someone else:
    // distinguishing them would confirm which ids are real.
    if (!order || order.memberId !== memberId) {
      throw new (await import('@nestjs/common')).NotFoundException('Invoice not found.');
    }
  }
}

/** The shape the storefront gets. No cost or margin fields leak out. */
function publicProduct(p: any) {
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category?.name ?? null,
    // The slug the storefront links and breadcrumbs with.
    categorySlug: p.category?.slug ?? null,
    brand: p.brand?.name ?? null,
    brandSlug: p.brand?.slug ?? null,
    price: money(p.pricePaise),
    mrp: money(p.mrpPaise),
    businessVolume: volume(p.bvCenti),
    gstPercent: p.gstBp / 100,
    hsnCode: p.hsnCode,
    // Required on the product page by the E-Commerce Rules.
    countryOfOrigin: p.countryOfOrigin,
    inStock: p.stock > 0,
    // The exact count is deliberately not published: it tells a competitor
    // the sell-through rate. "Only a few left" is enough for a buyer.
    lowStock: p.stock > 0 && p.stock <= 5,
    imageUrl: p.imageUrl,
  };
}
