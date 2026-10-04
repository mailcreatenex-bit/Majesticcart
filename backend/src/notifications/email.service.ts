import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';

/**
 * Email.
 *
 * Same shape as sms.service.ts, for the same reason: which provider the
 * client ends up with is a commercial decision, not a technical one, so the
 * send path sits behind an interface.
 *
 * Resend is the default HTTP provider because it needs nothing but an API
 * key — no DLT-style template registration, no SMTP credentials to manage —
 * which makes it the fastest path to a working password-reset flow. The
 * console driver is the default in development so OTPs print to the
 * terminal instead of requiring a real account to test against.
 */
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

const mask = (email: string) => email.replace(/^(.{2}).*(@.*)$/, '$1***$2');

@Injectable()
export class ConsoleEmailService implements EmailSender {
  private readonly log = new Logger('Email');
  async send(to: string, subject: string): Promise<void> {
    // Never log the body in production — it carries the OTP.
    this.log.log(`[dev] to ${to}: ${subject}`);
  }
}

/** Reads the email settings each time, like DynamicSmsService; prints to the log when none are set. */
@Injectable()
export class DynamicEmailService implements EmailSender {
  private readonly log = new Logger('Email');
  private readonly fallback = new ConsoleEmailService();

  constructor(private readonly integrations: IntegrationsService) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const { email } = await this.integrations.resolve();
    if (!email.enabled) return this.fallback.send(to, subject);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${email.apiKey}` },
      body: JSON.stringify({ from: email.from, to, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Log the failure without the body: it carries the OTP.
      this.log.error(`Email send failed for ${mask(to)}: ${res.status}`);
      throw new Error('Could not send the code. Try again in a moment.');
    }
  }
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export const emailProvider = { provide: EMAIL_SENDER, useClass: DynamicEmailService };
