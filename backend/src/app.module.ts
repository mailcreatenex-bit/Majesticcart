import { Module, Global, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';

import { BigIntSerializerInterceptor } from './common/serialization';
import { AuthGuard } from './auth/guards';
import { AuthService } from './auth/auth.service';
import { TokenService } from './auth/token.service';
import { LedgerService } from './ledger/ledger.service';
import { CommissionService } from './commission/commission.service';
import { CommissionProcessor } from './commission/commission.processor';
import { OrderService } from './order/order.service';
import { AutoshipService } from './order/autoship.service';
import { AutoshipController } from './api/autoship.controller';
import { RechargeService } from './recharge/recharge.service';
import { WithdrawalService } from './withdrawal/withdrawal.service';
import { MobileRechargeService } from './mobile-recharge/mobile-recharge.service';
import { RechargePlansService } from './mobile-recharge/recharge-plans.service';
import { SecurityAlertService } from './security/security-alert.service';
import { SettingsService } from './settings/settings.service';
import { ShadeFinderService } from './shade-finder/shade-finder.service';
import { DashboardService } from './admin/dashboard.service';
import { ReportService } from './reporting/report.service';
import { StorageService } from './media/storage.service';
import { ProfileService } from './member/profile.service';
import { MemberViewService } from './member/view.service';
import { ReviewService } from './catalog/review.service';
import { CatalogService } from './catalog/catalog.service';
import { CouponService } from './coupon/coupon.service';
import { InvoiceService } from './invoice/invoice.service';
import { CatalogController, AdminCatalogController, InvoiceController, MemberReviewController } from './api/catalog.controller';
import { smsProvider, SMS_SENDER } from './notifications/sms.service';
import { OutboundNotifier } from './notifications/outbound.service';
import { SupportService } from './support/support.service';
import { MemberSupportController, PublicSupportController, AdminSupportController } from './api/support.controller';
import { AdminReportsService } from './reporting/admin-reports.service';
import { AdminReportsController } from './api/admin-reports.controller';
import { AdminAuditController } from './api/admin-audit.controller';
import { AuthController, OrderController, WalletController, MemberViewController, ShadeFinderController } from './api/member.controller';
import {
  AdminAuthController, AdminRechargeController, AdminOrderController, AdminWithdrawalController,
  AdminMobileRechargeController, AdminPlanController, AdminDashboardController, ReportController,
  AdminSecurityController, AdminSettingsController, AdminCouponController,
  ThemeController, AdminThemeController,
} from './api/admin.controller';
import { RbacService } from './rbac/rbac.service';
import { RoleController, AdminUserController } from './rbac/rbac.controller';
import { AdminMediaController } from './media/media.controller';
import { BlogService } from './blog/blog.service';
import { BlogController, AdminBlogController } from './blog/blog.controller';
import { PageService } from './pages/page.service';
import { PageController, AdminPageController } from './pages/page.controller';

/**
 * Wiring.
 *
 * Two things here are not boilerplate: the guard and serializer are registered
 * globally so neither can be forgotten on a new route, and OrderModule connects
 * the commission queue that OrderService deliberately left as an optional hook
 * (so the service stays testable without Redis).
 */

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        const prisma = new PrismaClient({
          log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
        });
        return prisma;
      },
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule {}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) {
          // Fail at boot. A weak or missing signing key discovered in
          // production means every token ever issued is suspect.
          throw new Error('JWT_SECRET must be set to at least 32 characters');
        }
        return { secret, signOptions: { issuer: 'majestic-cart', audience: 'majestic-cart-api' } };
      },
    }),
  ],
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, TokenService, smsProvider, OutboundNotifier],
  exports: [AuthService, TokenService, JwtModule, SMS_SENDER],
})
export class AuthModule {}

@Module({
  controllers: [AdminMediaController],
  providers: [StorageService],
  exports: [StorageService],
})
export class MediaModule {}

@Module({
  controllers: [RoleController, AdminUserController],
  providers: [RbacService],
})
export class RbacModule {}

@Module({
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService],
})
export class BlogModule {}

@Module({
  controllers: [PageController, AdminPageController],
  providers: [PageService],
})
export class PagesModule {}

