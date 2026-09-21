import { z } from 'zod';
import {
  Controller, Get, Post, Patch, Body, Param, Query, HttpCode, Req, UseGuards,
} from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { money, volume, parseMoneyInput } from '../common/serialization';
import { Public, MemberOnly, CurrentUser, ClientContext } from '../auth/guards';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { OrderService } from '../order/order.service';
import { RechargeService } from '../recharge/recharge.service';
import { WithdrawalService } from '../withdrawal/withdrawal.service';
import { MobileRechargeService } from '../mobile-recharge/mobile-recharge.service';
import { RechargePlansService, type PlanOperator } from '../mobile-recharge/recharge-plans.service';
import { ShadeFinderService } from '../shade-finder/shade-finder.service';
import { StorageService } from '../media/storage.service';
import { MemberViewService } from '../member/view.service';
import { ProfileService } from '../member/profile.service';

/**
 * The member-facing API.
 *
 * Thin on purpose: every rule lives in a service that is unit-tested without
 * HTTP. A controller parses, delegates, and shapes the response — if business
 * logic starts appearing here, it belongs one layer down.
 *
 * Routes are protected by the global AuthGuard unless marked @Public().
 */

/* ------------------------------------------------------------- schemas */

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
const money9 = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount with at most two decimals');

export const RequestOtpSchema = z.object({
  phone,
  purpose: z.enum(['LOGIN', 'SIGNUP', 'RESET']),
});

export const SignupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(60),
  phone,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  sponsorCode: z.string().trim().toUpperCase().regex(/^MC\d{4,12}$/, 'Check the sponsor ID').optional().or(z.literal('')),
  otpCode: z.string().regex(/^\d{6}$/).optional(),
});

export const LoginSchema = z.object({
  identifier: z.string().trim().min(4, 'Enter your mobile number or member ID'),
  password: z.string().min(1, 'Enter your password'),
});

export const OtpLoginSchema = z.object({ phone, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const ResetSchema = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(128),
});

export const AddressSchema = z.object({
  name: z.string().trim().min(2, "Enter the recipient's name"),
  phone,
  line: z.string().trim().min(6, 'Enter the full street address'),
  city: z.string().trim().min(2, 'Enter the city'),
  state: z.string().trim().min(2, 'Choose the state'),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
});

export const CheckoutSchema = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1, 'Your bag is empty'),
  shipping: AddressSchema,
  // Client-generated, so a double-tapped Pay button cannot place two orders.
  requestId: z.string().uuid().optional(),
  couponCode: z.string().trim().max(24).optional(),
});

export const QuoteSchema = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1),
  // Only the state matters for the split; the PIN code is accepted so the
  // client can send the whole address form without filtering it first.
  state: z.string().trim().min(2),
  pincode: z.string().optional(),
  couponCode: z.string().trim().max(24).optional(),
});

export const RechargeSchema = z.object({
  amount: money9,
  utr: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{12,22}$/, 'Enter the UTR exactly as shown in your UPI app'),
  screenshotKey: z.string().min(4, 'Upload the payment screenshot'),
});

export const WithdrawSchema = z.object({ amount: money9 });

export const MobileRechargeSchema = z.object({
  mobileNumber: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  operator: z.enum(['JIO', 'AIRTEL', 'VI', 'BSNL', 'OTHER']),
  amount: money9,
});

export const WalletKindSchema = z.enum(['SHOPPING', 'INCOME']);

export const ProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(60).optional(),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
});

export const PayoutSchema = z.object({
  upi: z.string().trim().optional().or(z.literal('')),
  holder: z.string().trim().optional().or(z.literal('')),
  bank: z.string().trim().optional().or(z.literal('')),
  account: z.string().trim().optional().or(z.literal('')),
  ifsc: z.string().trim().toUpperCase().optional().or(z.literal('')),
});

export const UploadTicketSchema = z.object({
  purpose: z.enum(['recharge-screenshot']),
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});

