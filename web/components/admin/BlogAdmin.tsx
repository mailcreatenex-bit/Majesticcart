'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';
import { ImageUploadField } from './ImageUploadField';

interface BlogPost {
  id: string; slug: string; title: string; isPublished: boolean; publishedAt: string | null; updatedAt: string;
  author: { name: string } | null;
}
interface BlogPostDetail {
  id: string; slug: string; title: string; excerpt: string | null; contentMd: string; coverImageUrl: string | null; isPublished: boolean;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function BlogAdminView() {
  return (
    <AdminShell title="Blog" subtitle="Posts shown at /blog." permission="blog.manage">
      <Blog />
    </AdminShell>
  );
}

function Blog() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPosts(await api<BlogPost[]>('/admin/blog'));
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load posts.')).finally(() => setLoading(false));
  }, [load]);

  if (error && posts.length === 0) return <AdminError message={error} />;
  if (loading) return <TableSkeleton rows={4} />;

  return (
    <div className="space-y-5">
      {editing ? (
        <PostForm id={editing === 'new' ? null : editing} onDone={async () => { setEditing(null); await load(); }} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setEditing('new')} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
              New post
            </button>
          </div>

          {posts.length === 0 ? (
            <AdminEmpty>No posts yet.</AdminEmpty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {posts.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{p.title}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.isPublished ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'}`}>
                          {p.isPublished ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{p.author?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-500">{new Date(p.updatedAt).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3 text-xs font-semibold">
                          {p.isPublished && (
                            <Link href={`/blog/${p.slug}`} target="_blank" className="text-neutral-500 hover:underline">View</Link>
                          )}
                          <button type="button" onClick={() => setEditing(p.id)} className="text-neutral-700 hover:underline">Edit</button>
                          <DeletePostButton id={p.id} onDeleted={load} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeletePostButton({ id, onDeleted }: { id: string; onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <span className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await api(`/admin/blog/${id}/delete`, { method: 'POST', body: {} }); await onDeleted(); }}
          className="text-red-700 hover:underline"
        >
          Confirm
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-neutral-500 hover:underline">Cancel</button>
      </span>
    );
  }
  return <button type="button" onClick={() => setConfirming(true)} className="text-red-700 hover:underline">Delete</button>;
}

function PostForm({ id, onDone, onCancel }: { id: string | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const [loaded, setLoaded] = useState(id === null);
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [form, setForm] = useState({ title: '', slug: '', excerpt: '', contentMd: '', coverImageUrl: '', isPublished: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id === null) return;
    api<BlogPostDetail>(`/admin/blog/${id}`).then((p) => {
      setForm({ title: p.title, slug: p.slug, excerpt: p.excerpt ?? '', contentMd: p.contentMd, coverImageUrl: p.coverImageUrl ?? '', isPublished: p.isPublished });
      setLoaded(true);
    }).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the post.'));
  }, [id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = {
        title: form.title.trim(), slug: form.slug.trim(), excerpt: form.excerpt.trim() || undefined,
        contentMd: form.contentMd, coverImageUrl: form.coverImageUrl || undefined, isPublished: form.isPublished,
      };
      if (id) await api(`/admin/blog/${id}`, { method: 'PUT', body });
      else await api('/admin/blog', { method: 'POST', body });
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); if (err.fields) setFieldErrors(err.fields); }
      else setError('Could not save the post.');
      setSaving(false);
    }
  };

  if (!loaded) return <TableSkeleton rows={4} />;

  return (
    <Panel title={id ? 'Edit post' : 'New post'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
          Title
          <input
            value={form.title}
            onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          {fieldErrors.title && <p className="mt-1 text-xs text-red-700">{fieldErrors.title}</p>}
        </label>

        <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
          Slug — /blog/{form.slug || '…'}
          <input
            value={form.slug}
            onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-neutral-900 focus:outline-none"
          />
          {fieldErrors.slug && <p className="mt-1 text-xs text-red-700">{fieldErrors.slug}</p>}
        </label>

        <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
          Excerpt (optional — shown in the post list)
          <input value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
        </label>

        <div className="sm:col-span-2">
          <ImageUploadField label="Cover image" value={form.coverImageUrl} onChange={(url) => set('coverImageUrl', url)} purpose="blog-cover" />
        </div>

        <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
          Content — Markdown
          <textarea
            value={form.contentMd}
            onChange={(e) => set('contentMd', e.target.value)}
            rows={16}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-neutral-900 focus:outline-none"
            placeholder={'# Heading\n\nParagraph text, **bold**, _italic_, [links](https://example.com), lists, and images all work.'}
          />
          {fieldErrors.contentMd && <p className="mt-1 text-xs text-red-700">{fieldErrors.contentMd}</p>}
        </label>

        <label className="flex items-center gap-2 text-sm text-neutral-800 sm:col-span-2">
          <input type="checkbox" checked={form.isPublished} onChange={(e) => set('isPublished', e.target.checked)} className="rounded border-neutral-300" />
          Published
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={save} disabled={saving || !form.title.trim() || !form.slug.trim() || !form.contentMd.trim()} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300">
          {saving ? 'Saving…' : 'Save post'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </Panel>
  );
}
