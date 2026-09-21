import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription } from '@/lib/seo';
import { getLegalDocument, LEGAL_DOCUMENTS, auditDocument, ENTITY } from '@/lib/legal';
import { PageHeader } from '@/components/Chrome';

/**
 * Every policy page renders from the same structured document, so a lawyer
 * edits one file rather than four page templates — and the audit below cannot
 * be bypassed by editing markup.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getLegalDocument(slug);
  if (!doc) return { title: pageTitle('Not found'), robots: { index: false, follow: true } };
  return buildMetadata({
    title: pageTitle(doc.title),
    description: metaDescription(doc.summary),
    pathname: `/legal/${slug}`,
  });
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getLegalDocument(slug);
  if (!doc) notFound();

  const audit = auditDocument(doc);
  const isDraft = !audit.ready;

  return (
    <>
      <PageHeader title={doc.title} lead={doc.summary} />

      <div className="mx-auto max-w-4xl px-4 py-10">
        {/* Visible while the document still has placeholders. A half-written
            policy reads as a published commitment while promising nothing, and
            under the E-Commerce Rules it is the published terms that bind. */}
        {isDraft && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900">This document is a draft</h2>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              It has not been completed or reviewed by a lawyer, and it contains placeholders. It is not
              in force. {audit.unfilledPlaceholders.length > 0 && `${audit.unfilledPlaceholders.length} section${audit.unfilledPlaceholders.length === 1 ? '' : 's'} still need${audit.unfilledPlaceholders.length === 1 ? 's' : ''} details from the business.`}
            </p>
          </div>
        )}

        <p className="text-sm text-[var(--muted)]">Effective from {doc.effectiveFrom}</p>

        {/* A table of contents: these documents are long, and a reader looking
            for the refund window should not have to scroll for it. */}
        <nav aria-label="On this page" className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">On this page</h2>
          <ol className="mt-3 space-y-1.5">
            {doc.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">
                  {i + 1}. {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {doc.sections.map((section, i) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="font-serif text-xl text-[var(--ink)]">{i + 1}. {section.heading}</h2>

              {section.statutory && (
                <p className="mt-2 rounded-lg bg-[var(--page)] px-3 py-2 text-xs text-[var(--muted)]">
                  Required by {section.statutory.basis} — {section.statutory.requirement}
                </p>
              )}

              {section.body.map((p, j) => (
                <p key={j} className="mt-3 max-w-prose leading-relaxed text-[var(--body)]">{p}</p>
              ))}

              {section.bullets && (
                <ul className="mt-3 max-w-prose list-disc space-y-1.5 pl-5 text-[var(--body)]">
                  {section.bullets.map((b, j) => <li key={j} className="leading-relaxed">{b}</li>)}
                </ul>
              )}

              {section.needs && section.needs.length > 0 && (
                <p className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
                  Still needed: {section.needs.join('; ')}
                </p>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Questions about this policy</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--body)]">
            Write to {ENTITY.grievanceOfficer.name}, {ENTITY.grievanceOfficer.designation}, at{' '}
            <a href={`mailto:${ENTITY.grievanceOfficer.email}`} className="font-medium text-[var(--accent)]">{ENTITY.grievanceOfficer.email}</a>.
            We acknowledge every complaint within 48 hours.
          </p>
        </div>
      </div>
    </>
  );
}
