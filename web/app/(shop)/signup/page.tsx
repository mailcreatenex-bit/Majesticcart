import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { REF_COOKIE, normaliseRefCode } from '@/lib/referral';
import { AuthShell, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Join free'),
  description: 'Create a free Majestic Cart account. No registration fee and no purchase needed to join.',
  pathname: '/signup',
});

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string; phone?: string; email?: string; sponsorCode?: string }>;
}) {
  // The sponsor arrives from the referral cookie the middleware set, not from
  // the URL — the ref parameter was stripped to keep one canonical URL per page.
  const sponsor = normaliseRefCode((await cookies()).get(REF_COOKIE)?.value);
  // A resubmission after a field error (e.g. a rejected password) restores
  // the other fields from the redirect's query params rather than the member
  // retyping their name and phone — `sponsorCode` here is what they actually
  // typed, which wins over the cookie if the two differ.
  const { error, name, phone, email, sponsorCode } = await searchParams;
  const sponsorFieldValue = sponsorCode ?? sponsor ?? '';

  return (
    <AuthShell
      title="Join Majestic Cart"
      lead="Free to join. No registration fee and no purchase needed."
      footer={<>Already a member? <Link href="/login" className="font-semibold text-[var(--accent)]">Log in</Link></>}
    >
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[#FDECEA] px-3.5 py-2.5 text-sm text-[#A5342A]">
          {error}
        </p>
      )}

      <form action="/api/auth/signup" method="post" className="space-y-4">
        <Field label="Full name" htmlFor="name">
          <input id="name" name="name" required autoComplete="name" defaultValue={name ?? ''} className={inputClass} />
        </Field>

        <Field label="Mobile number" htmlFor="phone" hint="We send a one-time code to verify it.">
          <input id="phone" name="phone" required autoComplete="tel" inputMode="numeric" maxLength={10} pattern="[6-9][0-9]{9}" defaultValue={phone ?? ''} className={inputClass} />
        </Field>

        <Field label="Email (optional)" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={email ?? ''} className={inputClass} />
        </Field>

        <Field label="Password" htmlFor="password" hint="At least 8 characters. Avoid your name or phone number.">
          <input id="password" name="password" type="password" required autoComplete="new-password" minLength={8} className={inputClass} />
        </Field>

        <Field
          label="Sponsor ID (optional)"
          htmlFor="sponsorCode"
          hint={sponsor ? `Filled in from the link you followed. You will join ${sponsor}'s team.` : 'Leave blank to join directly under the company.'}
        >
          <input id="sponsorCode" name="sponsorCode" defaultValue={sponsorFieldValue} placeholder="MC100002" autoCapitalize="characters" className={inputClass} />
        </Field>

        <button type="submit" className={primaryButtonClass}>Create free account</button>
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-[var(--muted)]">
        By joining you accept our{' '}
        <Link href="/legal/terms" className="text-[var(--accent)]">terms</Link> and{' '}
        <Link href="/legal/privacy-policy" className="text-[var(--accent)]">privacy policy</Link>.
        Income is earned only on products sold and delivered. We make no guarantee of earnings.
      </p>
    </AuthShell>
  );
}
