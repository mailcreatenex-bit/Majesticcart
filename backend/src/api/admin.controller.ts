import { z } from 'zod';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, BadRequestException, UseGuards } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { money, volume, parseMoneyInput } from '../common/serialization';
import { AdminOnly, RequirePermission, CurrentUser, Public, ClientContext } from '../auth/guards';
import { ThemeSettingValue } from '../settings/settings.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { RechargeService } from '../recharge/recharge.service';
import { WithdrawalService } from '../withdrawal/withdrawal.service';
import { MobileRechargeService } from '../mobile-recharge/mobile-recharge.service';
import { SecurityAlertService } from '../security/security-alert.service';
import { SettingsService } from '../settings/settings.service';
import { OrderService } from '../order/order.service';
import { CouponService, CouponInputSchema } from '../coupon/coupon.service';
import { CommissionService } from '../commission/commission.service';
import { DashboardService } from '../admin/dashboard.service';
import { ReportService } from '../reporting/report.service';
import { StorageService } from '../media/storage.service';
import { PlanConfigSchema, assertSustainable, payoutExposure, parsePlan } from '../plan/plan.config';
import { PrismaClient } from '@prisma/client';

/**
 * The admin API.
 *
 * Every route that moves money or changes the plan writes an AuditLog row in
 * the service beneath it. The role split is deliberate: FINANCE can approve
 * payments and payouts but cannot rewrite the compensation plan, because those
 * are different kinds of mistake with different blast radii.
 */

const DecisionSchema = z.object({
  note: z.string().trim().max(400).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

/* ------------------------------------------------------- recharge review */

@RequirePermission('finance.recharges')
@Controller('admin/recharges')
export class AdminRechargeController {
  constructor(
    private readonly recharges: RechargeService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaClient,
  ) {}

  @Get()
  async list(@Query('status') status = 'PENDING', @Query('cursor') cursor?: string) {
    const rows = await this.prisma.recharge.findMany({
      where: status === 'ALL' ? {} : { status: status as never },
      include: { member: { select: { memberCode: true, name: true, phone: true, rankIndex: true } } },
      orderBy: { createdAt: 'desc' },
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, 50);
    return {
      items: page.map((r: any) => ({
        id: r.id, status: r.status, utr: r.utr, flags: r.flags,
        claimed: money(r.claimedPaise), credited: r.creditedPaise ? money(r.creditedPaise) : null,
        member: r.member, createdAt: r.createdAt, reviewedAt: r.reviewedAt, note: r.reviewNote,
      })),
      nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
    };
  }

  /**
   * The screenshot is returned as a short-lived signed URL rather than a public
   * path. It shows a member's bank app, their name and their transaction
   * history — a guessable URL would leak all three.
   */
  @Get(':id/screenshot')
  async screenshot(@Param('id') id: string) {
    const r = await this.prisma.recharge.findUniqueOrThrow({ where: { id }, select: { screenshotKey: true } });
    return { url: await this.storage.signedReadUrl(r.screenshotKey, 600), expiresInSeconds: 600 };
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(DecisionSchema)) body: z.infer<typeof DecisionSchema>,
  ) {
    // A bare Error here would surface as a 500, which reads as "the system is
    // broken" rather than "you left a field empty".
    if (!body.amount) throw new BadRequestException('Enter the amount the bank statement shows.');
    return this.recharges.approve(id, { adminId, creditedPaise: parseMoneyInput(body.amount, 'amount'), note: body.note });
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(DecisionSchema.required({ note: true }))) body: { note: string },
  ) {
    return this.recharges.reject(id, { adminId, note: body.note });
  }
}

/* ------------------------------------------------------------ admin auth */

export const AdminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter the email you sign in with'),
  password: z.string().min(1, 'Enter your password'),
  // Optional at the schema level because not every admin has 2FA enabled yet.
  // Whether it is *required* is decided by the account, in loginAdmin — not
  // here, where a client could simply omit it.
  totpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator').optional(),
});

