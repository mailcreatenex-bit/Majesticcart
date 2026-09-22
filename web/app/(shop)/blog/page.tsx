import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata, metaDescription, pageTitle } from '@/lib/seo';
import { listBlogPosts } from '@/lib/content';
import { PageHeader } from '@/components/Chrome';

export const revalidate = 3600;

const DESCRIPTION = 'Skin care guidance, ingredient explainers and product updates from Majestic Cart.';

export const metadata: Metadata = buildMetadata({
  title: pageTitle('Blog'),
  description: metaDescription(DESCRIPTION),
  pathname: '/blog',
});

export default async function BlogIndexPage() {
  const posts = await listBlogPosts();

  return (
    <>
      <PageHeader title="Blog" lead={DESCRIPTION} />

      <div className="mx-auto max-w-4xl px-4 py-10">
        {posts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center text-sm text-[var(--muted)]">
            Nothing published yet. Check back soon.
          </p>
        ) : (
          <div className="space-y-8">
            {posts.map((p) => (
              <Link key={p.id} href={`/blog/${p.slug}`} className="group block border-b border-[var(--line)] pb-8">
                {p.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.coverImageUrl} alt="" className="mb-4 aspect-[2/1] w-full rounded-2xl object-cover" />
                )}
                <p className="text-xs text-[var(--faint)]">
                  {new Date(p.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <h2 className="mt-1 font-serif text-2xl text-[var(--ink)] group-hover:text-[var(--accent)]">{p.title}</h2>
                {p.excerpt && <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--body)]">{p.excerpt}</p>}
                <span className="mt-3 inline-block text-sm font-semibold text-[var(--accent)]">Read more →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
