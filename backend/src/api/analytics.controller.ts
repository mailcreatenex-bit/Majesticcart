import { z } from 'zod';
import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { Public, RequirePermission } from '../auth/guards';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { AnalyticsService, EVENT_TYPES } from '../analytics/analytics.service';

const EventSchema = z.object({
  sid: z.string().regex(/^[A-Za-z0-9-]{8,40}$/),
  type: z.enum(EVENT_TYPES),
  slug: z.string().max(120).regex(/^[a-z0-9-]+$/).optional(),
  reason: z.string().max(40).regex(/^[a-z_]+$/).optional(),
});

/**
 * Where the storefront reports what visitors do. Public (visitors are not
 * logged in) and rate-limited per IP; it stores no IP, cookie or account.
 * Always answers 204-style so a tracking failure can never affect the page.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 120, windowSeconds: 60, keyPrefix: 'analytics' })
  @Post('event')
  @HttpCode(200)
  async event(@Body(zodBody(EventSchema)) body: z.infer<typeof EventSchema>) {
    await this.analytics.record(body).catch(() => undefined);
    return { ok: true };
  }
}

@RequirePermission('reports.view')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  report(@Query('days') days?: string) {
    const n = Math.min(Math.max(Number(days) || 30, 1), 120);
    return this.analytics.report(n);
  }
}