/**
 * Admin sign-in.
 *
 * Separate from the member auth controller because the two are different
 * populations with different rules: an admin signs in with an email and a
 * second factor, a member with a phone number and an OTP. Sharing one endpoint
 * would mean one set of lockout counters and one audit trail across both, and
 * "5 failed attempts" means something very different for each.
 *
 * `@Public()` on login only. Everything else here needs a token.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaClient,
  ) {}

  // The console guards real money and the plan itself, so this is tighter
  // than the member login limit — 5 tries a minute per IP, not 10.
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 5, windowSeconds: 60, keyPrefix: 'admin-login' })
  @Post('login')
  @HttpCode(200)
  login(@Body(zodBody(AdminLoginSchema)) body: z.infer<typeof AdminLoginSchema>, @ClientContext() ctx: never) {
    return this.auth.loginAdmin(body.email, body.password, body.totpCode, ctx);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(z.object({ refreshToken: z.string().min(10) }))) body: { refreshToken: string }, @ClientContext() ctx: never) {
    return this.tokens.rotate(body.refreshToken, ctx);
  }

  @AdminOnly()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(zodBody(z.object({ refreshToken: z.string().min(10) }))) body: { refreshToken: string }) {
    return this.tokens.logout(body.refreshToken);
  }

  /**
   * Who is signed in, and what they may do.
   *
   * The console uses `role` to decide what to render. That is a convenience for
   * the person, never the enforcement: every route above carries its own
   * @AdminOnly, so hiding a button and blocking the action are two independent
   * mechanisms and neither depends on the other.
   */
  @AdminOnly()
  @Get('me')
  async me(@CurrentUser('sub') adminId: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id: adminId },
      select: {
        id: true, email: true, name: true, totpEnabled: true, lastLoginAt: true,
        role: { select: { name: true, permissions: true } },
      },
    });
    return { ...admin, role: admin.role.name, permissions: admin.role.permissions };
  }

  /** Issues a fresh secret and its QR. Self-service, own account only — there is no admin-for-admin override. */
  @AdminOnly()
  @Post('totp/setup')
  @HttpCode(200)
  setupTotp(@CurrentUser('sub') adminId: string) {
    return this.auth.setupTotp(adminId);
  }

  @AdminOnly()
  @Post('totp/enable')
  @HttpCode(200)
  enableTotp(
    @Body(zodBody(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator.') }))) body: { code: string },
    @CurrentUser('sub') adminId: string,
  ) {
    return this.auth.enableTotp(adminId, body.code).then(() => ({ ok: true as const }));
  }

  @AdminOnly()
  @Post('totp/disable')
  @HttpCode(200)
  disableTotp(
    @Body(zodBody(z.object({ password: z.string().min(1, 'Enter your password.') }))) body: { password: string },
    @CurrentUser('sub') adminId: string,
  ) {
    return this.auth.disableTotp(adminId, body.password).then(() => ({ ok: true as const }));
  }
}

/* ---------------------------------------------------------- order admin */

@RequirePermission('orders.manage')
@Controller('admin/orders')
export class AdminOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * The fulfilment queue.
   *
   * Defaults to what actually needs doing — placed and packed — rather than to
   * everything. An admin opening this screen wants the orders to ship, and a
   * list that starts with 4,000 delivered ones makes them filter before they
   * can work.
   */
  @Get()
  async list(
    @Query('status') status = 'OPEN',
    @Query('cursor') cursor?: string,
  ) {
    const where =
      status === 'ALL' ? {}
      : status === 'OPEN' ? { status: { in: ['PLACED', 'PACKED'] as never[] } }
      : { status: status as never };

    const rows = await this.prisma.order.findMany({
      where,
      include: {
        member: { select: { memberCode: true, name: true, phone: true } },
        items: { select: { nameSnapshot: true, quantity: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, 50);

    return {
      items: page.map((o: any) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        total: money(o.totalPaise),
        businessVolume: volume(o.totalBvCenti),
        member: o.member,
        shipping: {
          name: o.shipName, phone: o.shipPhone, line: o.shipLine,
          city: o.shipCity, state: o.shipState, pincode: o.shipPincode,
        },
        items: o.items.map((i: any) => `${i.nameSnapshot} × ${i.quantity}`),
        invoiceNo: o.invoiceNo,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
      })),
      nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
    };
  }

  @Post(':id/status')
  @HttpCode(200)
  transition(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Body(zodBody(z.object({
      status: z.enum(['PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
      note: z.string().trim().max(200).optional(),
    }))) body: { status: 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'; note?: string },
  ) {
    return this.orders.transition(id, body.status, { actorId, note: body.note });
  }

  /**
   * Returning a delivered order reverses commission that may already have been
   * withdrawn, so it is deliberately a separate route from the status machine
   * and is restricted to ADMIN.
   */
  @RequirePermission('orders.return')
  @Post(':id/return')
  @HttpCode(200)
  returnOrder(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Body(zodBody(z.object({ reason: z.string().trim().min(4), restock: z.boolean().default(true) }))) body: { reason: string; restock: boolean },
  ) {
    return this.orders.returnDelivered(id, { actorId, reason: body.reason, restock: body.restock });
  }
}

/* --------------------------------------------------------------- coupons */

@RequirePermission('coupons.manage')
@Controller('admin/coupons')
export class AdminCouponController {
  constructor(private readonly coupons: CouponService) {}

  @Get()
  list() {
    return this.coupons.list();
  }

  @Post()
  create(@CurrentUser('sub') adminId: string, @Body(zodBody(CouponInputSchema)) body: z.infer<typeof CouponInputSchema>) {
    return this.coupons.create(body, adminId);
  }

  @Post(':id/active')
  @HttpCode(200)
  setActive(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ isActive: z.boolean() }))) body: { isActive: boolean },
  ) {
    return this.coupons.setActive(id, body.isActive, adminId);
  }
}

/* -------------------------------------------------------- payout admin */

@RequirePermission('finance.withdrawals')
@Controller('admin/withdrawals')
export class AdminWithdrawalController {
  constructor(
    private readonly withdrawals: WithdrawalService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * The payout queue.
   *
   * `payoutSnapshot` is included because finance has to read the account
   * details to make the transfer, and because it records what the payout was
   * actually sent to — which is the answer if a member later changes their
   * account and disputes where the money went.
   */
  @Get()
  async list(
    @Query('status') status = 'PENDING',
    @Query('cursor') cursor?: string,
  ) {
    const rows = await this.prisma.withdrawal.findMany({
      where: status === 'ALL' ? {} : { status: status as never },
      include: { member: { select: { memberCode: true, name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, 50);

    return {
      items: page.map((w: any) => ({
        id: w.id,
        status: w.status,
        requested: money(w.requestedPaise),
        deduction: money(w.deductionPaise),
        net: money(w.netPaise),
        deductionPercent: w.deductionBp / 100,
        member: w.member,
        payout: w.payoutSnapshot,
        transferRef: w.transferRef ?? null,
        note: w.reviewNote ?? null,
        createdAt: w.createdAt,
        reviewedAt: w.reviewedAt ?? null,
      })),
      nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
    };
  }

  @Post(':id/paid')
  @HttpCode(200)
  markPaid(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ transferRef: z.string().trim().min(6, 'Enter the transfer reference') }))) body: { transferRef: string },
  ) {
    return this.withdrawals.markPaid(id, { adminId, transferRef: body.transferRef });
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ note: z.string().trim().min(4, 'Add a reason') }))) body: { note: string },
  ) {
    return this.withdrawals.reject(id, { adminId, note: body.note });
  }
}