/* ---------------------------------------------------------------- auth */

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  // IP limits sit on top of the per-phone throttle inside AuthService: that one
  // stops a number being spammed, this one stops one caller spraying requests
  // across many numbers — each burns SMS spend and each is an enumeration
  // attempt the per-phone limit alone does not see.
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 20, windowSeconds: 3600, keyPrefix: 'otp-request' })
  @Post('otp')
  @HttpCode(200)
  requestOtp(@Body(zodBody(RequestOtpSchema)) body: z.infer<typeof RequestOtpSchema>, @ClientContext() ctx: never) {
    return this.auth.requestOtp(body.phone, body.purpose, ctx);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, windowSeconds: 3600, keyPrefix: 'signup' })
  @Post('signup')
  signup(@Body(zodBody(SignupSchema)) body: z.infer<typeof SignupSchema>, @ClientContext() ctx: never) {
    return this.auth.signup(body, ctx);
  }

  // Password lockout is per-account; this is per-IP. Without it, credential
  // stuffing across many member codes from one source never trips anything —
  // each guess lands on a fresh account with a fresh lockout counter.
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, windowSeconds: 60, keyPrefix: 'login' })
  @Post('login')
  @HttpCode(200)
  login(@Body(zodBody(LoginSchema)) body: z.infer<typeof LoginSchema>, @ClientContext() ctx: never) {
    return this.auth.loginWithPassword(body.identifier, body.password, ctx);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, windowSeconds: 60, keyPrefix: 'login-otp' })
  @Post('login/otp')
  @HttpCode(200)
  loginOtp(@Body(zodBody(OtpLoginSchema)) body: z.infer<typeof OtpLoginSchema>, @ClientContext() ctx: never) {
    return this.auth.loginWithOtp(body.phone, body.code, ctx);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, windowSeconds: 3600, keyPrefix: 'reset' })
  @Post('reset')
  @HttpCode(200)
  reset(@Body(zodBody(ResetSchema)) body: z.infer<typeof ResetSchema>) {
    return this.auth.resetPassword(body.phone, body.code, body.newPassword);
  }

  /**
   * Public because the access token is expired by definition when this is
   * called. The refresh token is the credential, and rotation plus reuse
   * detection is what protects it.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(z.object({ refreshToken: z.string().min(10) }))) body: { refreshToken: string }, @ClientContext() ctx: never) {
    return this.tokens.rotate(body.refreshToken, ctx);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(zodBody(z.object({ refreshToken: z.string().min(10) }))) body: { refreshToken: string }) {
    await this.tokens.logout(body.refreshToken);
  }
}

/* --------------------------------------------------------------- orders */

@MemberOnly()
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  async checkout(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>,
  ) {
    const order = await this.orders.checkout({ memberId, ...body });
    return {
      id: order.id,
      orderNo: order.orderNo,
      total: money(order.totalPaise),
      businessVolume: volume(order.totalBvCenti),
      status: order.status,
    };
  }

  /**
   * Price a bag before placing it.
   *
   * The checkout screen needs the real total before it can say whether the
   * wallet covers it, and the total depends on the delivery state — GST is
   * CGST+SGST within the state and IGST across it. Guessing in the browser
   * would mean a Pay button that enables when the wallet cannot actually pay.
   *
   * Read-only and idempotent: it takes no lock, writes nothing, and reserves no
   * stock. The authoritative pricing still happens inside the checkout
   * transaction, so a price that changes between the quote and the order is
   * caught there rather than honoured here.
   */
  @Post('quote')
  @HttpCode(200)
  quote(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(QuoteSchema)) body: z.infer<typeof QuoteSchema>,
  ) {
    return this.orders.quote({ memberId, ...body });
  }

  /**
   * Members cancel their own orders; admins use the admin route. Ownership is
   * checked in the service, not here — a controller-level check is the kind
   * that gets forgotten when a second caller appears.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser('sub') memberId: string,
    @Param('id') id: string,
    @Body(zodBody(z.object({ reason: z.string().trim().max(200).optional() }))) body: { reason?: string },
  ) {
    return this.orders.transition(id, 'CANCELLED', { actorId: memberId, note: body.reason });
  }
}

/* ------------------------------------------------------------- wallet */

