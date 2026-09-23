import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle, assertNoIncomeClaims, breadcrumbJsonLd } from '@/lib/seo';
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
 * Two things follow from that, and both are enforced rather than remembered:
 *
 *   • No earnings figure appears anywhere on it. Not an example, not a
 *     "potential", not a range. The lint at the bottom of this file fails the
 *     build if one does.
 *   • What is NOT true is stated as plainly as what is. The Direct Selling
 *     Rules require the prohibitions to be disclosed, and a page that only
 *     lists upside is the one that gets read as an inducement.
 *
 * Copy is declared as data rather than written inline in JSX so the lint can
 * read every word of it.
 */
const COPY = {
  lead: 'Sell products you use yourself. No joining fee, no stock to buy, no targets to hit.',

  steps: [
    {
      title: 'Sign up with a sponsor ID',
      body: 'Someone already selling shares their member ID with you. You sign up with it, verify your mobile number, and you are a member. It takes about two minutes and costs nothing.',
    },
    {
      title: 'Add money to your shopping wallet',
      body: 'Orders are paid from a shopping wallet, not a card. You transfer by UPI to the account shown on the recharge page, upload the payment reference, and the amount is credited once our team has checked it against the bank statement.',
    },
    {
      title: 'Order products and sell them',
      body: 'You buy at member price and sell to your own customers. Every product carries a business volume, shown on its page before you buy.',
    },
    {
      title: 'Build a team, if you want to',
      body: 'You can sponsor other sellers. You are paid on what they sell, never on the fact that they joined.',
    },
  ],

  rules: [
    {
      title: 'Joining is free, and always will be',
      body: 'No registration fee, no renewal fee, no training fee, no compulsory kit. If anyone asks you to pay to join or to stay a member, report it to the grievance officer — it is a breach of our policy and of the Direct Selling Rules.',
    },
    {
      title: 'Nobody is paid for recruiting',
      body: 'Not a rupee is paid for signing someone up. Every payment in the plan is calculated on products that have been sold and delivered. A member who never sponsors anyone can still be paid in full on their own sales.',
    },
    {
      title: 'No minimum purchase to stay active',
      body: 'You are not required to buy anything to remain a member or to keep your team. A repurchase requirement applies only to withdrawing income, and it is stated in the plan in your account.',
    },
    {
      title: 'Unsold stock can be returned',
      body: 'Resaleable stock in its original condition can be returned under the buy-back policy within the stated window. You should never be left holding inventory you cannot move.',
    },
    {
      title: 'You can leave whenever you like',
      body: 'Membership can be cancelled at any time, in writing, with no penalty and no notice period.',
    },
  ],

  honest: {
    title: 'What this is not',
    points: [
      'It is not an investment. Money in a shopping wallet buys products. It earns no interest, it is not a deposit, and it is not returnable as cash.',
      'It is not income without selling. If nothing is sold, nothing is paid — to you or to anyone above you.',
      'It is not guaranteed. What a member makes depends entirely on what they and their team sell, and most people who join direct selling sell very little.',
      'It is not full-time work. Treat it as something you do alongside what you already do, not instead of it.',
    ],
  },

  eligibility:
    'You must be 18 or over and resident in India. You will need a mobile number, a PAN for payouts above the TDS threshold, and a bank account or UPI ID in your own name. Payouts are only ever made to an account in the member’s own name.',
};

// Runs at module load. A build fails rather than publishing an income claim —
// see lib/seo.ts for what it looks for and, just as importantly, what it does
// not: a clean run means nothing blatant, never "approved".
assertNoIncomeClaims(
  [
    COPY.lead,
    ...COPY.steps.map((s) => `${s.title} ${s.body}`),
    ...COPY.rules.map((s) => `${s.title} ${s.body}`),
    COPY.honest.title,
    ...COPY.honest.points,
    COPY.eligibility,
  ].join(' '),
  'app/join/page.tsx',
);

export default function JoinPage() {
  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Become a member', path: '/join' },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <PageHeader title="Become a member" lead={COPY.lead} />

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
          <h2 className="font-serif text-2xl text-[var(--ink)]">{COPY.honest.title}</h2>
          <ul className="mt-4 space-y-3">
            {COPY.honest.points.map((p) => (
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