/* ---------------------------------------------------- mobile recharge admin */

@RequirePermission('finance.mobile_recharges')
@Controller('admin/mobile-recharges')
export class AdminMobileRechargeController {
  constructor(private readonly mobileRecharges: MobileRechargeService) {}

  @Get()
  async list() {
    const rows = await this.mobileRecharges.listPendingForAdmin();
    return rows.map((r) => ({
      id: r.id,
      mobileNumber: r.mobileNumber,
      operator: r.operator,
      amount: money(r.amountPaise),
      member: r.member,
      createdAt: r.createdAt,
    }));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ operatorRef: z.string().trim().min(1, 'Enter the recharge reference') }))) body: { operatorRef: string },
  ) {
    return this.mobileRecharges.complete(id, { adminId, operatorRef: body.operatorRef });
  }

  @Post(':id/fail')
  @HttpCode(200)
  fail(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({ reason: z.string().trim().min(4, 'Add a reason') }))) body: { reason: string },
  ) {
    return this.mobileRecharges.fail(id, { adminId, reason: body.reason });
  }
}

/* ------------------------------------------------------------ the plan */

/**
 * Plan edits are ADMIN only. FINANCE approving a payment is a recoverable
 * mistake; FINANCE setting self income to 90% is not.
 */
@RequirePermission('plan.manage')
@Controller('admin/plan')
export class AdminPlanController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly commission: CommissionService,
  ) {}

  @Get()
  async current() {
    const row = await this.prisma.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
    const plan = parsePlan(row.config);
    return { version: row.version, activeFrom: row.activeFrom, plan, exposure: payoutExposure(plan) };
  }

  /** Every change writes a new version. Nothing is ever edited in place. */
  @Get('versions')
  versions() {
    return this.prisma.planVersion.findMany({
      orderBy: { version: 'desc' }, take: 50,
      select: { id: true, version: true, note: true, createdAt: true, createdById: true },
    });
  }

  /**
   * Cost a proposed plan before saving it.
   *
   * The exposure ceiling is the difference between a plan the catalogue can
   * fund and one that quietly runs the company into the ground, so the admin
   * sees the number before committing rather than after.
   */
  @Post('preview')
  @HttpCode(200)
  preview(@Body(zodBody(PlanConfigSchema)) plan: z.infer<typeof PlanConfigSchema>) {
    const exposure = payoutExposure(plan);
    let sustainable = true;
    let warning: string | null = null;
    try {
      assertSustainable(plan);
    } catch (e) {
      sustainable = false;
      warning = (e as Error).message;
    }
    return { exposure, sustainable, warning };
  }

  @Post()
  async save(
    @CurrentUser('sub') adminId: string,
    @Body(zodBody(z.object({
      plan: PlanConfigSchema,
      note: z.string().trim().max(200).optional(),
      acceptUnlimited: z.boolean().default(false),
    }))) body: { plan: z.infer<typeof PlanConfigSchema>; note?: string; acceptUnlimited: boolean },
  ) {
    assertSustainable(body.plan, { acceptUnlimited: body.acceptUnlimited });
    const row = await this.prisma.planVersion.create({
      data: { config: body.plan as never, note: body.note, createdById: adminId },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: adminId, action: 'plan.publish', detail: { version: row.version, note: body.note } },
    });
    // Re-sort every member against the new ladder. Nobody loses income already
    // credited; only their current rank moves.
    await this.recomputeRanks(body.plan);
    return { version: row.version, activeFrom: row.activeFrom };
  }

  private async recomputeRanks(plan: z.infer<typeof PlanConfigSchema>) {
    const members = await this.prisma.member.findMany({
      where: { isCompany: false }, select: { id: true, selfBvCenti: true, groupBvCenti: true, rankIndex: true },
    });
    for (const m of members) {
      const basis = plan.rankBasis === 'TEAM_BV' ? m.groupBvCenti - m.selfBvCenti : m.groupBvCenti;
      let next = 0;
      plan.ranks.forEach((r, i) => { if (Number(basis) >= r.minBvCenti) next = i; });
      if (next !== m.rankIndex) {
        await this.prisma.member.update({ where: { id: m.id }, data: { rankIndex: next } });
      }
    }
  }

  @Get('royalty/pools')
  async royaltyPools() {
    const rows = await this.commission.royaltyPoolBalances();
    return rows.map((r) => ({ fundKey: r.fundKey, name: r.name, pool: money(r.poolPaise) }));
  }

  @Post('royalty/:fundKey/distribute')
  @HttpCode(200)
  async distribute(@Param('fundKey') fundKey: string, @CurrentUser('sub') adminId: string) {
    const r = await this.commission.distributeRoyalty(fundKey, adminId);
    return { runId: r.runId, perHead: money(r.perHeadPaise), qualifiers: r.qualifiers };
  }
}

