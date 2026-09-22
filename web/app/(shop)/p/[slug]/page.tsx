import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription } from '@/lib/seo';
import { getCmsPage } from '@/lib/content';

/**
 * Admin-authored freeform pages (About, Press, Careers, ...) — see
 * PageService on the backend. Deliberately `dynamicParams: true` with no
 * `generateStaticParams`: these pages are created ad hoc from the console,
 * often the same day someone wants to link to them, so waiting for the next
 * build to make them reachable would defeat the point of the feature.
 */
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) return { title: pageTitle('Page not found'), robots: { index: false, follow: true } };
  return buildMetadata({
    title: pageTitle(page.title),
    description: metaDescription(page.title),
    pathname: `/p/${slug}`,
  });
}

export default async function CustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
        <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
      </nav>

      <h1 className="mt-3 font-serif text-3xl text-[var(--ink)]">{page.title}</h1>

      {/* contentHtml is Markdown rendered and sanitised server-side. */}
      <div
        className="prose prose-neutral mt-6 max-w-none prose-headings:font-serif prose-headings:text-[var(--ink)] prose-a:text-[var(--accent)]"
        dangerouslySetInnerHTML={{ __html: page.contentHtml }}
      />
    </div>
  );
}
