import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle, breadcrumbJsonLd } from '@/lib/seo';
import { getTheme } from '@/lib/content';
import { PageHeader } from '@/components/Chrome';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Become a member'),
  description:
    'How to join Majestic Cart as a direct seller: what it costs, what is expected, what is paid on, and what you can return.',
  pathname: '/join',
});

/**
 * The recruitment page.
 *
 * This is the single highest-risk page on the site. It is public, indexable,
 * and it is the page a regulator reads first when asking whether a direct
 * selling business is actually a money-circulation scheme.
 *
 * Content is admin-editable (Theme > Join page) rather than hardcoded. Two
 * things still follow from the page's risk, just enforced at a different
 * point than before:
 *
 *   • No earnings figure may appear anywhere on it. That used to be a
 *     build-time lint reading a hardcoded constant; it is now a check the
 *     server runs on every save of the Theme settings (see
 *     backend/src/settings/settings.service.ts's setTheme()), since the
 *     content itself now lives there, not in this file.
 *   • What is NOT true is stated as plainly as what is. The Direct Selling
 *     Rules require the prohibitions to be disclosed, and a page that only
 *     lists upside is the one that gets read as an inducement.
 */
export default async function JoinPage() {
  const theme = await getTheme();
  const COPY = theme.joinPage;

  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Become a member', path: '/join' },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <PageHeader title="Become a member" lead={COPY.lead} image="/home/editorial-2.jpg" imagePosition="object-top" />

      <div className="mx-auto max-w-4xl px-4 py-12">
        <section>
          <h2 className="font-serif text-2xl text-[var(--ink)]">How it works</h2>
          <ol className="mt-6 space-y-5">
            {COPY.steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-sm font-semibold text-[var(--gold-pale)]">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-[var(--ink)]">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--body)]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12">
          <h2 className="font-serif text-2xl text-[var(--ink)]">The rules we hold ourselves to</h2>
          <div className="mt-6 space-y-4">
            {COPY.rules.map((r) => (
              <div key={r.title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <h3 className="font-semibold text-[var(--ink)]">{r.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--body)]">{r.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Given the same weight as the section above it, not tucked into a
            footnote. A page that lists only upside is an inducement. */}
        <section className="mt-12 rounded-2xl border border-[var(--ink)]/15 bg-[var(--accent-soft)] p-6">
          <h2 className="font-serif text-2xl text-[var(--ink)]">{COPY.honestTitle}</h2>
          <ul className="mt-4 space-y-3">
            {COPY.honestPoints.map((p) => (
              <li key={p} className="flex gap-3 text-sm leading-relaxed text-[var(--body)]">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                {p}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="font-serif text-2xl text-[var(--ink)]">Who can join</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--body)]">{COPY.eligibility}</p>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-xl gold-foil px-7 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20"
          >
            Create your account
          </Link>
          <Link
            href="/faq"
            className="rounded-xl border border-[var(--ink)]/15 bg-[var(--surface)] px-7 py-3.5 font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
          >
            Read the FAQ
          </Link>
        </div>

        {/* The full plan lives behind the login, where the income-distribution
            report sits alongside it as its evidence base. */}
        <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
          The compensation plan in full — every rate, rank and qualification rule — is published
          inside your account once you have signed up, together with the published income
          distribution for all members.
        </p>
      </div>
    </>
  );
}
