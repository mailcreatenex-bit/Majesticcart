import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { REF_COOKIE, normaliseRefCode } from '@/lib/referral';
import { AuthShell, AuthIntro, Field, inputClass, primaryButtonClass } from '@/components/AuthShell';
import { getTheme } from '@/lib/content';
import { getStorefrontMember } from '@/lib/catalog';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Join free'),
  description: 'Create a free Majestic Cart account. No registration fee.',
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
  const [{ error, name, phone, email, sponsorCode }, theme] = await Promise.all([searchParams, getTheme()]);

  // Arrived by a member's invite link: the Referral ID is theirs and cannot be changed (the sign-up
  // route enforces it too, so editing the page does nothing). A link to a member who does not exist
  // is not locked, so the visitor is not stuck with an ID that can never work.
  const inviter = sponsor ? await getStorefrontMember(sponsor) : null;
  const locked = !!(sponsor && inviter);
  const sponsorFieldValue = locked ? sponsor! : (sponsorCode ?? '');

  return (
    <>
    <AuthIntro />
    <AuthShell
      title="Join Majestic Cart"
      lead={theme.authCopy.signupLead}
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

        <Field label="Email" htmlFor="email" hint="For order updates and account recovery.">
          <input id="email" name="email" type="email" required autoComplete="email" defaultValue={email ?? ''} className={inputClass} />
        </Field>

        <Field label="Password" htmlFor="password" hint="At least 8 characters. Avoid your name or phone number.">
          <input id="password" name="password" type="password" required autoComplete="new-password" minLength={8} className={inputClass} />
        </Field>

        <Field
          label="Referral ID"
          htmlFor="sponsorCode"
          hint={
            locked
              ? `You were invited by ${inviter!.firstName}. This Referral ID is filled in from the invite link and cannot be changed.`
              : sponsor
                ? 'That invite link did not match a member. Enter the Referral ID of whoever invited you.'
                : 'Ask whoever invited you for their Referral ID, or open the invite link they sent you.'
          }
        >
          <input
            id="sponsorCode"
            name="sponsorCode"
            required
            readOnly={locked}
            aria-readonly={locked}
            defaultValue={sponsorFieldValue}
            placeholder="MC100002"
            autoCapitalize="characters"
            className={`${inputClass} ${locked ? 'cursor-not-allowed bg-[var(--surface-tint)] font-mono font-semibold tracking-wide text-[var(--ink)]' : ''}`}
          />
        </Field>

        <button type="submit" className={primaryButtonClass}>Create free account</button>
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-[var(--muted)]">
        By joining you accept our{' '}
        <Link href="/legal/terms" className="text-[var(--accent)]">terms</Link> and{' '}
        <Link href="/legal/privacy-policy" className="text-[var(--accent)]">privacy policy</Link>.
        {' '}{theme.authCopy.signupDisclaimer}
      </p>
    </AuthShell>
    </>
  );
}