/* --------------------------------------------------------- dashboard */

@RequirePermission('dashboard.view')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary() {
    return this.dashboard.summary();
  }

  @Get('series')
  series(@Query('days') days = '14') {
    return this.dashboard.dailySeries(Math.min(Math.max(Number(days) || 14, 1), 90));
  }

  @Get('commission-breakdown')
  breakdown() {
    return this.dashboard.commissionBreakdown();
  }

  @Get('top-earners')
  topEarners(@Query('limit') limit = '10') {
    return this.dashboard.topEarners(Math.min(Number(limit) || 10, 50));
  }

  /**
   * Should always return an empty list. Anything else means something wrote to
   * Wallet outside LedgerService, which is an incident rather than a report.
   */
  @RequirePermission('finance.ledger_drift')
  @Get('ledger-drift')
  drift() {
    return this.dashboard.ledgerDrift();
  }
}

/* ----------------------------------------------------------- reports */

@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService, private readonly prisma: PrismaClient) {}

  /** The field picker for the report builder. Carries no SQL. */
  @RequirePermission('reports.view')
  @Get('catalog')
  catalog() {
    return this.reports.catalog();
  }

  /**
   * Open to members as well as staff. Which reports a member may run, and how
   * far their rows are scoped, is decided by the compiler from the caller's
   * identity — never by the saved definition.
   */
  @Get(':key')
  async run(
    @Param('key') key: string,
    @CurrentUser() user: { sub: string; typ: 'MEMBER' | 'ADMIN'; role?: string },
    @Query('onBehalfOf') onBehalfOf?: string,
  ) {
    const caller = await this.buildCaller(user, onBehalfOf);
    return this.reports.run(key, caller);
  }

  @RequirePermission('reports.manage')
  @Post('preview')
  @HttpCode(200)
  async preview(@Body() definition: unknown, @CurrentUser() user: { sub: string; role?: string }) {
    return this.reports.preview(definition, { type: 'ADMIN', id: user.sub, role: user.role });
  }

  @RequirePermission('reports.manage')
  @Put(':key')
  save(@Param('key') key: string, @Body() definition: unknown, @CurrentUser('sub') adminId: string) {
    return this.reports.save({ ...(definition as object), key }, adminId);
  }

  @RequirePermission('reports.manage')
  @Delete(':key')
  @HttpCode(204)
  async remove(@Param('key') key: string, @CurrentUser('sub') adminId: string) {
    await this.reports.delete(key, adminId);
  }

  /**
   * An admin viewing a member report must name the member. The genealogy path
   * is read here rather than taken from the request, so the scope cannot be
   * widened by sending a shorter path.
   */
  private async buildCaller(user: { sub: string; typ: 'MEMBER' | 'ADMIN'; role?: string }, onBehalfOf?: string) {
    if (user.typ === 'MEMBER') {
      const m = await this.prisma.member.findUniqueOrThrow({
        where: { id: user.sub }, select: { id: true, ancestorPath: true },
      });
      return { type: 'MEMBER' as const, id: user.sub, memberId: m.id, ancestorPath: m.ancestorPath };
    }
    if (!onBehalfOf) return { type: 'ADMIN' as const, id: user.sub, role: user.role };
    const subject = await this.prisma.member.findUniqueOrThrow({
      where: { memberCode: onBehalfOf.toUpperCase() }, select: { id: true, ancestorPath: true },
    });
    return {
      type: 'ADMIN' as const, id: user.sub, role: user.role,
      onBehalfOf: { memberId: subject.id, ancestorPath: subject.ancestorPath },
    };
  }
}

