import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/guards';
import { OrderService } from '../order/order.service';
import { parseWebhook } from '../order/courier';
import { IntegrationsService } from '../integrations/integrations.service';

/**
 * Where a courier (Shiprocket, Delhivery) reports parcel progress.
 *
 * Closed unless a webhook secret is set under Integrations in the console, and then every call must carry
 * it in `x-courier-secret` (or `x-api-key`, which is what Shiprocket's webhook
 * screen offers). Always answers 200 to a well-authenticated call — a courier
 * retries on any error, and an AWB we do not know is nothing to retry.
 */
@Controller('webhooks/courier')
export class CourierWebhookController {
  constructor(private readonly orders: OrderService, private readonly integrations: IntegrationsService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Headers('x-courier-secret') secret: string | undefined,
    @Headers('x-api-key') apiKey: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = (await this.integrations.resolve()).courier.webhookSecret;
    const given = secret ?? apiKey ?? '';
    if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      throw new UnauthorizedException();
    }
    const update = parseWebhook(body);
    if (!update) return { ok: true, result: 'ignored' };
    return { ok: true, result: await this.orders.courierUpdate(update.awb, update.status) };
  }
}
