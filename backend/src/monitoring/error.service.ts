import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { IntegrationsService } from '../integrations/integrations.service';
import { EMAIL_SENDER, type EmailSender } from '../notifications/email.service';

/**
 * Errors the site hit, grouped so one bug that fires a thousand times is one
 * line with a count, not a thousand lines.
 *
 * Two sources: the API (any 5xx or uncaught exception) and the browser (an
 * uncaught error or a crashed page, reported by the storefront). The first time a
 * new kind appears an email goes to the alert address set under Integrations, if
 * email is set up (at most a handful an hour, so an outage cannot flood a mailbox).
 * Nothing about the person is kept: no member id, IP or request body.
 */

export type ErrorSource = 'api' | 'web';

const NOISE = /ResizeObserver loop|^Script error\.?$|AbortError|Failed to fetch|NetworkError|Load failed|ChunkLoadError|cancelled|extension:\/\//i;
const ALERTS_PER_HOUR = 6;

/** Pure: the same bug gets the same fingerprint however many ids, numbers or addresses are in its message. Exported for tests. */
export function fingerprint(source: ErrorSource, message: string, stack?: string | null): string {
  const clean = message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>')
    .replace(/c[a-z0-9]{24}/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .slice(0, 200);
  const frame = (stack ?? '').split('\n').find((l) => /at\s/.test(l) && !/node_modules/.test(l))?.replace(/:\d+:\d+/g, '').trim() ?? '';
  return createHash('sha1').update(`${source}|${clean}|${frame}`).digest('hex').slice(0, 20);
}

/** Pure: whether a browser error is worth recording. */
export function isNoise(message: string): boolean {
  return !message.trim() || NOISE.test(message);
}

@Injectable()
export class ErrorService {
  private readonly log = new Logger(ErrorService.name);
  private alertTimes: number[] = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrations: IntegrationsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async record(source: ErrorSource, e: { message: string; stack?: string | null; path?: string | null; status?: number | null }): Promise<void> {
    try {
      const message = e.message.slice(0, 400);
      if (source === 'web' && isNoise(message)) return;
      const fp = fingerprint(source, message, e.stack);
      const existing = await this.prisma.appError.findUnique({ where: { fingerprint: fp }, select: { id: true } });
      await this.prisma.appError.upsert({
        where: { fingerprint: fp },
        create: {
          fingerprint: fp, source, message, detail: (e.stack ?? '').slice(0, 3000) || null,
          path: e.path?.slice(0, 200) ?? null, status: e.status ?? null,
        },
        // A fix that did not hold reopens it.
        update: { count: { increment: 1 }, lastSeenAt: new Date(), resolved: false, path: e.path?.slice(0, 200) ?? undefined },
      });
      if (!existing) void this.alert(source, message, e.path ?? null).catch(() => undefined);
    } catch (err) {
      // Reporting an error must never cause one.
      this.log.warn(`could not record an error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async alert(source: ErrorSource, message: string, path: string | null) {
    const now = Date.now();
    this.alertTimes = this.alertTimes.filter((t) => now - t < 3600_000);
    if (this.alertTimes.length >= ALERTS_PER_HOUR) return;
    const cfg = await this.integrations.resolve();
    if (!cfg.alerts.email || !cfg.email.enabled) return;
    this.alertTimes.push(now);
    await this.email.send(
      cfg.alerts.email,
      `Majestic Cart: new ${source === 'api' ? 'server' : 'browser'} error`,
      `${message}\n\n${path ? `Where: ${path}\n` : ''}See the Errors page in the admin console for details.`,
    );
  }

  list(resolved: boolean) {
    return this.prisma.appError.findMany({ where: { resolved }, orderBy: { lastSeenAt: 'desc' }, take: 100 });
  }

  async resolve(id: string, adminId: string) {
    await this.prisma.appError.update({ where: { id }, data: { resolved: true } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: adminId, action: 'error.resolve', detail: { id } } });
    return { ok: true as const };
  }
}
