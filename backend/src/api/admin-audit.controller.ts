import { Controller, Get, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequirePermission } from '../auth/guards';

/**
 * A read-only view of the audit log for the console: who did what, and when.
 *
 * The log is written by the services that do the things (plan changes, payouts,
 * approvals, role edits, support replies); this only reads it. Nothing here can edit
 * or delete an entry.
 */
@RequirePermission('security.view')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get()
  async list(@Query('prefix') prefix?: string, @Query('limit') limit?: string) {
    const take = Math.min(200, Math.max(1, Number(limit) || 100));
    const rows = await this.prisma.auditLog.findMany({
      where: prefix && /^[a-z_.]{1,40}$/.test(prefix) ? { action: { startsWith: prefix } } : {},
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, actorType: true, actorId: true, action: true, detail: true, createdAt: true },
    });
    const adminIds = [...new Set(rows.filter((r) => r.actorType === 'ADMIN' && r.actorId).map((r) => r.actorId as string))];
    const admins = adminIds.length ? await this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [];
    const email = new Map(admins.map((a) => [a.id, a.email]));
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      actor: r.actorType === 'ADMIN' ? (email.get(r.actorId ?? '') ?? r.actorId ?? 'admin') : r.actorType === 'SYSTEM' ? 'System' : `Member ${r.actorId ?? ''}`.trim(),
      action: r.action,
      detail: r.detail,
    }));
  }
}
