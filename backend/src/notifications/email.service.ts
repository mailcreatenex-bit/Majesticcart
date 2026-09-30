import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class ResendEmailService implements EmailSender {
  private readonly log = new Logger('Email');
  private readonly apiKey = process.env.RESEND_API_KEY ?? '';
  private readonly from = process.env.EMAIL_FROM ?? 'Majestic Cart <onboarding@resend.dev>';

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY must be set when EMAIL_PROVIDER is not "console"');
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, to, subject, text }),
    });
    if (!res.ok) {
      // Log the failure without the body: it carries the OTP.
      this.log.error(`Email send failed for ${mask(to)}: ${res.status}`);
      throw new Error('Could not send the code. Try again in a moment.');
    }
  }
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export const emailProvider = {
  provide: EMAIL_SENDER,
  useClass: (process.env.EMAIL_PROVIDER ?? 'console') === 'console' ? ConsoleEmailService : ResendEmailService,
};