@MemberOnly()
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly recharges: RechargeService,
    private readonly withdrawals: WithdrawalService,
    private readonly mobileRecharges: MobileRechargeService,
    private readonly rechargePlans: RechargePlansService,
    private readonly storage: StorageService,
  ) {}

  /**
   * A ticket to upload the screenshot straight to object storage. The API never
   * handles the bytes: a 4 MB image through a Node process is memory pressure
   * for no benefit, and members on patchy data would upload twice.
   */
  @Post('upload-ticket')
  uploadTicket(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(UploadTicketSchema)) body: z.infer<typeof UploadTicketSchema>,
  ) {
    return this.storage.createUploadTicket({ ...body, memberId });
  }

  /**
   * Where to pay, and the QR to scan.
   *
   * The QR is rendered here rather than in the browser because it is where the
   * member's money goes: built client-side from a string the page holds, a
   * tampered bundle or a browser extension could repoint it at another account
   * and the member would have a screenshot proving they paid *someone*.
   *
   * Cached for a minute at the edge — the payee does not change often, and the
   * recharge page is opened constantly.
   */
  @Get('pay-info')
  payInfo() {
    return this.recharges.payInfo();
  }

  @Post('recharge')
  async recharge(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(RechargeSchema)) body: z.infer<typeof RechargeSchema>,
    @ClientContext() ctx: { deviceId?: string },
  ) {
    // Hash what actually landed in the bucket, not a value the client sent.
    // This is the check that catches one screenshot used by two accounts, so
    // it cannot be based on anything the client controls.
    const screenshotSha256 = await this.storage.hashObject(body.screenshotKey);
    const req = await this.recharges.submit({
      memberId,
      claimedPaise: parseMoneyInput(body.amount, 'amount'),
      utr: body.utr,
      screenshotKey: body.screenshotKey,
      screenshotSha256,
      deviceId: ctx.deviceId,
    });
    return { id: req.id, status: req.status, amount: money(req.claimedPaise), utr: req.utr };
  }

  @Get('withdrawal/quote')
  async quote(@CurrentUser('sub') memberId: string, @Query('amount') amount: string) {
    const plan = await this.withdrawals.currentPlan();
    const q = this.withdrawals.quote(plan, parseMoneyInput(amount ?? '0', 'amount'));
    const repurchase = await this.withdrawals.repurchaseStatus(memberId, plan);
    return {
      requested: money(q.requestedPaise),
      deduction: money(q.deductionPaise),
      net: money(q.netPaise),
      deductionPercent: q.deductionBp / 100,
      // The client renders a checklist instead of a bare error, so a member
      // knows what to do rather than just that they cannot withdraw.
      repurchase: {
        required: !repurchase.met,
        bought: volume(repurchase.boughtCenti),
        target: volume(repurchase.targetCenti),
      },
    };
  }

  @Post('withdrawal')
  async withdraw(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(WithdrawSchema)) body: z.infer<typeof WithdrawSchema>,
  ) {
    const w = await this.withdrawals.request(memberId, parseMoneyInput(body.amount, 'amount'));
    return { id: w.id, status: w.status, net: money(w.netPaise), deduction: money(w.deductionPaise) };
  }

  /**
   * For a member who topped up the shopping wallet and changed their mind
   * about buying — spends that balance on a mobile top-up instead. Debited
   * immediately, same as any purchase; see MobileRechargeService for why this
   * is modelled as a purchase and not a withdrawal.
   */
  @Post('mobile-recharge')
  async mobileRecharge(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(MobileRechargeSchema)) body: z.infer<typeof MobileRechargeSchema>,
  ) {
    const r = await this.mobileRecharges.request(memberId, {
      mobileNumber: body.mobileNumber,
      operator: body.operator,
      amountPaise: parseMoneyInput(body.amount, 'amount'),
    });
    return { id: r.id, status: r.status, mobileNumber: r.mobileNumber, operator: r.operator, amount: money(r.amountPaise) };
  }

  @Get('mobile-recharge')
  async mobileRechargeHistory(@CurrentUser('sub') memberId: string) {
    const rows = await this.mobileRecharges.listForMember(memberId);
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      mobileNumber: r.mobileNumber,
      operator: r.operator,
      amount: money(r.amountPaise),
      failureReason: r.failureReason,
      createdAt: r.createdAt,
    }));
  }

  /**
   * What that operator is actually selling right now, for the plan cards on
   * the recharge screen. Best-effort: see RechargePlansService for why this
   * can come back empty, which the client treats as "show the amount field
   * instead" rather than an error.
   */
  @Get('mobile-recharge/plans')
  async rechargePlanOptions(@Query('operator') operator: string) {
    const valid: PlanOperator[] = ['JIO', 'AIRTEL', 'VI', 'BSNL'];
    if (!valid.includes(operator as PlanOperator)) return { plans: [] };
    const plans = await this.rechargePlans.getPlans(operator as PlanOperator);
    return { plans: plans.map((p) => ({ amount: money(BigInt(p.amountPaise)), validity: p.validity, data: p.data })) };
  }
}

