import { z } from 'zod';
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser, Public, RequirePermission } from '../auth/guards';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { IntegrationsService, SECTION_NAMES } from '../integrations/integrations.service';
import { SMS_SENDER, type SmsSender } from '../notifications/sms.service';
import { EMAIL_SENDER, type EmailSender } from '../notifications/email.service';
import { pincodeServiceable, testCourierKeys } from '../order/courier';

const SectionParam = z.enum(SECTION_NAMES);
// Strings set a value, null clears it, leaving a field out keeps it as it is.
const PatchSchema = z.record(z.string(), z.string().max(600).nullable().optional());
const PhoneSchema = z.object({ phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number.') });
const EmailSchema = z.object({ to: z.string().email('Enter an email address.') });

/**
 * Where an admin enters the delivery company's keys, and the SMS, WhatsApp, email and alert
 * settings, instead of asking a developer to change the server. Secrets are saved encrypted
 * and never sent back (only their last four characters). Needs the Settings permission.
 */
@RequirePermission('settings.manage')
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  @Get()
  async get() {
    const [status, cfg] = await Promise.all([this.integrations.status(), this.integrations.resolve()]);
    return {
      status,
      // What is actually switched on right now, whether it came from here or from the server's own settings.
      live: { sms: cfg.sms.enabled, whatsapp: cfg.whatsapp.enabled, email: cfg.email.enabled, courier: !!(cfg.courier.delhiveryToken || cfg.courier.shiprocketEmail) },
    };
  }

  @Put(':section')
  @HttpCode(200)
  async update(
    @Param('section') sectionName: string,
    @Body(zodBody(PatchSchema)) body: Record<string, string | null | undefined>,
    @CurrentUser('sub') adminId: string,
  ) {
    const section = SectionParam.safeParse(sectionName);
    if (!section.success) throw new BadRequestException('Unknown settings section.');
    await this.integrations.update(section.data, body, adminId);
    return { ok: true as const };
  }

  @Post('sms/test')
  @HttpCode(200)
  async testSms(@Body(zodBody(PhoneSchema)) body: { phone: string }) {
    const { sms } = await this.integrations.resolve();
    if (!sms.enabled) throw new BadRequestException('SMS is not set up yet. Save the address and key first.');
    try {
      await this.sms.send(body.phone, 'Majestic Cart: this is a test message from your admin console.');
    } catch (e) {
      throw new BadRequestException(`The SMS provider refused it: ${e instanceof Error ? e.message : 'error'}`);
    }
    return { ok: true as const, message: `Sent to ${body.phone}. If it does not arrive, check the sender ID and template with your provider.` };
  }

  @Post('whatsapp/test')
  @HttpCode(200)
  async testWhatsapp(@Body(zodBody(PhoneSchema)) body: { phone: string }) {
    try {
      await this.integrations.sendWhatsapp(body.phone, 'Majestic Cart: this is a test message from your admin console.');
    } catch (e) {
      throw new BadRequestException(`WhatsApp did not accept it: ${e instanceof Error ? e.message : 'error'}`);
    }
    return { ok: true as const, message: `Sent to ${body.phone}.` };
  }

  @Post('email/test')
  @HttpCode(200)
  async testEmail(@Body(zodBody(EmailSchema)) body: { to: string }) {
    const { email } = await this.integrations.resolve();
    if (!email.enabled) throw new BadRequestException('Email is not set up yet. Save the key first.');
    try {
      await this.email.send(body.to, 'Majestic Cart test email', 'This is a test email from your admin console.');
    } catch (e) {
      throw new BadRequestException(`The email provider refused it: ${e instanceof Error ? e.message : 'error'}`);
    }
    return { ok: true as const, message: `Sent to ${body.to}.` };
  }

  @Post('courier/test')
  @HttpCode(200)
  async testCourier() {
    const { courier } = await this.integrations.resolve();
    return { results: await testCourierKeys(courier) };
  }
}

/**
 * "Can you deliver to my pincode?" on the product page. With a delivery company set up it asks
 * them; without one it still answers (any valid pincode) in the store's own words.
 */
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 60, windowSeconds: 60, keyPrefix: 'pincode' })
  @Get('check')
  async check(@Query('pincode') pincode = '') {
    const pin = pincode.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) throw new BadRequestException('Enter a 6-digit pincode.');
    const { courier } = await this.integrations.resolve();
    const serviceable = await pincodeServiceable(pin, courier);
    return {
      pincode: pin,
      // null means "no delivery company to ask": we do not claim a yes or a no we cannot back up.
      serviceable,
      eta: courier.etaText || null,
    };
  }
}
