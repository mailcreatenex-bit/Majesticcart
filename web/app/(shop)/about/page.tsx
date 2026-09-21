import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle, assertNoIncomeClaims } from '@/lib/seo';
import { PageHeader } from '@/components/Chrome';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('About us'),
  description: 'Majestic Cart is an Indian beauty brand sold direct. How the business works, and what it does not do.',
  pathname: '/about',
});

/**
 * About page.
 *
 * Copy is declared as data so the income-claim lint can read it. This is a
 * public, indexable page describing a direct-selling business — precisely the
 * page a regulator reads first — so no earnings figure may appear on it.
 */
const COPY = {
  lead: 'A beauty brand built for Indian skin, sold by the people who use it.',
  story: [
    'Majestic Cart makes skin, body, hair and colour cosmetics formulated for Indian skin tones and Indian weather. We sell direct, through members who use the products themselves, because a recommendation from someone who has actually used a saffron night oil through a Kolkata summer is worth more than a shelf tag.',
    'Every product carries a business volume, and members earn on what they sell and what their team sells, once the order is delivered. That is the whole model.',
  ],
  howItWorks: [
    { title: 'Joining is free', body: 'No registration fee, no renewal fee, no payment of any kind to become a member. Anyone over 18 resident in India can join.' },
    { title: 'Income comes from selling products', body: 'Nobody earns anything for recruiting a member. Income is paid on products that are sold and delivered, and on nothing else.' },
    { title: 'The plan is published in full', body: 'Every rate, rank and qualification rule is visible in your account. No part of it is discretionary and no part of it is hidden.' },
    { title: 'You can return what you do not sell', body: 'Members can return unsold, resaleable stock under the buy-back policy. Nobody should be left holding inventory they cannot move.' },
  ],
  notThis: [
    'It is not an investment. Money in a shopping wallet buys products; it earns no interest and is not a deposit.',
    'It is not a way to earn without selling. If nothing is sold, nothing is paid.',
    'There is no guarantee of income. What you make depends on what you and your team actually sell.',
  ],
};

// Runs at module load, so a build fails rather than publishing a claim.
assertNoIncomeClaims(
  [COPY.lead, ...COPY.story, ...COPY.howItWorks.map((s) => `${s.title} ${s.body}`), ...COPY.notThis].join(' '),
  'the About page',
);

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About Majestic Cart" lead={COPY.lead} />

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
          <h2 className="font-serif text-2xl text-[var(--ink)]">What this is not</h2>
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
