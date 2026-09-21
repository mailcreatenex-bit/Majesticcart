import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle, assertNoIncomeClaims, breadcrumbJsonLd } from '@/lib/seo';
import { PageHeader } from '@/components/Chrome';
import { ENTITY } from '@/lib/legal';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Frequently asked questions'),
  description:
    'Ordering, the wallet, delivery, returns and membership at Majestic Cart — answered plainly.',
  pathname: '/faq',
});

/**
 * FAQ.
 *
 * Structured as data because two things read it: the JSON-LD builder below,
 * which turns it into FAQPage markup, and the income-claim lint. Writing the
 * answers inline in JSX would defeat both.
 *
 * The wallet answers are the ones that matter. "Why can I not just pay by
 * card?" is the question every new customer asks, and an unclear answer is
 * what turns a normal checkout into a support call — or, worse, into a
 * suspicion that the money has gone somewhere it should not have.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'Why can I not pay by card at checkout?',
    a: 'Orders are paid from your shopping wallet rather than card by card. You add money to the wallet once by UPI, our team verifies the payment against the bank statement, and the balance is then available for any order. It means no card details are ever stored on the site, and it gives every member a single statement of what they have put in and what they have spent.',
  },
  {
    q: 'How do I add money to my wallet?',
    a: 'Open the recharge page, transfer the amount by UPI to the account shown there, and submit the UTR reference number from your UPI app together with a screenshot of the payment. You will see the request marked as pending until it is checked.',
  },
  {
    q: 'How long does a wallet recharge take to be approved?',
    a: 'Most are checked within a few working hours. Every request is verified by hand against the bank statement before it is credited, so it is never instant. If yours is still pending after one working day, contact customer care with the UTR.',
  },
  {
    q: 'What happens if my recharge is rejected?',
    a: 'Nothing is deducted — a rejected request never credits the wallet, and the money stays where it was. The reason is shown on the request itself. The usual causes are a UTR that does not match any payment received, an amount different from the one claimed, or a screenshot that has already been used.',
  },
  {
    q: 'Can I take money back out of my shopping wallet?',
    a: 'No. The shopping wallet buys products and cannot be withdrawn as cash. Income earned on sales goes to a separate income wallet, and that one can be withdrawn to your bank account. Only add to the shopping wallet what you intend to spend on products.',
  },
  {
    q: 'When will my order arrive?',
    a: 'Orders are dispatched within two working days and usually arrive within three to seven working days depending on the PIN code. You will get a tracking reference once it ships, and the order page shows every status change.',
  },
  {
    q: 'Can I return a product?',
    a: 'Sealed, unused products can be returned within the window set out in the refund policy. Opened cosmetics cannot be returned for hygiene reasons unless they arrived damaged or are faulty, in which case we replace or refund them. Damaged deliveries should be reported within 48 hours with photographs.',
  },
  {
    q: 'Does it cost anything to become a member?',
    a: 'No. There is no joining fee, no renewal fee and no compulsory purchase of any kind. If anyone asks you to pay to join, report it to the grievance officer.',
  },
  {
    q: 'Do I get paid for signing people up?',
    a: 'No. Nothing in the plan pays for recruitment. Every payment is calculated on products that have been sold and delivered.',
  },
  {
    q: 'Where can I see the compensation plan?',
    a: 'In full inside your account, once you have signed up. Every rate, rank and qualification rule is published there, along with the income distribution across all members.',
  },
  {
    q: 'How do I cancel my membership?',
    a: `Write to ${ENTITY.supportEmail} from your registered email or contact customer care. There is no penalty and no notice period. Any balance in your income wallet can be withdrawn subject to the conditions in the plan.`,
  },
  {
    q: 'Who do I contact if something goes wrong?',
    a: `Customer care on ${ENTITY.supportPhone}, ${ENTITY.supportHours}, or by email at ${ENTITY.supportEmail}. If a complaint is not resolved to your satisfaction, the grievance officer's details are in the footer of every page and a response is due within 48 hours.`,
  },
];

assertNoIncomeClaims(FAQS.map((f) => `${f.q} ${f.a}`).join(' '), 'app/faq/page.tsx');

export default function FaqPage() {
  const jsonLd = [
    breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'FAQ', path: '/faq' },
    ]),
    // FAQPage markup. Every question here is answered on this page in full —
    // marking up an answer that is only partially shown is what gets the rich
    // result withdrawn.
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <>
      {jsonLd.map((graph, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
      ))}

      <PageHeader
        title="Frequently asked questions"
        lead="Ordering, the wallet, delivery, returns and membership."
      />

      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* <details> rather than a JavaScript accordion: it works before
            hydration, it is keyboard accessible for free, and the answer text
            is in the HTML whether or not it is open — which is what the markup
            above promises a crawler. */}
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-start justify-between gap-4 font-medium text-[var(--ink)]">
                <h2 className="text-base">{f.q}</h2>
                <span
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-[var(--accent)] transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--body)]">{f.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-6">
          <h2 className="font-serif text-lg text-[var(--ink)]">Still stuck?</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--body)]">
            Customer care is open {ENTITY.supportHours}.
          </p>
          <Link href="/contact" className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] hover:underline">
            Contact us →
          </Link>
        </div>
      </div>
    </>
  );
}
