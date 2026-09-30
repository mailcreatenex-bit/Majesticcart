import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle } from '@/lib/seo';
import { getTheme } from '@/lib/content';
import { PageHeader } from '@/components/Chrome';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('About us'),
  description: 'Majestic Cart is an Indian beauty brand sold direct. How the business works, and what it does not do.',
  pathname: '/about',
});

/**
 * About page.
 *
 * Content is admin-editable (Theme > About page) rather than hardcoded.
 * This used to be declared as data specifically so a build-time lint could
 * read it and fail the build over an income claim; that check now runs on
 * the server when an admin saves the Theme settings instead (see
 * backend/src/settings/settings.service.ts's setTheme()) — the actual
 * enforcement point now that this is edited at runtime, not compile time.
 */
export default async function AboutPage() {
  const theme = await getTheme();
  const COPY = theme.aboutPage;

  return (
    <>
      <PageHeader title="About Majestic Cart" lead={COPY.lead} image="/home/hero-2.jpg" />

      <div className="mx-auto max-w-4xl px-4 py-10">
        <section>
          {COPY.story.map((p, i) => (
            <p key={i} className="mt-4 max-w-prose text-lg leading-relaxed text-[var(--body)] first:mt-0">{p}</p>
          ))}
        </section>

        <section className="mt-14">
          <h2 className="font-serif text-2xl text-[var(--ink)]">How the business works</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {COPY.howItWorks.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-[var(--ink)]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--body)]">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Saying plainly what the business is not is the fastest way to keep
            members from describing it as something it isn't. */}
        <section className="mt-14 rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-6">
          <h2 className="font-serif text-2xl text-[var(--ink)]">{COPY.notThisTitle}</h2>
          <ul className="mt-4 space-y-3">
            {COPY.notThis.map((line, i) => (
              <li key={i} className="max-w-prose leading-relaxed text-[var(--body)]">{line}</li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-[var(--muted)]">
            The full rules are in our{' '}
            <Link href="/legal/terms" className="font-medium text-[var(--accent)]">terms and conditions</Link> and{' '}
            <Link href="/legal/refund-policy" className="font-medium text-[var(--accent)]">buy-back policy</Link>.
          </p>
        </section>

        <section className="mt-14 flex flex-wrap gap-3">
          <Link href="/shop" className="rounded-xl bg-[var(--ink)] px-6 py-3 font-semibold text-[var(--gold-pale)]">Shop the range</Link>
          <Link href="/join" className="rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-6 py-3 font-semibold text-[var(--ink)]">Become a member</Link>
        </section>
      </div>
    </>
  );
}
