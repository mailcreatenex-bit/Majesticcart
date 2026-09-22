import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildMetadata, pageTitle, metaDescription, breadcrumbJsonLd } from '@/lib/seo';
import { getBlogPost, listBlogPosts } from '@/lib/content';

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const posts = await listBlogPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) return { title: pageTitle('Post not found'), robots: { index: false, follow: true } };
  return buildMetadata({
    title: pageTitle(post.title),
    description: metaDescription(post.excerpt ?? post.title),
    pathname: `/blog/${slug}`,
    ...(post.coverImageUrl ? { image: { url: post.coverImageUrl, alt: post.title } } : {}),
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) notFound();

  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: post.title, path: `/blog/${slug}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <article className="mx-auto max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-[var(--faint)]">
          <Link href="/" className="hover:text-[var(--ink)]">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/blog" className="hover:text-[var(--ink)]">Blog</Link>
        </nav>

        <p className="mt-4 text-xs text-[var(--faint)]">
          {new Date(post.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          {post.author && ` · ${post.author.name}`}
        </p>
        <h1 className="mt-2 font-serif text-3xl leading-tight text-[var(--ink)] sm:text-4xl">{post.title}</h1>

        {post.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt="" className="mt-6 aspect-[2/1] w-full rounded-2xl object-cover" />
        )}

        {/* contentHtml is Markdown rendered and sanitised server-side — see
            backend src/common/markdown.ts. Never raw admin input rendered as-is. */}
        <div
          className="prose prose-neutral mt-8 max-w-none prose-headings:font-serif prose-headings:text-[var(--ink)] prose-a:text-[var(--accent)]"
          dangerouslySetInnerHTML={{ __html: post.contentHtml }}
        />

        <div className="mt-12 border-t border-[var(--line)] pt-6">
          <Link href="/blog" className="text-sm font-semibold text-[var(--accent)] hover:underline">
            ← All posts
          </Link>
        </div>
      </article>
    </>
  );
}
