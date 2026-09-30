import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AuthShell, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Enter your reset code'),
  description: 'Enter the code emailed to you and choose a new password.',
  pathname: '/reset-password',
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Enter your reset code"
      lead="The code was emailed to you, if that address is registered."
      footer={<Link href="/login" className="font-semibold text-[var(--accent)]">Back to log in</Link>}
    >
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[#FDECEA] px-3.5 py-2.5 text-sm text-[#A5342A]">
          {error}
        </p>
      )}

      <form action="/api/auth/reset-password" method="post" className="space-y-4">
        <Field label="Email address" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </Field>
        <Field label="6-digit code" htmlFor="code" hint="Expires 10 minutes after it was sent.">
          <input id="code" name="code" required inputMode="numeric" maxLength={6} pattern="\d{6}" autoComplete="one-time-code" className={inputClass} />
        </Field>
        <Field label="New password" htmlFor="newPassword" hint="At least 8 characters. Avoid your name or phone number.">
          <input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </Field>
        <button type="submit" className={primaryButtonClass}>Set new password</button>
      </form>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Didn&rsquo;t get a code? <Link href="/forgot-password" className="text-[var(--accent)]">Send it again</Link>.
      </p>
    </AuthShell>
  );
}
