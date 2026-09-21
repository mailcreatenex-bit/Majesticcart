import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { AuthShell, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Log in'),
  description: 'Log in to your Majestic Cart account to shop, track orders and follow your team.',
  pathname: '/login',
});

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; identifier?: string }>;
}) {
  // Both query params come back from `app/api/auth/login/route.ts` after a
  // failed attempt (post-redirect-get, so a refresh does not resubmit the
  // password) — never anything the visitor typed directly into the URL and
  // had rendered back at them.
  const { next, error, identifier } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      lead="Log in to shop from your wallet and follow your team."
      footer={<>New here? <Link href="/signup" className="font-semibold text-[var(--accent)]">Create a free account</Link></>}
    >
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[#FDECEA] px-3.5 py-2.5 text-sm text-[#A5342A]">
          {error}
        </p>
      )}

      {/* A real form element, so password managers offer to fill it and Enter
          submits. Progressive enhancement: it posts even before hydration. */}
      <form action="/api/auth/login" method="post" className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Mobile number or member ID" htmlFor="identifier">
          <input
            id="identifier" name="identifier" required
            autoComplete="username" inputMode="tel"
            defaultValue={identifier ?? ''}
            placeholder="9876500002 or MC100002"
            className={inputClass}
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <input id="password" name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </Field>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-[var(--accent)]">Forgot password?</Link>
        </div>

        <button type="submit" className={primaryButtonClass}>Log in</button>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--muted)]">
        Trouble logging in? Call customer care rather than sharing your password with anyone.
        We will never ask you for your password or an OTP.
      </p>
    </AuthShell>
  );
}
