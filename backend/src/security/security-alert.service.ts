import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Fraud/abuse signals the platform already raises — duplicate UTRs, reused
 * recharge screenshots, and the like (see src/reporting/catalog.ts for the
 * full signal list) — with somewhere to actually see and clear them.
 *
 * Before this, `AdminDashboard`'s "Security alerts" tile showed a live count
 * with nowhere for the click to land: the signals were being written to the
 * database and never looked at by anyone. This is deliberately just a queue,
 * not the general-purpose report builder the old prototype/ReportBuilder.jsx
 * was — that's a bigger, separate tool for ad-hoc analysis; this is the
 * narrower, actually-load-bearing piece of it.
 */
@Injectable()
export class SecurityAlertService {
  constructor(private readonly prisma: PrismaClient) {}

  async listOpen() {
    return this.prisma.securityAlert.findMany({
      where: { resolved: false },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async resolve(id: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const alert = await tx.securityAlert.findUniqueOrThrow({ where: { id } });
      if (alert.resolved) throw new ConflictException('This alert was already resolved.');

      const r = await tx.securityAlert.update({
        where: { id },
        data: { resolved: true, resolvedBy: adminId, resolvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: adminId, action: 'securityAlert.resolve', detail: { id, type: alert.type } },
      });
      return r;
    });
  }
}
