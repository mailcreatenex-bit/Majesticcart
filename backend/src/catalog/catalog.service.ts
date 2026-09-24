import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { rupeesToPaise, bvToCenti, formatInr, centiToBvString, Paise } from '../common/money';
import { toCsvRow } from '../common/csv';
import { CATEGORY_TREE, CATEGORY_TREE_KEY } from './category-tree';
import { BRAND_SEED, BRAND_SEED_KEY } from './brand-seed';

/**
 * Product catalogue.
 *
 * Two fields here are not optional decoration, whatever a generic e-commerce
 * template would suggest:
 *
 *   • hsnCode — a GST invoice is invalid without the HSN of each line item.
 *     Discovering that at the first audit means reissuing every invoice ever
 *     raised, so it is required at creation rather than backfilled later.
 *
 *   • countryOfOrigin — the Consumer Protection (E-Commerce) Rules, 2020
 *     require it displayed on the product page.
 *
 * The BV rule is the one with money behind it. BV drives every commission
 * payout, so a product whose BV approaches its price cannot fund the payouts it
 * generates — the company pays out more than the margin on that sale. The
 * service refuses the impossible case and warns on the merely unwise one.
 */

/* Common cosmetics HSN codes, offered as suggestions in the admin UI. The list
   is a convenience, not a whitelist: the client's CA decides the real mapping. */
export const COSMETICS_HSN = [
  { code: '3303', label: 'Perfumes and toilet waters', gstBp: 1800 },
  { code: '3304', label: 'Beauty, make-up and skin-care preparations', gstBp: 1800 },
  { code: '3305', label: 'Preparations for use on the hair', gstBp: 1800 },
  { code: '3307', label: 'Pre-shave, shaving, deodorants, bath preparations', gstBp: 1800 },
  { code: '3401', label: 'Soap and organic surface-active products', gstBp: 1800 },
  { code: '1515', label: 'Vegetable oils, fixed, including hair oils', gstBp: 500 },
] as const;

const rupees = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most two decimals');

export const ProductInputSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'SKU: 3 to 24 letters, digits or hyphens'),
  name: z.string().trim().min(3, 'Product name is too short').max(120),
  description: z.string().trim().max(2000).optional(),
  ingredients: z.string().trim().max(2000).optional(),
  howToUse: z.string().trim().max(2000).optional(),
  categoryId: z.string().min(1, 'Choose a category'),
  // Optional: a product can go live before its brand does. Left blank, the
  // storefront shows it as unbranded rather than blocking the save on it.
  brandId: z.string().trim().min(1).optional(),
  mrp: rupees,
  price: rupees,
  bv: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a BV value'),
  gstBp: z.number().int().min(0).max(4000),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits — a GST invoice is invalid without it'),
  countryOfOrigin: z.string().trim().min(2).max(60).default('India'),
  stock: z.number().int().min(0),
  isActive: z.boolean().default(true),
  imageUrl: z.string().trim().max(500).optional(),
  galleryImages: z.array(z.string().trim().max(500)).max(12, 'Up to 12 gallery images').default([]),
});
export type ProductInput = z.infer<typeof ProductInputSchema>;

/** One row of a product CSV — the same fields as ProductInputSchema, but category/brand are names (what a spreadsheet actually holds), not ids. */
const CsvRowSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'SKU: 3 to 24 letters, digits or hyphens'),
  name: z.string().trim().min(3, 'Name is too short').max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().min(1, 'Category is required'),
  brand: z.string().trim().optional(),
  mrp: rupees,
  price: rupees,
  bv: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a BV value'),
  gstBp: z.coerce.number().int().min(0).max(4000),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits'),
  countryOfOrigin: z.string().trim().min(2).max(60).default('India'),
  stock: z.coerce.number().int().min(0),
  isActive: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() !== 'false' && v.trim() !== '0' : v), z.boolean()).default(true),
  imageUrl: z.string().trim().max(500).optional(),
});

