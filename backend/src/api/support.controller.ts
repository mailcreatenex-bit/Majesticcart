import { z } from 'zod';
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, MemberOnly, Public, RequirePermission } from '../auth/guards';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { SupportService, TICKET_CATEGORIES } from '../support/support.service';

const Category = z.enum(TICKET_CATEGORIES);
const Message = z.string().trim().min(10, 'Tell us a little more - at least 10 characters').max(2000);

const MemberTicketSchema = z.object({ category: Category, subject: z.string().trim().min(3, 'Add a short subject').max(120), message: Message });
const GuestTicketSchema = MemberTicketSchema.extend({ name: z.string().trim().min(2).max(80), contact: z.string().trim().min(6, 'Add a phone number or email').max(120) });
const ReplySchema = z.object({ body: Message });
const StatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']) });

/** A member's own tickets. */
@MemberOnly()
@Controller('support')
export class MemberSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  mine(@CurrentUser('sub') memberId: string) {
    return this.support.listMine(memberId);
  }

  @Post()
  create(@CurrentUser('sub') memberId: string, @Body(zodBody(MemberTicketSchema)) body: z.infer<typeof MemberTicketSchema>) {
    return this.support.createForMember(memberId, body);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(@CurrentUser('sub') memberId: string, @Param('id') id: string, @Body(zodBody(ReplySchema)) body: z.infer<typeof ReplySchema>) {
    return this.support.replyAsMember(memberId, id, body.body);
  }
}

/** The contact page form, for someone without an account. Rate-limited per IP: it is an open door. */
@Controller('support-public')
export class PublicSupportController {
  constructor(private readonly support: SupportService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 5, windowSeconds: 3600, keyPrefix: 'support-guest' })
  @Post()
  @HttpCode(200)
  create(@Body(zodBody(GuestTicketSchema)) body: z.infer<typeof GuestTicketSchema>) {
    return this.support.createGuest(body);
  }
}

/** The staff inbox. */
@RequirePermission('support.manage')
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.support.adminList(status);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body(zodBody(ReplySchema)) body: z.infer<typeof ReplySchema>) {
    return this.support.adminReply(adminId, id, body.body);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body(zodBody(StatusSchema)) body: z.infer<typeof StatusSchema>) {
    return this.support.adminSetStatus(adminId, id, body.status);
  }
}