/**
 * Split out from AdminModule specifically so MemberModule can depend on it
 * without depending on AdminModule itself — AdminModule pulls in
 * CommissionModule and the rest of the admin surface, none of which
 * ShadeFinderService has any business touching just to read one setting.
 * Small and early in the file on purpose: both AdminModule and MemberModule
 * import this, and a module can only import a class already defined above it.
 */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

@Module({
  imports: [SettingsModule, MediaModule],
  controllers: [MemberViewController, ShadeFinderController],
  providers: [ProfileService, MemberViewService, ShadeFinderService],
  exports: [ProfileService, MemberViewService],
})
export class MemberModule {}

@Module({
  controllers: [CatalogController, AdminCatalogController, MemberReviewController],
  providers: [CatalogService, ReviewService],
  exports: [CatalogService],
})
export class CatalogModule {}

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}

@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}

@Module({
  imports: [LedgerModule, BullModule.registerQueue({ name: 'commission' })],
  providers: [CommissionService, CommissionProcessor],
  exports: [CommissionService],
})
export class CommissionModule {}

/**
 * OrderService exposes `commissionQueue` as an optional property rather than a
 * constructor dependency, so unit tests can exercise checkout and the status
 * machine without a Redis instance. This is where the real queue is attached.
 */
@Module({
  imports: [LedgerModule, CommissionModule, BullModule.registerQueue({ name: 'commission' })],
  controllers: [OrderController, AdminOrderController, AdminCouponController, AutoshipController],
  providers: [OrderService, CouponService, AutoshipService],
  exports: [OrderService, CouponService],
})
export class OrderModule implements OnModuleInit {
  constructor(
    private readonly orders: OrderService,
    @InjectQueue('commission') private readonly queue: Queue,
  ) {}

  private sweepTimers: NodeJS.Timeout[] = [];

  onModuleInit(): void {
    this.orders.commissionQueue = this.queue;
    // Re-queue any delivered order whose payout never ran: shortly after boot, then every 10 minutes.
    const run = () => void this.orders.sweepCommissions().catch(() => undefined);
    const first = setTimeout(run, 60_000);
    const every = setInterval(run, 10 * 60_000);
    first.unref?.();
    every.unref?.();
    this.sweepTimers = [first, every];
  }
}

@Module({
  imports: [LedgerModule, MediaModule],
  controllers: [WalletController, AdminRechargeController, AdminWithdrawalController, AdminMobileRechargeController],
  providers: [RechargeService, WithdrawalService, MobileRechargeService, RechargePlansService],
  exports: [RechargeService, WithdrawalService, MobileRechargeService, RechargePlansService],
})
export class WalletOpsModule {}

@Module({
  imports: [CommissionModule, SettingsModule],
  controllers: [
    AdminPlanController, AdminDashboardController, ReportController, AdminSecurityController,
    AdminSettingsController, ThemeController, AdminThemeController, AdminReportsController,
    MemberSupportController, PublicSupportController, AdminSupportController, AdminAuditController,
  ],
  providers: [DashboardService, ReportService, SecurityAlertService, AdminReportsService, SupportService],
  exports: [DashboardService, ReportService, SecurityAlertService],
})
export class AdminModule {}

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST ?? '127.0.0.1',
          port: Number(process.env.REDIS_PORT ?? 6379),
          password: process.env.REDIS_PASSWORD,
          // Managed Redis (Upstash, Redis Cloud, ...) serves TLS-only on the
          // port they give you; set REDIS_TLS=true in that environment.
          ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
          // LOCAL DEV WORKAROUND ONLY: this machine has no admin rights to
          // install a Redis >=5 service, so local testing runs against an
          // old Windows Redis port (3.0.504) that fails BullMQ's version
          // gate. Remove once running against the docker-compose redis:7.
          skipVersionCheck: true,
        },
        defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: false },
      }),
    }),
    AuthModule,
    LedgerModule,
    CommissionModule,
    OrderModule,
    MediaModule,
    MemberModule,
    CatalogModule,
    InvoiceModule,
    WalletOpsModule,
    AdminModule,
    RbacModule,
    BlogModule,
    PagesModule,
  ],
  providers: [
    // Global: a new route is protected and BigInt-safe by default. Opting out
    // is explicit (@Public), which is the right way round for a platform
    // holding member funds.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: BigIntSerializerInterceptor },
  ],
})
export class AppModule {}