export interface CsvImportRowResult {
  row: number;
  sku?: string;
  status: 'created' | 'updated' | 'error';
  message?: string;
}

export const StockAdjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, 'Enter a non-zero adjustment'),
  reason: z.string().trim().min(4, 'Record why stock is being adjusted'),
});

export interface PricingWarning {
  level: 'error' | 'warning';
  message: string;
}

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly log = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async onModuleInit(): Promise<void> {
    // Never let a category problem stop the API from starting.
    await this.seedCategoryTree().catch((e) => this.log.error(`Category tree seed failed: ${e instanceof Error ? e.message : e}`));
    await this.seedBrands().catch((e) => this.log.error(`Brand seed failed: ${e instanceof Error ? e.message : e}`));
  }

  /** Writes the starting brand list once; existing brands (matched by name or slug) are kept and only gain a logo if they had none. */
  private async seedBrands(): Promise<void> {
    const done = await this.prisma.storeSetting.findUnique({ where: { key: BRAND_SEED_KEY } });
    if (done) return;
    for (const b of BRAND_SEED) {
      const slug = slugify(b.name);
      const logoUrl = `/brands/${b.logo}`;
      const existing = await this.prisma.brand.findFirst({ where: { OR: [{ name: b.name }, { slug }] } });
      if (existing) {
        if (!existing.logoUrl) await this.prisma.brand.update({ where: { id: existing.id }, data: { logoUrl } });
      } else {
        await this.prisma.brand.create({ data: { name: b.name, slug, logoUrl } });
      }
    }
    await this.prisma.storeSetting.create({ data: { key: BRAND_SEED_KEY, value: { seededAt: new Date().toISOString() } as never } });
    this.log.log(`Brands seeded: ${BRAND_SEED.length}`);
  }

  /**
   * Writes the client's category sheet the first time the API starts with the tree
   * feature, then records that it has, so later restarts leave the admin's edits
   * alone. Existing categories are matched by name and reused.
   */
  private async seedCategoryTree(): Promise<void> {
    const done = await this.prisma.storeSetting.findUnique({ where: { key: CATEGORY_TREE_KEY } });
    if (done) return;

    let sort = 0;
    const upsert = async (name: string, parentId: string | null) => {
      const slug = slugify(name);
      const existing = await this.prisma.category.findFirst({ where: { OR: [{ name }, { slug }] } });
      sort += 1;
      if (existing) {
        return this.prisma.category.update({ where: { id: existing.id }, data: { parentId, sortkey: sort } });
      }
      return this.prisma.category.create({ data: { name, slug, parentId, sortkey: sort } });
    };
    for (const dept of CATEGORY_TREE) {
      const parent = await upsert(dept.name, null);
      for (const child of dept.children) await upsert(child, parent.id);
    }
    await this.prisma.storeSetting.create({ data: { key: CATEGORY_TREE_KEY, value: { seededAt: new Date().toISOString() } as never } });
    this.log.log(`Category tree seeded: ${CATEGORY_TREE.length} departments`);
  }

  /**
   * First name and code only, for a member's public storefront banner
   * ("Shopping with Priya") — the same privacy discipline the team view
   * applies to a downline (`view.service.ts`'s `network()`), extended to
   * public pages: a member's referral link identifies them to a stranger by
   * first name, not their full legal name, phone, or anything else.
   *
   * Returns null rather than throwing for "not found" or "not active" alike —
   * a storefront page that can't identify the seller falls back to a plain
   * shop page rather than leaking which of those two cases it was.
   */
  async storefrontMember(memberCode: string): Promise<{ code: string; firstName: string } | null> {
    const member = await this.prisma.member.findUnique({
      where: { memberCode: memberCode.trim().toUpperCase() },
      select: { memberCode: true, name: true, status: true },
    });
    if (!member || member.status !== 'ACTIVE') return null;
    return { code: member.memberCode, firstName: member.name.split(' ')[0] };
  }

  /**
   * Check a product's economics against the commission plan.
   *
   * Returns rather than throws for the warning cases, so the admin console can
   * show the consequence and let a human decide. Only the arithmetically
   * impossible case is an error.
   */
  async priceCheck(pricePaise: Paise, bvCenti: number): Promise<PricingWarning[]> {
    const out: PricingWarning[] = [];
    if (bvCenti < 0) return [{ level: 'error', message: 'BV cannot be negative.' }];

    // BV and paise share a scale because the plan treats 1 BV as ₹1.
    const bvAsPaise = BigInt(bvCenti);
    if (bvAsPaise > pricePaise) {
      out.push({
        level: 'error',
        message: `BV of ${centiToBvString(bvCenti)} is higher than the selling price of ${formatInr(pricePaise)}. Commission would exceed the revenue from the sale.`,
      });
      return out;
    }

    // What the live plan actually commits per 100 BV.
    const planRow = await this.prisma.planVersion.findFirst({ orderBy: { version: 'desc' } });
    if (!planRow || bvAsPaise === 0n) return out;

    const plan = planRow.config as { ranks: { selfPctBp: number }[]; generation: { enabled: boolean; levelsBp: number[] }; direct: { enabled: boolean; pctBp: number }; royalty: { funds: { poolPctBp: number }[] } };
    const topSelfBp = Math.max(...plan.ranks.map((r) => r.selfPctBp));
    const genBp = plan.generation?.enabled ? (plan.generation.levelsBp ?? []).reduce((a, b) => a + b, 0) : 0;
    const directBp = plan.direct?.enabled ? plan.direct.pctBp : 0;
    const royaltyBp = (plan.royalty?.funds ?? []).reduce((a, f) => a + f.poolPctBp, 0);
    const totalBp = topSelfBp + genBp + directBp + royaltyBp;

    const worstCasePayout = (bvAsPaise * BigInt(totalBp)) / 10_000n;
    if (worstCasePayout > pricePaise) {
      out.push({
        level: 'error',
        message: `At ${totalBp / 100}% of BV, the worst-case payout on this product is ${formatInr(worstCasePayout)} against a selling price of ${formatInr(pricePaise)}.`,
      });
    } else {
      const marginLeft = pricePaise - worstCasePayout;
      // Under a fifth of the price left after commission leaves nothing for
      // cost of goods, GST, shipping and overhead.
      if (marginLeft * 5n < pricePaise) {
        out.push({
          level: 'warning',
          message: `Only ${formatInr(marginLeft)} of the ${formatInr(pricePaise)} price is left after worst-case commission. Check this covers cost of goods, GST and delivery.`,
        });
      }
    }
    return out;
  }

  async list(opts: {
    categoryId?: string;
    /** The storefront filters by slug, which is what its URLs carry. */
    categorySlug?: string;
    brandId?: string;
    brandSlug?: string;
    /** Rupee strings, same as the rest of the admin/member-facing API. */
    minPrice?: string;
    maxPrice?: string;
    sort?: 'price_asc' | 'price_desc' | 'newest' | 'popular';
    search?: string;
    includeInactive?: boolean;
    cursor?: string;
    take?: number;
  } = {}) {
    const where: Record<string, unknown> = {};
    if (!opts.includeInactive) where.isActive = true;
    // A department also lists what is filed under its sub-categories. A slug that
    // matches nothing must return nothing, not everything - hence filtering on the
    // relation rather than resolving it and ignoring a miss.
    const and: Record<string, unknown>[] = [];
    if (opts.categoryId) and.push({ category: { OR: [{ id: opts.categoryId }, { parentId: opts.categoryId }] } });
    if (opts.categorySlug) and.push({ category: { OR: [{ slug: opts.categorySlug }, { parent: { slug: opts.categorySlug } }] } });
    if (and.length) where.AND = and;
    if (opts.brandId) where.brandId = opts.brandId;
    if (opts.brandSlug) where.brand = { slug: opts.brandSlug };
    if (opts.minPrice || opts.maxPrice) {
      where.pricePaise = {
        ...(opts.minPrice ? { gte: rupeesToPaise(opts.minPrice) } : {}),
        ...(opts.maxPrice ? { lte: rupeesToPaise(opts.maxPrice) } : {}),
      };
    }
    if (opts.search?.trim()) {
      where.OR = [
        { name: { contains: opts.search.trim(), mode: 'insensitive' } },
        { sku: { contains: opts.search.trim().toUpperCase() } },
      ];
    }

    // Cursor pagination only has one stable order to page through consistently
    // — price/newest sorts are for the shop's own dropdown, which re-fetches
    // page one rather than paging through a sorted view.
    const orderBy = opts.cursor || !opts.sort
      ? [{ isActive: 'desc' as const }, { sku: 'asc' as const }]
      : opts.sort === 'price_asc' ? [{ pricePaise: 'asc' as const }]
      : opts.sort === 'price_desc' ? [{ pricePaise: 'desc' as const }]
      : opts.sort === 'popular' ? [{ sold: 'desc' as const }]
      : [{ createdAt: 'desc' as const }];

    const rows = await this.prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true } },
      },
      orderBy,
      take: 51,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, 50);
    return { items: page, nextCursor: rows.length > 50 ? page[page.length - 1].id : null };
  }

  async bySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!product) throw new NotFoundException('That product is not available.');
    return product;
  }

  async create(input: ProductInput, actorId: string) {
    const pricePaise = rupeesToPaise(input.price);
    const mrpPaise = rupeesToPaise(input.mrp);
    const bvCenti = bvToCenti(input.bv);

    if (pricePaise > mrpPaise) throw new BadRequestException('Selling price cannot be above MRP.');
    if (pricePaise <= 0n) throw new BadRequestException('Selling price must be more than zero.');

    const problems = (await this.priceCheck(pricePaise, bvCenti)).filter((p) => p.level === 'error');
    if (problems.length) throw new BadRequestException(problems[0].message);

    await this.prisma.category.findUniqueOrThrow({ where: { id: input.categoryId } }).catch(() => {
      throw new BadRequestException('That category does not exist.');
    });
    if (input.brandId) {
      await this.prisma.brand.findUniqueOrThrow({ where: { id: input.brandId } }).catch(() => {
        throw new BadRequestException('That brand does not exist.');
      });
    }

    try {
      const product = await this.prisma.product.create({
        data: {
          sku: input.sku,
          slug: await this.uniqueSlug(input.name),
          name: input.name,
          description: input.description ?? null,
          ingredients: input.ingredients || null,
          howToUse: input.howToUse || null,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          mrpPaise, pricePaise, bvCenti,
          gstBp: input.gstBp,
          hsnCode: input.hsnCode,
          countryOfOrigin: input.countryOfOrigin,
          stock: input.stock,
          isActive: input.isActive,
          imageUrl: input.imageUrl ?? null,
          galleryImages: input.galleryImages ?? [],
        },
      });
      await this.audit(actorId, 'product.create', { sku: product.sku, name: product.name, price: input.price, bv: input.bv });
      return product;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`SKU ${input.sku} is already used.`);
      }
      throw e;
    }
  }

  /**
   * Update a product.
   *
   * The slug is deliberately NOT regenerated on a rename. It is the public URL:
   * changing it silently 404s every link a member has already shared, and those
   * links are how this business gets traffic.
   */
  async update(id: string, input: ProductInput, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found.');

    const pricePaise = rupeesToPaise(input.price);
    const mrpPaise = rupeesToPaise(input.mrp);
    const bvCenti = bvToCenti(input.bv);

    if (pricePaise > mrpPaise) throw new BadRequestException('Selling price cannot be above MRP.');
    const problems = (await this.priceCheck(pricePaise, bvCenti)).filter((p) => p.level === 'error');
    if (problems.length) throw new BadRequestException(problems[0].message);

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        sku: input.sku, name: input.name, description: input.description ?? null,
        ingredients: input.ingredients || null, howToUse: input.howToUse || null,
        categoryId: input.categoryId, brandId: input.brandId ?? null, mrpPaise, pricePaise, bvCenti,
        gstBp: input.gstBp, hsnCode: input.hsnCode, countryOfOrigin: input.countryOfOrigin,
        stock: input.stock, isActive: input.isActive, imageUrl: input.imageUrl ?? null,
        galleryImages: input.galleryImages ?? [],
      },
    });

    // A BV change alters what every future sale pays out, so it is logged
    // distinctly from an ordinary edit.
    if (existing.bvCenti !== bvCenti) {
      await this.audit(actorId, 'product.bv_change', {
        sku: product.sku,
        from: centiToBvString(existing.bvCenti),
        to: centiToBvString(bvCenti),
      });
    }
    await this.audit(actorId, 'product.update', { sku: product.sku, price: input.price, stock: input.stock });
    return product;
  }

  /**
   * Products are never deleted, only deactivated.
   *
   * Order lines reference them for history, and a deleted row would break every
   * past invoice and every commission record that cites the sale.
   */
  async setActive(id: string, isActive: boolean, actorId: string) {
    const product = await this.prisma.product.update({ where: { id }, data: { isActive } });
    await this.audit(actorId, isActive ? 'product.activate' : 'product.deactivate', { sku: product.sku });
    return product;
  }

  /**
   * Adjust stock by a delta, never by setting an absolute value.
   *
   * An absolute set is a lost update waiting to happen: two admins reading 40
   * and writing 45 and 38 leave whichever wrote last, silently discarding the
   * other's count. A delta composes.
   */
  async adjustStock(id: string, delta: number, reason: string, actorId: string) {
    const updated = await this.prisma.product.updateMany({
      where: { id, ...(delta < 0 ? { stock: { gte: -delta } } : {}) },
      data: { stock: { increment: delta } },
    });
    if (updated.count === 0) {
      const current = await this.prisma.product.findUnique({ where: { id }, select: { stock: true } });
      throw new ConflictException(`Only ${current?.stock ?? 0} in stock; cannot remove ${-delta}.`);
    }
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id }, select: { sku: true, stock: true } });
    await this.audit(actorId, 'product.stock_adjust', { sku: product.sku, delta, reason, newStock: product.stock });
    return product;
  }

  async lowStock(threshold = 10) {
    return this.prisma.product.findMany({
      where: { isActive: true, stock: { lte: threshold } },
      select: { id: true, sku: true, name: true, stock: true, sold: true },
      orderBy: { stock: 'asc' },
      take: 50,
    });
  }

  /* ----------------------------------------------------------- categories */

  async categories() {
    return this.prisma.category.findMany({ orderBy: [{ sortkey: 'asc' }, { name: 'asc' }] });
  }

  async createCategory(name: string, actorId: string, parentId?: string | null) {
    const clean = name.trim();
    if (clean.length < 2) throw new BadRequestException('Category name is too short.');
    if (parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) throw new BadRequestException('That parent category does not exist.');
      if (parent.parentId) throw new BadRequestException('Categories nest one level only - choose a top-level category as the parent.');
    }
    try {
      const last = await this.prisma.category.aggregate({ _max: { sortkey: true } });
      const cat = await this.prisma.category.create({
        data: { name: clean, slug: slugify(clean), parentId: parentId ?? null, sortkey: (last._max.sortkey ?? 0) + 1 },
      });
      await this.audit(actorId, 'category.create', { name: clean, parentId: parentId ?? null });
      return cat;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A category called "${clean}" already exists.`);
      }
      throw e;
    }
  }

  /** Refuses to remove a category that still holds products. */
  async deleteCategory(id: string, actorId: string) {
    const kids = await this.prisma.category.count({ where: { parentId: id } });
    if (kids > 0) {
      throw new ConflictException(`This category still has ${kids} sub-categor${kids === 1 ? 'y' : 'ies'}. Remove or move them first.`);
    }
    const count = await this.prisma.product.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new ConflictException(`${count} product${count === 1 ? '' : 's'} still use this category. Move them first.`);
    }
    const cat = await this.prisma.category.delete({ where: { id } });
    await this.audit(actorId, 'category.delete', { name: cat.name });
    return { ok: true as const };
  }

  /* --------------------------------------------------------------- brands */

  /** Every brand, active or not — the admin console needs to see and re-enable a paused one. */
  async brands() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  /**
   * Every active brand with how many visible products it has. Brands with none are
   * still returned: the storefront shows them in the filter and the "Brands we carry"
   * strip (the store carries the brand even before a product is listed), and decides
   * for itself what to do with an empty one. A paused brand is left out - its
   * products are hidden too, so it would be a dead end.
   */
  async activeBrands() {
    const brands = await this.prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const counts = await this.prisma.product.groupBy({
      by: ['brandId'],
      where: { isActive: true, brandId: { not: null } },
      _count: true,
    });
    const countOf = new Map(counts.map((c) => [c.brandId, c._count]));
    return brands.map((b) => ({ ...b, productCount: countOf.get(b.id) ?? 0 }));
  }

  async createBrand(input: { name: string; description?: string; logoUrl?: string }, actorId: string) {
    const clean = input.name.trim();
    if (clean.length < 2) throw new BadRequestException('Brand name is too short.');
    try {
      const brand = await this.prisma.brand.create({
        data: { name: clean, slug: slugify(clean), description: input.description?.trim() || null, logoUrl: input.logoUrl?.trim() || null },
      });
      await this.audit(actorId, 'brand.create', { name: clean });
      return brand;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A brand called "${clean}" already exists.`);
      }
      throw e;
    }
  }

  async updateBrand(id: string, input: { name: string; description?: string; logoUrl?: string; isActive: boolean }, actorId: string) {
    const clean = input.name.trim();
    if (clean.length < 2) throw new BadRequestException('Brand name is too short.');
    const brand = await this.prisma.brand.update({
      where: { id },
      data: { name: clean, description: input.description?.trim() || null, logoUrl: input.logoUrl?.trim() || null, isActive: input.isActive },
    });
    await this.audit(actorId, 'brand.update', { name: clean, isActive: input.isActive });
    return brand;
  }

  /** Refuses to remove a brand that still holds products — same discipline as deleteCategory(), for the same reason. */
  async deleteBrand(id: string, actorId: string) {
    const count = await this.prisma.product.count({ where: { brandId: id } });
    if (count > 0) {
      throw new ConflictException(`${count} product${count === 1 ? '' : 's'} still use this brand. Move them first.`);
    }
    const brand = await this.prisma.brand.delete({ where: { id } });
    await this.audit(actorId, 'brand.delete', { name: brand.name });
    return { ok: true as const };
  }

  /* ------------------------------------------------------------------ csv */

  /** The header row + one example, so an admin's spreadsheet starts from something that already parses. */
  csvTemplate(): string {
    const header = ['sku', 'name', 'description', 'category', 'brand', 'mrp', 'price', 'bv', 'gstBp', 'hsnCode', 'countryOfOrigin', 'stock', 'isActive', 'imageUrl'];
    const example = ['MC-EX01', 'Example Product', 'Optional description', 'Skin Care', '', '599.00', '499.00', '250.00', '1800', '3304', 'India', '50', 'true', ''];
    return [toCsvRow(header), toCsvRow(example)].join('\r\n');
  }

  /** Every visible product, in the same column shape `importCsv` reads — export, edit, re-import round-trips. */
  async exportCsv(): Promise<string> {
    const products = await this.prisma.product.findMany({
      include: { category: true, brand: true },
      orderBy: { sku: 'asc' },
    });
    const header = ['sku', 'name', 'description', 'category', 'brand', 'mrp', 'price', 'bv', 'gstBp', 'hsnCode', 'countryOfOrigin', 'stock', 'isActive', 'imageUrl'];
    const lines = products.map((p) =>
      toCsvRow([
        p.sku, p.name, p.description ?? '', p.category.name, p.brand?.name ?? '',
        (Number(p.mrpPaise) / 100).toFixed(2), (Number(p.pricePaise) / 100).toFixed(2), (p.bvCenti / 100).toFixed(2),
        p.gstBp, p.hsnCode, p.countryOfOrigin, p.stock, p.isActive, p.imageUrl ?? '',
      ]),
    );
    return [toCsvRow(header), ...lines].join('\r\n');
  }

  /**
   * Bulk create/update by SKU.
   *
   * One row failing (a typo'd category, a BV that fails the commission
   * check) does not abort the rows around it — a 40-row spreadsheet with one
   * bad line should not need re-uploading 39 correct ones, so every row is
   * its own attempt and the whole set of results comes back for the admin to
   * read as a report.
   */
  async importCsv(csvText: string, actorId: string): Promise<CsvImportRowResult[]> {
    let records: Record<string, string>[];
    try {
      records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (e) {
      throw new BadRequestException(`Could not read that CSV: ${(e as Error).message}`);
    }
    if (records.length === 0) throw new BadRequestException('That CSV has no data rows.');
    if (records.length > 500) throw new BadRequestException('Import at most 500 rows at a time.');

    const [categories, brands] = await Promise.all([this.prisma.category.findMany(), this.prisma.brand.findMany()]);
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b]));

    const results: CsvImportRowResult[] = [];
    for (const [i, raw] of records.entries()) {
      const rowNumber = i + 2; // header is row 1, so the first data row reads as 2 — matching what a spreadsheet shows
      const parsed = CsvRowSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ row: rowNumber, sku: raw.sku, status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid row' });
        continue;
      }
      const row = parsed.data;
      try {
        const category = categoryByName.get(row.category.toLowerCase());
        if (!category) throw new BadRequestException(`Category "${row.category}" does not exist.`);
        const brand = row.brand ? brandByName.get(row.brand.toLowerCase()) : undefined;
        if (row.brand && !brand) throw new BadRequestException(`Brand "${row.brand}" does not exist.`);

        const pricePaise = rupeesToPaise(row.price);
        const mrpPaise = rupeesToPaise(row.mrp);
        const bvCenti = bvToCenti(row.bv);
        if (pricePaise > mrpPaise) throw new BadRequestException('Selling price cannot be above MRP.');
        const problems = (await this.priceCheck(pricePaise, bvCenti)).filter((p) => p.level === 'error');
        if (problems.length) throw new BadRequestException(problems[0].message);

        const data = {
          name: row.name, description: row.description ?? null,
          categoryId: category.id, brandId: brand?.id ?? null,
          mrpPaise, pricePaise, bvCenti, gstBp: row.gstBp, hsnCode: row.hsnCode,
          countryOfOrigin: row.countryOfOrigin, stock: row.stock, isActive: row.isActive,
          imageUrl: row.imageUrl || null,
        };

        const existing = await this.prisma.product.findUnique({ where: { sku: row.sku } });
        if (existing) {
          await this.prisma.product.update({ where: { id: existing.id }, data });
          results.push({ row: rowNumber, sku: row.sku, status: 'updated' });
        } else {
          await this.prisma.product.create({ data: { sku: row.sku, slug: await this.uniqueSlug(row.name), ...data } });
          results.push({ row: rowNumber, sku: row.sku, status: 'created' });
        }
      } catch (e) {
        results.push({ row: rowNumber, sku: row.sku, status: 'error', message: e instanceof Error ? e.message : 'Could not save this row.' });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const updated = results.filter((r) => r.status === 'updated').length;
    const failed = results.filter((r) => r.status === 'error').length;
    await this.audit(actorId, 'product.csv_import', { created, updated, failed, total: records.length });
    return results;
  }

  /* -------------------------------------------------------------- helpers */

  /** Feed for the sitemap. Only what is indexable. */
  async sitemapEntries() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const clash = await this.prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } });
      if (!clash) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private audit(actorId: string, action: string, detail: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId, action, detail: detail as Prisma.InputJsonValue } });
  }
}

export const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
