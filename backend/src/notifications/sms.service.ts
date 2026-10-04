import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';

/**
 * SMS.
 *
 * Behind an interface because the provider will change — Indian transactional
 * SMS needs DLT registration with a registered sender ID and pre-approved
 * templates, and which aggregator the client ends up with is a commercial
 * decision, not a technical one.
 *
 * The console driver is the default in development so OTPs print to the
 * terminal instead of costing money on every login attempt.
 */
export interface SmsSender {
  send(phone: string, message: string, templateId?: string): Promise<void>;
}

@Injectable()
export class ConsoleSmsService implements SmsSender {
  private readonly log = new Logger('SMS');
  async send(phone: string, message: string): Promise<void> {
    // Never log the message body in production — it contains the OTP.
    this.log.log(`[dev] to ${phone}: ${message}`);
  }
}

/**
 * The SMS sender the app uses: reads the provider settings each time (an admin can
 * change them in the console without a restart) and falls back to printing in the log
 * when no provider is set up. See integrations/integrations.service.ts.
 */
@Injectable()
export class DynamicSmsService implements SmsSender {
  private readonly log = new Logger('SMS');
  private readonly fallback = new ConsoleSmsService();

  constructor(private readonly integrations: IntegrationsService) {}

  async send(phone: string, message: string, templateId?: string): Promise<void> {
    const { sms } = await this.integrations.resolve();
    if (!sms.enabled) return this.fallback.send(phone, message);

    const res = await fetch(sms.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sms.apiKey}` },
      body: JSON.stringify({
        to: `91${phone}`,
        sender: sms.senderId,
        message,
        // DLT template id. Indian carriers drop transactional SMS without one.
        template_id: templateId ?? sms.templateId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Log the failure without the body: it carries the OTP.
      this.log.error(`SMS send failed for ${phone.slice(0, 4)}xxxxxx: ${res.status}`);
      throw new Error('Could not send the code. Try again in a moment.');
    }
  }
}

export const SMS_SENDER = Symbol('SMS_SENDER');

export const smsProvider = { provide: SMS_SENDER, useClass: DynamicSmsService };
