import { z } from 'zod';
import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { AdminOnly, CurrentUser } from '../auth/guards';
import { AccessClaims } from '../auth/token.service';
import { StorageService } from './storage.service';

/**
 * Public-asset uploads for the admin console — product galleries, brand
 * logos, blog covers, page images, theme assets. Kept out of
 * `WalletController.uploadTicket` deliberately: that one purpose
 * (`recharge-screenshot`) is a member uploading a private file, this is
 * staff uploading something meant to end up on a public page, and the two
 * should never share a permission check by accident.
 */

const PURPOSE_PERMISSION: Record<string, string> = {
  'product-image': 'catalog.manage',
  'brand-logo': 'catalog.manage',
  'blog-cover': 'blog.manage',
  'page-image': 'pages.manage',
  'theme-asset': 'theme.manage',
};

const UploadTicketSchema = z.object({
  purpose: z.enum(['product-image', 'brand-logo', 'blog-cover', 'page-image', 'theme-asset']),
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});

@AdminOnly()
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload-ticket')
  @HttpCode(200)
  async uploadTicket(
    @Body(zodBody(UploadTicketSchema)) body: z.infer<typeof UploadTicketSchema>,
    @CurrentUser() claims: AccessClaims,
  ) {
    const required = PURPOSE_PERMISSION[body.purpose];
    if (!claims.permissions?.includes(required)) {
      throw new ForbiddenException('Your role does not allow this action.');
    }
    const ticket = await this.storage.createUploadTicket(body);
    return { ...ticket, publicUrl: this.storage.publicUrl(ticket.objectKey) };
  }
}