/* ------------------------------------------------------------ read models */

/**
 * Everything the member app reads.
 *
 * Split from the write controllers above so the scoping rule is visible in one
 * place: every handler passes `@CurrentUser('sub')` into the service and the
 * service puts it in the WHERE clause. No handler here accepts a member id
 * from the URL or the body, so there is no route that can be pointed at
 * someone else's data by editing a value.
 */
@MemberOnly()
@Controller('me')
export class MemberViewController {
  constructor(
    private readonly view: MemberViewService,
    private readonly profile: ProfileService,
  ) {}

  @Get()
  dashboard(@CurrentUser('sub') memberId: string) {
    return this.view.dashboard(memberId);
  }

  @Get('payout')
  payout(@CurrentUser('sub') memberId: string) {
    return this.profile.payoutSummary(memberId);
  }

  /**
   * The saved delivery address, for pre-filling checkout.
   *
   * Returns `{ address: null }` rather than 404 when there is none. A member
   * who has never ordered has no address, and that is the normal first-order
   * case, not an error the checkout screen should have to catch.
   */
  @Get('address')
  async address(@CurrentUser('sub') memberId: string) {
    return this.profile.savedAddress(memberId);
  }

  @Patch('profile')
  saveProfile(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(ProfileSchema)) body: z.infer<typeof ProfileSchema>,
  ) {
    return this.profile.saveProfile(memberId, body);
  }

  @Patch('address')
  saveAddress(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(AddressSchema)) body: z.infer<typeof AddressSchema>,
  ) {
    return this.profile.saveAddress(memberId, body);
  }

  @Patch('payout')
  savePayout(
    @CurrentUser('sub') memberId: string,
    @Body(zodBody(PayoutSchema)) body: z.infer<typeof PayoutSchema>,
  ) {
    return this.profile.savePayout(memberId, body);
  }

  /* ------------------------------------------------------------- wallet */

  /**
   * `kind` is validated against the enum rather than passed through. It reaches
   * a unique-index lookup, and an unrecognised value should be a 400 here, not
   * a Prisma error surfacing from three layers down.
   */
  @Get('wallet/:kind')
  statement(
    @CurrentUser('sub') memberId: string,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.view.statement(memberId, WalletKindSchema.parse(kind.toUpperCase()), { cursor, take });
  }

  @Get('recharges')
  recharges(
    @CurrentUser('sub') memberId: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.view.recharges(memberId, { cursor, take });
  }

  /* ------------------------------------------------------------- orders */

  @Get('orders')
  orders(
    @CurrentUser('sub') memberId: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.view.orders(memberId, { cursor, take });
  }

  @Get('orders/:id')
  order(@CurrentUser('sub') memberId: string, @Param('id') id: string) {
    return this.view.order(memberId, id);
  }

  /* ------------------------------------------------------------ network */

  @Get('network')
  network(@CurrentUser('sub') memberId: string, @Query('depth') depth?: string) {
    return this.view.network(memberId, { depth });
  }

  @Get('network/:childId')
  branch(@CurrentUser('sub') memberId: string, @Param('childId') childId: string) {
    return this.view.branch(memberId, childId);
  }

  /* ------------------------------------------------------ notifications */

  @Get('notifications')
  notifications(
    @CurrentUser('sub') memberId: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.view.notifications(memberId, { cursor, take });
  }

  @Post('notifications/read')
  @HttpCode(200)
  markRead(@CurrentUser('sub') memberId: string) {
    return this.view.markNotificationsRead(memberId);
  }
}

const ShadeFinderSchema = z.object({
  imageBase64: z.string().min(100, 'That does not look like a photo.'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

/**
 * A photo analysed by the store's own Gemini key costs the store real money
 * per call, so this is rate-limited even though it is a member-only, not a
 * public, endpoint — five tries an hour is enough for someone genuinely
 * looking for their shade and not enough to run up a meaningful bill by
 * accident or on purpose.
 */
@MemberOnly()
@Controller('me/shade-finder')
export class ShadeFinderController {
  constructor(private readonly shadeFinder: ShadeFinderService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 5, windowSeconds: 3600, keyPrefix: 'shade-finder' })
  @Post()
  @HttpCode(200)
  analyze(@Body(zodBody(ShadeFinderSchema)) body: z.infer<typeof ShadeFinderSchema>) {
    return this.shadeFinder.analyze(body.imageBase64, body.mimeType);
  }
}
