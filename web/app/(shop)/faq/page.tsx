import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, pageTitle, breadcrumbJsonLd } from '@/lib/seo';
import { getTheme, getCompanyInfo } from '@/lib/content';
import { PageHeader } from '@/components/Chrome';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Frequently asked questions'),
  description:
    'Ordering, the wallet, delivery, returns and membership at Majestic Cart — answered plainly.',
  pathname: '/faq',
});

/**
 * FAQ.
 *
 * Content is admin-editable (Theme > FAQ page). Two things read it: the
 * JSON-LD builder below, which turns it into FAQPage markup, and the
 * server-side income-claim check that runs when an admin saves the Theme
 * settings (backend/src/settings/settings.service.ts's setTheme()) — this
 * used to be a build-time lint over a hardcoded constant, and is now the
 * runtime equivalent now that the constant lives in the CMS instead.
 */
export default async function FaqPage() {
  const [theme, ENTITY] = await Promise.all([getTheme(), getCompanyInfo()]);
  const FAQS = theme.faqPage;

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
