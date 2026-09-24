import { z } from 'zod';
import { Controller, Delete, Get, HttpCode, Post, Put, Body } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { MemberOnly, CurrentUser } from '../auth/guards';
import { AutoshipService } from '../order/autoship.service';

const SaveSchema = z.object({
  dayOfMonth: z.number().int().min(1).max(28),
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(20),
});

/** A member's monthly standing order. One per member. */
@MemberOnly()
@Controller('autoship')
export class AutoshipController {
  constructor(private readonly autoship: AutoshipService) {}

  @Get()
  get(@CurrentUser('sub') memberId: string) {
    return this.autoship.get(memberId);
  }

  @Put()
  save(@CurrentUser('sub') memberId: string, @Body(zodBody(SaveSchema)) body: z.infer<typeof SaveSchema>) {
    return this.autoship.save(memberId, body);
  }

  @Post('pause')
  @HttpCode(200)
  pause(@CurrentUser('sub') memberId: string) {
    return this.autoship.setActive(memberId, false);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentUser('sub') memberId: string) {
    return this.autoship.setActive(memberId, true);
  }

  @Delete()
  remove(@CurrentUser('sub') memberId: string) {
    return this.autoship.remove(memberId);
  }
}
