import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class HttpSmsService implements SmsSender {
  private readonly log = new Logger('SMS');
  private readonly apiKey = process.env.SMS_API_KEY ?? '';
  private readonly senderId = process.env.SMS_SENDER_ID ?? '';
  private readonly endpoint = process.env.SMS_ENDPOINT ?? '';

  async send(phone: string, message: string, templateId?: string): Promise<void> {
    if (!this.apiKey || !this.endpoint) {
      throw new Error('SMS_API_KEY and SMS_ENDPOINT must be set when SMS_PROVIDER is not "console"');
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        to: `91${phone}`,
        sender: this.senderId,
        message,
        // DLT template id. Indian carriers drop transactional SMS without one.
        template_id: templateId ?? process.env.SMS_OTP_TEMPLATE_ID,
      }),
    });
    if (!res.ok) {
      // Log the failure without the body: it carries the OTP.
      this.log.error(`SMS send failed for ${phone.slice(0, 4)}xxxxxx: ${res.status}`);
      throw new Error('Could not send the code. Try again in a moment.');
    }
  }
}

export const SMS_SENDER = Symbol('SMS_SENDER');

export const smsProvider = {
  provide: SMS_SENDER,
  useClass: (process.env.SMS_PROVIDER ?? 'console') === 'console' ? ConsoleSmsService : HttpSmsService,
};
