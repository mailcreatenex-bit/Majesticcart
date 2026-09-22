'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

interface PageRow {
  id: string; slug: string; title: string; isPublished: boolean; updatedAt: string;
  updatedBy: { name: string } | null;
}
interface PageDetail {
  id: string; slug: string; title: string; contentMd: string; isPublished: boolean;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function PagesAdminView() {
  return (
    <AdminShell title="Pages" subtitle="Freeform pages, shown at /p/[slug]." permission="pages.manage">
      <Pages />
    </AdminShell>
  );
}

function Pages() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPages(await api<PageRow[]>('/admin/pages'));
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load pages.')).finally(() => setLoading(false));
  }, [load]);

  if (error && pages.length === 0) return <AdminError message={error} />;
  if (loading) return <TableSkeleton rows={4} />;

  return (
    <div className="space-y-5">
      {editing ? (
        <PageForm id={editing === 'new' ? null : editing} onDone={async () => { setEditing(null); await load(); }} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setEditing('new')} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">
              New page
            </button>
          </div>

          {pages.length === 0 ? (
            <AdminEmpty>No pages yet.</AdminEmpty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Path</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pages.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{p.title}</td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">/p/{p.slug}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.isPublished ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-500'}`}>
                          {p.isPublished ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{new Date(p.updatedAt).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3 text-xs font-semibold">
                          {p.isPublished && <Link href={`/p/${p.slug}`} target="_blank" className="text-neutral-500 hover:underline">View</Link>}
                          <button type="button" onClick={() => setEditing(p.id)} className="text-neutral-700 hover:underline">Edit</button>
                          <DeletePageButton id={p.id} onDeleted={load} />
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

function DeletePageButton({ id, onDeleted }: { id: string; onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <span className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await api(`/admin/pages/${id}/delete`, { method: 'POST', body: {} }); await onDeleted(); }}
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

function PageForm({ id, onDone, onCancel }: { id: string | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const [loaded, setLoaded] = useState(id === null);
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [form, setForm] = useState({ title: '', slug: '', contentMd: '', isPublished: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id === null) return;
    api<PageDetail>(`/admin/pages/${id}`).then((p) => {
      setForm({ title: p.title, slug: p.slug, contentMd: p.contentMd, isPublished: p.isPublished });
      setLoaded(true);
    }).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the page.'));
  }, [id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = { title: form.title.trim(), slug: form.slug.trim(), contentMd: form.contentMd, isPublished: form.isPublished };
      if (id) await api(`/admin/pages/${id}`, { method: 'PUT', body });
      else await api('/admin/pages', { method: 'POST', body });
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); if (err.fields) setFieldErrors(err.fields); }
      else setError('Could not save the page.');
      setSaving(false);
    }
  };

  if (!loaded) return <TableSkeleton rows={4} />;

  return (
    <Panel title={id ? 'Edit page' : 'New page'}>
      <div className="grid gap-4">
        <label className="block text-sm font-medium text-neutral-800">
          Title
          <input
            value={form.title}
            onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          {fieldErrors.title && <p className="mt-1 text-xs text-red-700">{fieldErrors.title}</p>}
        </label>

        <label className="block text-sm font-medium text-neutral-800">
          Slug — /p/{form.slug || '…'}
          <input
            value={form.slug}
            onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-neutral-900 focus:outline-none"
          />
          {fieldErrors.slug && <p className="mt-1 text-xs text-red-700">{fieldErrors.slug}</p>}
        </label>

        <label className="block text-sm font-medium text-neutral-800">
          Content — Markdown
          <textarea
            value={form.contentMd}
            onChange={(e) => set('contentMd', e.target.value)}
            rows={16}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-neutral-900 focus:outline-none"
          />
          {fieldErrors.contentMd && <p className="mt-1 text-xs text-red-700">{fieldErrors.contentMd}</p>}
        </label>

        <label className="flex items-center gap-2 text-sm text-neutral-800">
          <input type="checkbox" checked={form.isPublished} onChange={(e) => set('isPublished', e.target.checked)} className="rounded border-neutral-300" />
          Published
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={save} disabled={saving || !form.title.trim() || !form.slug.trim() || !form.contentMd.trim()} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300">
          {saving ? 'Saving…' : 'Save page'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </Panel>
  );
}
