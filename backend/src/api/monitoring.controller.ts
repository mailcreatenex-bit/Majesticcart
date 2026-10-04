import { z } from 'zod';
import { Body, Controller, Get, HttpCode, Param, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, Public, RequirePermission } from '../auth/guards';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { ErrorService } from '../monitoring/error.service';

const ClientErrorSchema = z.object({
  message: z.string().min(1).max(400),
  stack: z.string().max(3000).optional(),
  path: z.string().max(200).optional(),
});

/**
 * "Is it up?" for an uptime monitor, and for anything that wants to keep the
 * free-plan server awake. Answers 200 only if the database answers too.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaClient) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: false });
    }
    return { ok: true, db: true, uptimeSeconds: Math.round(process.uptime()) };
  }
}

/** Where the storefront reports an uncaught browser error. Public and rate-limited; stores no person, IP or cookie. */
@Controller('monitoring')
export class ClientErrorController {
  constructor(private readonly errors: ErrorService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 20, windowSeconds: 60, keyPrefix: 'client-error' })
  @Post('client-error')
  @HttpCode(200)
  async report(@Body(zodBody(ClientErrorSchema)) body: z.infer<typeof ClientErrorSchema>) {
    await this.errors.record('web', body);
    return { ok: true };
  }
}

@RequirePermission('security.view')
@Controller('admin/errors')
export class AdminErrorsController {
  constructor(private readonly errors: ErrorService) {}

  @Get()
  async list(@Query('resolved') resolved?: string) {
    const rows = await this.errors.list(resolved === 'true');
    return {
      items: rows.map((r) => ({
        id: r.id, source: r.source, message: r.message, detail: r.detail, path: r.path, status: r.status,
        count: r.count, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, resolved: r.resolved,
      })),
    };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string, @CurrentUser('sub') adminId: string) {
    return this.errors.resolve(id, adminId);
  }
}
