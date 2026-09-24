import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The support inbox.
 *
 * Members raise a question or complaint from their account; visitors can do it from
 * the contact page. Staff answer in the console. The Consumer Protection (E-Commerce)
 * Rules require a complaint to be acknowledged within 48 hours and resolved within a
 * month, so every ticket carries those two dates and the console shows which are late.
 *
 * "Acknowledged" means a person has replied or changed its status - the first staff
 * action stamps `acknowledgedAt`. A member is told of every reply in their in-app
 * notifications (and by SMS/WhatsApp where those are switched on).
 */

export const TICKET_CATEGORIES = ['ORDER', 'WALLET', 'ACCOUNT', 'PLAN', 'COMPLAINT', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

const ACK_HOURS = 48;
const RESOLVE_DAYS = 30;
const hours = (n: number) => n * 3_600_000;

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly log = new Logger(SupportService.name);
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Roles are stored with an explicit list of permissions, so a new permission is not held by
   * the existing owner role until it is added. Any role that can manage roles is given the
   * support permission once here; after that the role editor owns it.
   */
  async onModuleInit(): Promise<void> {
    try {
      const roles = await this.prisma.role.findMany({ select: { id: true, permissions: true } });
      for (const r of roles) {
        if (r.permissions.includes('roles.manage') && !r.permissions.includes('support.manage')) {
          await this.prisma.role.update({ where: { id: r.id }, data: { permissions: [...r.permissions, 'support.manage'] } });
          this.log.log(`Granted support.manage to role ${r.id}`);
        }
      }
    } catch (e) {
      this.log.error(`support permission grant failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /* ---------------------------------------------------------------- member */

  async createForMember(memberId: string, input: { category: TicketCategory; subject: string; message: string }) {
    const m = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { name: true, phone: true, memberCode: true } });
    const ticket = await this.create({ memberId, name: m.name, contact: m.phone, ...input }, 'MEMBER', memberId);
    return this.mineOne(memberId, ticket.id);
  }

  /** A visitor with no account. Contact is a phone or an email so staff can answer. */
  async createGuest(input: { name: string; contact: string; category: TicketCategory; subject: string; message: string }) {
    const ticket = await this.create({ memberId: null, ...input }, 'GUEST', null);
    return { ticketNo: ticket.ticketNo, ackWithinHours: ACK_HOURS };
  }

  async listMine(memberId: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: { memberId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((t) => this.shape(t, false));
  }

  async replyAsMember(memberId: string, ticketId: string, body: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, memberId }, select: { id: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportReply.create({ data: { ticketId, authorType: 'MEMBER', authorId: memberId, body: body.trim() } }),
      // A reply from the member re-opens a resolved ticket.
      this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN', resolvedAt: null } }),
    ]);
    return this.mineOne(memberId, ticketId);
  }

  /* ----------------------------------------------------------------- staff */

  async adminList(status?: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: status === 'OPEN' || status === 'IN_PROGRESS' || status === 'RESOLVED' ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: { member: { select: { memberCode: true } }, replies: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((t) => ({ ...this.shape(t, true), memberCode: t.member?.memberCode ?? null }));
  }

  async adminReply(adminId: string, ticketId: string, body: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.supportReply.create({ data: { ticketId, authorType: 'ADMIN', authorId: adminId, body: body.trim() } }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { acknowledgedAt: t.acknowledgedAt ?? new Date(), status: t.status === 'OPEN' ? 'IN_PROGRESS' : t.status },
      }),
      ...(t.memberId ? [this.prisma.notification.create({ data: { memberId: t.memberId, title: `Reply on ${t.ticketNo}`, body: `Our team has replied to "${t.subject}".`, kind: 'SUPPORT' } })] : []),
    ]);
    await this.audit(adminId, 'support.reply', { ticketId, ticketNo: t.ticketNo });
    return { ok: true as const };
  }

  async adminSetStatus(adminId: string, ticketId: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED') {
    const t = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status, acknowledgedAt: t.acknowledgedAt ?? new Date(), resolvedAt: status === 'RESOLVED' ? new Date() : null },
    });
    if (status === 'RESOLVED' && t.memberId) {
      await this.prisma.notification.create({ data: { memberId: t.memberId, title: `${t.ticketNo} resolved`, body: `"${t.subject}" was marked resolved. Reply to re-open it if it is not.`, kind: 'SUPPORT' } });
    }
    await this.audit(adminId, 'support.status', { ticketId, ticketNo: t.ticketNo, status });
    return { ok: true as const };
  }

  /* --------------------------------------------------------------- helpers */

  private async create(input: { memberId: string | null; name: string; contact: string; category: TicketCategory; subject: string; message: string }, authorType: 'MEMBER' | 'GUEST', authorId: string | null) {
    const message = input.message.trim();
    if (message.length < 10) throw new BadRequestException('Tell us a little more - at least 10 characters.');
    if (!input.contact.trim()) throw new ForbiddenException('Add a phone number or email so we can reply.');
    const ticketNo = `SUP-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    return this.prisma.supportTicket.create({
      data: {
        ticketNo,
        memberId: input.memberId,
        name: input.name.trim().slice(0, 80),
        contact: input.contact.trim().slice(0, 120),
        category: input.category,
        subject: input.subject.trim().slice(0, 120),
        replies: { create: { authorType, authorId, body: message } },
      },
    });
  }

  private async mineOne(memberId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirstOrThrow({ where: { id, memberId }, include: { replies: { orderBy: { createdAt: 'asc' } } } });
    return this.shape(t, false);
  }

  private shape(
    t: { id: string; ticketNo: string; name: string; contact: string; category: string; subject: string; status: string; acknowledgedAt: Date | null; resolvedAt: Date | null; createdAt: Date; replies: { id: string; authorType: string; body: string; createdAt: Date }[] },
    staff: boolean,
  ) {
    const now = Date.now();
    const open = t.status !== 'RESOLVED';
    return {
      id: t.id,
      ticketNo: t.ticketNo,
      category: t.category,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt,
      acknowledgedAt: t.acknowledgedAt,
      resolvedAt: t.resolvedAt,
      // The two dates the rules set, and whether each has been missed.
      acknowledgeBy: new Date(t.createdAt.getTime() + hours(ACK_HOURS)),
      resolveBy: new Date(t.createdAt.getTime() + hours(24 * RESOLVE_DAYS)),
      overdueAck: open && !t.acknowledgedAt && now > t.createdAt.getTime() + hours(ACK_HOURS),
      overdueResolve: open && now > t.createdAt.getTime() + hours(24 * RESOLVE_DAYS),
      replies: t.replies.map((r) => ({ id: r.id, from: r.authorType, body: r.body, at: r.createdAt })),
      ...(staff ? { name: t.name, contact: t.contact } : {}),
    };
  }

  private audit(actorId: string, action: string, detail: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId, action, detail: detail as never } });
  }
}
