import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AuthShell, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Reset your password'),
  description: 'Reset the password for your Majestic Cart account using a one-time code sent to your email.',
  pathname: '/forgot-password',
});

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Reset your password"
      lead="We will send a one-time code to your registered email address."
      footer={<Link href="/login" className="font-semibold text-[var(--accent)]">Back to log in</Link>}
    >
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[#FDECEA] px-3.5 py-2.5 text-sm text-[#A5342A]">
          {error}
        </p>
      )}

      <form action="/api/auth/forgot-password" method="post" className="space-y-4">
        <Field label="Registered email address" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <button type="submit" className={primaryButtonClass}>Send code</button>
      </form>

      {/* The server replies identically whether or not the email is
          registered, so the page must not imply otherwise. Saying "if that
          email is registered" is both honest and the non-enumerable wording. */}
      <p className="mt-6 rounded-xl bg-[var(--accent-soft)] p-4 text-xs leading-relaxed text-[var(--body)]">
        If that email is registered, a code arrives within a minute. It expires in 10 minutes.
        Never share it with anyone — our staff will never ask you for it.
      </p>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Changed your email? <Link href="/contact" className="text-[var(--accent)]">Contact customer care</Link>.
      </p>
    </AuthShell>
  );
}