/* ------------------------------------------------------------- settings */

const GeminiKeySchema = z.object({ apiKey: z.string().min(1, 'Paste your Gemini API key.') });

const PaymentSettingsSchema = z.object({
  upiId: z.string().min(1, 'Enter a UPI ID.'),
  payeeName: z.string().min(1, 'Enter a payee name.'),
  minRecharge: z.string().min(1),
  maxRecharge: z.string().min(1),
  note: z.string().max(500).optional(),
});

@RequirePermission('settings.manage')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('ai')
  ai() {
    return this.settings.aiStatus();
  }

  @Post('ai')
  @HttpCode(200)
  setAiKey(@Body(zodBody(GeminiKeySchema)) body: z.infer<typeof GeminiKeySchema>, @CurrentUser('sub') adminId: string) {
    return this.settings.setGeminiKey(body.apiKey, adminId).then(() => ({ ok: true as const }));
  }

  @Post('ai/clear')
  @HttpCode(200)
  clearAiKey(@CurrentUser('sub') adminId: string) {
    return this.settings.clearGeminiKey(adminId).then(() => ({ ok: true as const }));
  }

  /**
   * The UPI ID and payee name behind the recharge screen's QR — where a
   * member's payment actually lands. Rupee amounts in, over the wire, the
   * same as every other money field in this API; converted to paise here
   * rather than asking the console to do it.
   */
  @Get('payment')
  async payment() {
    const [s, qrUrl] = await Promise.all([this.settings.paymentSettings(), this.settings.paymentQrPreview()]);
    return {
      upiId: s.upiId,
      payeeName: s.payeeName,
      minRecharge: money(BigInt(s.minRechargePaise)),
      maxRecharge: money(BigInt(s.maxRechargePaise)),
      note: s.note,
      qrUrl,
    };
  }

  @Post('payment')
  @HttpCode(200)
  async setPayment(
    @Body(zodBody(PaymentSettingsSchema)) body: z.infer<typeof PaymentSettingsSchema>,
    @CurrentUser('sub') adminId: string,
  ) {
    await this.settings.setPaymentSettings({
      upiId: body.upiId,
      payeeName: body.payeeName,
      minRechargePaise: parseMoneyInput(body.minRecharge, 'minRecharge').toString(),
      maxRechargePaise: parseMoneyInput(body.maxRecharge, 'maxRecharge').toString(),
      note: body.note ?? '',
    }, adminId);
    return { ok: true as const };
  }
}

