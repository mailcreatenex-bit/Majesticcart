import type { Metadata } from 'next';
import { buildMetadata, pageTitle, organizationJsonLd } from '@/lib/seo';
import { ENTITY } from '@/lib/legal';
import { PageHeader } from '@/components/Chrome';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Contact us'),
  description: 'Customer care, grievance officer and registered office details for Majestic Cart.',
  pathname: '/contact',
});

/**
 * Contact page.
 *
 * The Consumer Protection (E-Commerce) Rules require the legal entity name,
 * registered address, customer care details and a named grievance officer with
 * a stated resolution timeline to be published. This page is where a regulator
 * or a consumer forum will look, so the details are presented plainly rather
 * than behind a contact form.
 */
export default function ContactPage() {
  const jsonLd = organizationJsonLd({ phone: ENTITY.supportPhone, email: ENTITY.supportEmail });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHeader title="Contact us" lead="Real people, reachable during business hours. Every complaint gets an acknowledgement." />

      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-10 md:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="font-serif text-xl text-[var(--ink)]">Customer care</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Orders, delivery, returns and wallet questions.</p>
          <address className="mt-4 space-y-2 not-italic">
            <div><a href={`tel:${ENTITY.supportPhone}`} className="text-lg font-medium text-[var(--ink)]">{ENTITY.supportPhone}</a></div>
            <div><a href={`mailto:${ENTITY.supportEmail}`} className="text-[var(--accent)]">{ENTITY.supportEmail}</a></div>
          </address>
          <p className="mt-3 text-sm text-[var(--muted)]">{ENTITY.supportHours}</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="font-serif text-xl text-[var(--ink)]">Grievance officer</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            If customer care has not resolved your issue, escalate here.
          </p>
          <address className="mt-4 space-y-1 not-italic text-[var(--body)]">
            <div className="font-medium text-[var(--ink)]">{ENTITY.grievanceOfficer.name}</div>
            <div className="text-sm">{ENTITY.grievanceOfficer.designation}</div>
            <div className="text-sm"><a href={`mailto:${ENTITY.grievanceOfficer.email}`} className="text-[var(--accent)]">{ENTITY.grievanceOfficer.email}</a></div>
            <div className="text-sm">{ENTITY.grievanceOfficer.phone}</div>
          </address>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
            Acknowledged within 48 hours and resolved within one month, as required by the
            Consumer Protection (E-Commerce) Rules, 2020.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 md:col-span-2">
          <h2 className="font-serif text-xl text-[var(--ink)]">Registered office</h2>
          <address className="mt-3 space-y-1 not-italic text-[var(--body)]">
            <div className="font-medium text-[var(--ink)]">{ENTITY.legalName}</div>
            <div className="text-sm">{ENTITY.entityType}</div>
            <div className="text-sm whitespace-pre-line">{ENTITY.registeredAddress}</div>
            <div className="mt-2 text-sm">CIN {ENTITY.cin} · GSTIN {ENTITY.gstin}</div>
          </address>
        </section>
      </div>
    </>
  );
}
