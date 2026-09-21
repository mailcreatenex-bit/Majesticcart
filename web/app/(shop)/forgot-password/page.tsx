import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AuthShell, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Reset your password'),
  description: 'Reset the password for your Majestic Cart account using a one-time code.',
  pathname: '/forgot-password',
});

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      lead="We will send a one-time code to your registered mobile number."
      footer={<Link href="/login" className="font-semibold text-[var(--accent)]">Back to log in</Link>}
    >
      <form action="/api/auth/forgot-password" method="post" className="space-y-4">
        <Field label="Registered mobile number" htmlFor="phone">
          <input id="phone" name="phone" required autoComplete="tel" inputMode="numeric" maxLength={10} pattern="[6-9][0-9]{9}" className={inputClass} />
        </Field>
        <button type="submit" className={primaryButtonClass}>Send code</button>
      </form>

      {/* The server replies identically whether or not the number is
          registered, so the page must not imply otherwise. Saying "if that
          number is registered" is both honest and the non-enumerable wording. */}
      <p className="mt-6 rounded-xl bg-[var(--accent-soft)] p-4 text-xs leading-relaxed text-[var(--body)]">
        If that number is registered, a code arrives within a minute. It expires in 10 minutes.
        Never share it with anyone — our staff will never ask you for it.
      </p>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Changed your number? <Link href="/contact" className="text-[var(--accent)]">Contact customer care</Link>.
      </p>
    </AuthShell>
  );
}