/* ---------------------------------------------------------------- theme */

const ThemeSettingSchema = z.object({
  colors: z.object({ ink: z.string(), accent: z.string(), gold: z.string() }),
  logoUrl: z.string().trim().max(500).default(''),
  hero: z.object({
    eyebrow: z.string().trim().max(60),
    title: z.string().trim().max(200),
    subtitle: z.string().trim().max(400),
    primaryCtaLabel: z.string().trim().max(40),
    primaryCtaHref: z.string().trim().max(200),
    secondaryCtaLabel: z.string().trim().max(40),
    secondaryCtaHref: z.string().trim().max(200),
    imageUrl: z.string().trim().max(500).default(''),
  }),
});

/** Read by the storefront on every homepage render — public, since it's exactly what the page already shows every visitor. */
@Controller('theme')
export class ThemeController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  get() {
    return this.settings.theme();
  }
}

@RequirePermission('theme.manage')
@Controller('admin/theme')
export class AdminThemeController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.theme();
  }

  @Post()
  @HttpCode(200)
  async set(@Body(zodBody(ThemeSettingSchema)) body: ThemeSettingValue, @CurrentUser('sub') adminId: string) {
    await this.settings.setTheme(body, adminId);
    return { ok: true as const };
  }
}

@RequirePermission('security.view')
@Controller('admin/security-alerts')
export class AdminSecurityController {
  constructor(private readonly alerts: SecurityAlertService) {}

  @Get()
  async list() {
    const rows = await this.alerts.listOpen();
    return rows.map((a) => ({
      id: a.id,
      severity: a.severity,
      type: a.type,
      message: a.message,
      memberId: a.memberId,
      refType: a.refType,
      refId: a.refId,
      createdAt: a.createdAt,
    }));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.alerts.resolve(id, adminId);
  }
}
