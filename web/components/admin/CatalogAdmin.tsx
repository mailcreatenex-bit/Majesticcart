'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatRupees } from '@/lib/money';
import { centiToBv } from '@/lib/plan';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';
import { ImageUploadField, ImageGalleryField } from './ImageUploadField';

/**
 * The catalogue.
 *
 * The part that matters here is the **price check**. Every product carries a
 * business volume, and BV is what the whole compensation plan multiplies — so a
 * product whose BV is too high relative to its price cannot fund the commission
 * it generates. The company loses money on every sale, and the way that is
 * normally discovered is a margin report a month later.
 *
 * So the server's `priceCheck` runs as the price and BV are typed, and its
 * warnings are shown next to the fields rather than on save.
 *
 * Two other things the form enforces because the server does:
 *
 *   • **HSN is required.** A GST invoice is invalid without the HSN of each
 *     line, and discovering that at the first audit means reissuing every
 *     invoice already raised.
 *   • **Stock moves by delta, never by setting a total.** Two people counting
 *     the same shelf at once have to compose, not overwrite.
 */

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string | null;
  ingredients?: string | null;
  howToUse?: string | null;
  categoryId: string;
  category?: { id: string; name: string; slug: string };
  brandId: string | null;
  brand?: { id: string; name: string; slug: string } | null;
  mrpPaise: string | number;
  pricePaise: string | number;
  bvCenti: number;
  gstBp: number;
  hsnCode: string;
  countryOfOrigin: string;
  stock: number;
  sold: number;
  isActive: boolean;
  imageUrl: string | null;
  galleryImages: string[];
}

interface Category { id: string; name: string; slug: string; parentId?: string | null }

/** Departments first, each followed by its sub-categories: the order a person expects in a picker. */
function inTreeOrder(categories: Category[]): { c: Category; depth: number }[] {
  const ids = new Set(categories.map((c) => c.id));
  const tops = categories.filter((c) => !c.parentId || !ids.has(c.parentId));
  return tops.flatMap((t) => [
    { c: t, depth: 0 },
    ...categories.filter((k) => k.parentId === t.id).map((k) => ({ c: k, depth: 1 })),
  ]);
}
interface Brand { id: string; name: string; slug: string; isActive: boolean; _count?: { products: number } }

interface PricingWarning { level: 'error' | 'warning'; message: string }

export function CatalogAdminView() {
  return (
    <AdminShell
      title="Catalogue"
      subtitle="Products, prices and the business volume the plan multiplies."
      permission="catalog.manage"
    >
      <Catalog />
    </AdminShell>
  );
}

function Catalog() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, c, b] = await Promise.all([
      api<{ items: AdminProduct[] }>('/admin/catalog/products'),
      api<Category[]>('/catalog/categories'),
      api<Brand[]>('/admin/catalog/brands'),
    ]);
    setProducts(p.items);
    setCategories(c);
    setBrands(b);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the catalogue.'))
      .finally(() => setLoading(false));
  }, [load]);

  if (error && products.length === 0) return <AdminError message={error} />;
  if (loading) return <TableSkeleton rows={6} />;

  const lowStock = products.filter((p) => p.isActive && p.stock <= 10);

  return (
    <div className="space-y-5">
      {lowStock.length > 0 && (
        <Panel title={`Low stock — ${lowStock.length} product${lowStock.length === 1 ? '' : 's'}`}>
          <ul className="space-y-1 text-sm">
            {lowStock.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="text-neutral-700">{p.name}</span>
                <span className={`tabular-nums ${p.stock === 0 ? 'font-semibold text-red-700' : 'text-amber-700'}`}>
                  {p.stock === 0 ? 'out of stock' : `${p.stock} left`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {editing ? (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          brands={brands}
          onDone={async () => { setEditing(null); await load(); }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CsvImportExport onImported={load} />
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Add product
            </button>
          </div>

          {products.length === 0 ? (
            <AdminEmpty>No products yet.</AdminEmpty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Brand</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">BV</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Sold</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {products.map((p) => (
                    <ProductRow key={p.id} product={p} onChanged={load} onEdit={() => setEditing(p)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <BrandPanel brands={brands} onChanged={load} />
          <CategoryPanel categories={categories} onChanged={load} />
          <ReviewsPanel />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- csv */

interface CsvRowResult { row: number; sku?: string; status: 'created' | 'updated' | 'error'; message?: string }

/**
 * Bulk product import/export.
 *
 * Export and the import template are plain links rather than fetched with
 * `api()` on purpose: `api()` always JSON-parses the response, which a CSV
 * download is not. The admin session cookie travels with a normal browser
 * navigation the same way it does with a `fetch` call, so a link is enough
 * — no client-side blob assembly needed.
 */
function CsvImportExport({ onImported }: { onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CsvRowResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const csv = await file.text();
      const rows = await api<CsvRowResult[]>('/admin/catalog/products/import', { method: 'POST', body: { csv } });
      setResults(rows);
      await onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import that file.');
    } finally {
      setBusy(false);
    }
  };

  const created = results?.filter((r) => r.status === 'created').length ?? 0;
  const updated = results?.filter((r) => r.status === 'updated').length ?? 0;
  const failed = results?.filter((r) => r.status === 'error') ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/api/admin/catalog/products/export" className="font-semibold text-neutral-700 hover:underline">
          Export CSV
        </a>
        <span className="text-neutral-300">·</span>
        <a href="/api/admin/catalog/products/import-template" className="font-semibold text-neutral-700 hover:underline">
          Download template
        </a>
        <span className="text-neutral-300">·</span>
        <label className="cursor-pointer font-semibold text-neutral-700 hover:underline">
          {busy ? 'Importing…' : 'Import CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => upload(e.target.files?.[0])}
            disabled={busy}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {results && (
        <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs">
          <p className="font-semibold text-neutral-800">
            {created} created, {updated} updated{failed.length > 0 ? `, ${failed.length} failed` : ''}
          </p>
          {failed.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-red-700">
              {failed.map((r) => (
                <li key={r.row}>Row {r.row}{r.sku ? ` (${r.sku})` : ''}: {r.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ row */

function ProductRow({
  product, onChanged, onEdit,
}: {
  product: AdminProduct; onChanged: () => Promise<void>; onEdit: () => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjust = async () => {
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n === 0 || reason.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // A delta, never an absolute set: two people counting the same shelf at
      // once have to compose rather than overwrite each other.
      await api(`/admin/catalog/products/${product.id}/stock`, {
        method: 'POST',
        body: { delta: n, reason: reason.trim() },
      });
      setAdjusting(false);
      setDelta('');
      setReason('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not adjust stock.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      // Deactivated, never deleted: order history references the product, and
      // an invoice already raised has to keep reproducing exactly.
      await api(`/admin/catalog/products/${product.id}/active`, {
        method: 'PATCH',
        body: { isActive: !product.isActive },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change this product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className={product.isActive ? '' : 'bg-neutral-50 text-neutral-400'}>
        <td className="px-4 py-3">
          <p className="font-medium text-neutral-900">{product.name}</p>
          <p className="mt-0.5 font-mono text-xs text-neutral-500">
            {product.sku} · HSN {product.hsnCode}
            {!product.isActive && ' · inactive'}
          </p>
        </td>
        <td className="px-4 py-3 text-neutral-600">{product.brand?.name ?? '—'}</td>
        <td className="px-4 py-3 tabular-nums">{formatRupees(Number(product.pricePaise))}</td>
        <td className="px-4 py-3 tabular-nums">{centiToBv(product.bvCenti)}</td>
        <td className="px-4 py-3">
          <span className={`tabular-nums ${product.stock === 0 ? 'font-semibold text-red-700' : product.stock <= 10 ? 'text-amber-700' : ''}`}>
            {product.stock}
          </span>
        </td>
        <td className="px-4 py-3 tabular-nums text-neutral-500">{product.sold}</td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2 text-xs font-semibold">
            <button type="button" onClick={() => setAdjusting((v) => !v)} className="text-neutral-700 hover:underline">
              Stock
            </button>
            <button type="button" onClick={onEdit} className="text-neutral-700 hover:underline">
              Edit
            </button>
            <button type="button" onClick={toggleActive} disabled={busy} className="text-neutral-700 hover:underline disabled:text-neutral-300">
              {product.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </td>
      </tr>

      {adjusting && (
        <tr className="bg-neutral-50">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-neutral-600">
                Change by
                <input
                  value={delta}
                  onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))}
                  placeholder="+50 or -3"
                  className="mt-1 block w-24 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm tabular-nums focus:border-neutral-900 focus:outline-none"
                />
              </label>
              <label className="flex-1 text-xs text-neutral-600">
                Reason
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. delivery received from supplier"
                  className="mt-1 block w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={adjust}
                disabled={busy || !delta || reason.trim().length < 4}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
              >
                {busy ? 'Saving…' : 'Apply'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-neutral-500">
              A change, not a total — so two people counting at once compose instead of overwriting.
              {delta && ` New stock: ${product.stock + Math.trunc(Number(delta) || 0)}.`}
            </p>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- form */

function ProductForm({
  product, categories, brands, onDone, onCancel,
}: {
  product: AdminProduct | null;
  categories: Category[];
  brands: Brand[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    ingredients: product?.ingredients ?? '',
    howToUse: product?.howToUse ?? '',
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    brandId: product?.brandId ?? '',
    mrp: product ? (Number(product.mrpPaise) / 100).toFixed(2) : '',
    price: product ? (Number(product.pricePaise) / 100).toFixed(2) : '',
    bv: product ? centiToBv(product.bvCenti) : '',
    gstBp: product?.gstBp ?? 1800,
    hsnCode: product?.hsnCode ?? '',
    countryOfOrigin: product?.countryOfOrigin ?? 'India',
    stock: product?.stock ?? 0,
    isActive: product?.isActive ?? true,
    imageUrl: product?.imageUrl ?? '',
    galleryImages: product?.galleryImages ?? [],
  });

  const [warnings, setWarnings] = useState<PricingWarning[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * Cost the economics as the price and BV are typed.
   *
   * This is the check that catches a product which cannot fund its own
   * commission. Debounced and aborted per keystroke, so a slow answer for an
   * earlier value cannot land after a newer one.
   */
  useEffect(() => {
    if (!form.price || !form.bv) { setWarnings([]); return; }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const w = await api<PricingWarning[]>('/admin/catalog/price-check', {
          method: 'POST',
          body: { price: form.price, bv: form.bv },
          signal: controller.signal,
        });
        setWarnings(w);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setWarnings([]);
      }
    }, 400);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [form.price, form.bv]);

  const blocking = warnings.some((w) => w.level === 'error');

  const save = async () => {
    if (saving || blocking) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const body = {
      sku: form.sku.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      ingredients: form.ingredients.trim() || undefined,
      howToUse: form.howToUse.trim() || undefined,
      categoryId: form.categoryId,
      brandId: form.brandId || undefined,
      mrp: form.mrp,
      price: form.price,
      bv: form.bv,
      gstBp: form.gstBp,
      hsnCode: form.hsnCode.trim(),
      countryOfOrigin: form.countryOfOrigin.trim() || 'India',
      stock: form.stock,
      isActive: form.isActive,
      imageUrl: form.imageUrl.trim() || undefined,
      galleryImages: form.galleryImages,
    };

    try {
      if (product) {
        await api(`/admin/catalog/products/${product.id}`, { method: 'PUT', body });
      } else {
        await api('/admin/catalog/products', { method: 'POST', body });
      }
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not save the product.');
      }
      setSaving(false);
    }
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Panel title={product ? `Edit ${product.name}` : 'New product'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" value={form.sku} onChange={(v) => set('sku', v.toUpperCase())} error={fieldErrors.sku}
          hint={product ? 'Changing this does not change the public URL' : '3 to 24 letters, digits or hyphens'} />
        <Field label="Name" value={form.name} onChange={(v) => set('name', v)} error={fieldErrors.name} />

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-neutral-800">
            Description
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-neutral-800">
            How to use (optional)
            <textarea value={form.howToUse} onChange={(e) => set('howToUse', e.target.value)} rows={3}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-neutral-800">
            Ingredients (optional)
            <textarea value={form.ingredients} onChange={(e) => set('ingredients', e.target.value)} rows={3}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
        </div>

        <label className="block text-sm font-medium text-neutral-800">
          Category
          <select
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {inTreeOrder(categories).map(({ c, depth }) => <option key={c.id} value={c.id}>{depth ? ` ${c.name}` : c.name}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium text-neutral-800">
          Brand
          <select
            value={form.brandId}
            onChange={(e) => set('brandId', e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="">No brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>

        <Field label="MRP (₹)" value={form.mrp} onChange={(v) => set('mrp', v.replace(/[^\d.]/g, ''))} error={fieldErrors.mrp} />
        <Field label="Selling price (₹)" value={form.price} onChange={(v) => set('price', v.replace(/[^\d.]/g, ''))} error={fieldErrors.price}
          hint="GST-inclusive, as shown on the shelf" />
        <Field label="Business volume" value={form.bv} onChange={(v) => set('bv', v.replace(/[^\d.]/g, ''))} error={fieldErrors.bv}
          hint="What the plan multiplies. Check the warnings below." />

        <label className="block text-sm font-medium text-neutral-800">
          GST rate
          <select
            value={form.gstBp}
            onChange={(e) => set('gstBp', Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {[0, 500, 1200, 1800, 2800].map((bp) => (
              <option key={bp} value={bp}>{bp / 100}%</option>
            ))}
          </select>
        </label>

        <Field label="HSN code" value={form.hsnCode} onChange={(v) => set('hsnCode', v.replace(/\D/g, ''))} error={fieldErrors.hsnCode}
          hint="Required — a GST invoice is invalid without it. Confirm with your CA." />
        <Field label="Country of origin" value={form.countryOfOrigin} onChange={(v) => set('countryOfOrigin', v)} error={fieldErrors.countryOfOrigin}
          hint="Required on the product page by the E-Commerce Rules" />

        {!product && (
          <Field label="Opening stock" value={String(form.stock)}
            onChange={(v) => set('stock', Math.max(0, Math.trunc(Number(v.replace(/\D/g, '')) || 0)))} />
        )}

        <div className="sm:col-span-2">
          <ImageUploadField
            label="Thumbnail"
            value={form.imageUrl}
            onChange={(url) => set('imageUrl', url)}
            purpose="product-image"
            hint="Shown on cards and first on the product page."
          />
        </div>

        <div className="sm:col-span-2">
          <ImageGalleryField
            label="Gallery"
            values={form.galleryImages}
            onChange={(urls) => set('galleryImages', urls)}
            purpose="product-image"
          />
        </div>
      </div>

      {/* ---------------------------------------------- the economics check */}
      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.map((w, i) => (
            <p
              key={i}
              className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                w.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'
              }`}
            >
              {w.message}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || blocking}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {saving ? 'Saving…' : product ? 'Save changes' : 'Create product'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>

      {blocking && (
        <p className="mt-2 text-xs text-red-700">
          Fix the error above before saving — this pricing cannot fund the commission it would
          generate.
        </p>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- brands */

function BrandPanel({ brands, onChanged }: { brands: Brand[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/catalog/brands', { method: 'POST', body: { name: name.trim() } });
      setName('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the brand.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (brand: Brand) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/catalog/brands/${brand.id}`, {
        method: 'PUT',
        body: { name: brand.name, isActive: !brand.isActive },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not change ${brand.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (brand: Brand) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/catalog/brands/${brand.id}/delete`, { method: 'POST', body: {} });
      await onChanged();
    } catch (err) {
      // The usual cause is products still assigned to it, which the server
      // refuses rather than silently unbranding them.
      setError(err instanceof ApiError ? err.message : `Could not remove ${brand.name}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Brands">
      <ul className="flex flex-wrap gap-2">
        {brands.map((b) => (
          <li
            key={b.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
              b.isActive ? 'border-neutral-200' : 'border-neutral-200 bg-neutral-50 text-neutral-400'
            }`}
          >
            <span>{b.name}</span>
            <span className="text-xs text-neutral-400">{b._count?.products ?? 0} products</span>
            <button
              type="button"
              onClick={() => toggle(b)}
              disabled={busy}
              className="text-xs font-semibold text-neutral-600 hover:underline disabled:text-neutral-300"
            >
              {b.isActive ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => remove(b)}
              disabled={busy}
              className="text-xs font-semibold text-red-700 hover:underline disabled:text-neutral-300"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New brand name"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || name.trim().length < 2}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          Add
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        Pausing removes a brand from the shop's filter menu, but its products stay listed and
        buyable under their category — use it when a supplier relationship winds down, without
        having to deactivate every one of their products by hand.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------ categories */

function CategoryPanel({ categories, onChanged }: { categories: Category[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departments = categories.filter((c) => !c.parentId);

  const add = async () => {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/catalog/categories', { method: 'POST', body: { name: name.trim(), parentId: parentId || null } });
      setName('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the category.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/catalog/categories/${id}/delete`, { method: 'POST', body: {} });
      await onChanged();
    } catch (err) {
      // The usual cause is products still in it, which the server refuses
      // rather than orphaning them.
      setError(err instanceof ApiError ? err.message : `Could not remove ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Categories">
      <ul className="space-y-3">
        {inTreeOrder(categories).filter((x) => x.depth === 0).map(({ c: dept }) => (
          <li key={dept.id}>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip c={dept} strong busy={busy} onRemove={remove} />
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-2 pl-4">
              {categories.filter((k) => k.parentId === dept.id).map((k) => (
                <li key={k.id}><CategoryChip c={k} busy={busy} onRemove={remove} /></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
          placeholder="New category name"
          className="min-w-[10rem] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label="Parent category"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        >
          <option value="">Top-level category</option>
          {departments.map((d) => <option key={d.id} value={d.id}>Under {d.name}</option>)}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={busy || name.trim().length < 2}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          Add
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        Each category is a public page with copy of its own — they carry most of the catalogue&apos;s
        search traffic, so adding one is a page to write, not just a filter.
      </p>
    </Panel>
  );
}

function CategoryChip({ c, strong, busy, onRemove }: { c: Category; strong?: boolean; busy: boolean; onRemove: (id: string, label: string) => void }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${strong ? 'border-neutral-400 bg-neutral-50 font-semibold' : 'border-neutral-200'}`}>
      <span className="text-neutral-800">{c.name}</span>
      <span className="font-mono text-xs font-normal text-neutral-400">/{c.slug}</span>
      <button
        type="button"
        onClick={() => onRemove(c.id, c.name)}
        disabled={busy}
        aria-label={`Remove ${c.name}`}
        className="text-xs font-semibold text-red-700 hover:underline disabled:text-neutral-300"
      >
        ×
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------- reviews */

interface AdminReview { id: string; rating: number; title: string | null; body: string; status: 'PUBLISHED' | 'HIDDEN'; at: string; product: string; productSlug: string; author: string; memberCode: string }

/** Moderation: every review is published on arrival; an admin can hide one that breaks the rules and restore it later. */
function ReviewsPanel() {
  const [rows, setRows] = useState<AdminReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try { setRows(await api<AdminReview[]>('/admin/catalog/reviews')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load reviews.'); }
  };
  useEffect(() => { void load(); }, []);

  const toggle = async (r: AdminReview) => {
    setBusy(r.id); setError(null);
    try {
      await api(`/admin/catalog/reviews/${r.id}/status`, { method: 'POST', body: { status: r.status === 'HIDDEN' ? 'PUBLISHED' : 'HIDDEN' } });
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not update the review.'); }
    finally { setBusy(null); }
  };

  return (
    <Panel title="Reviews">
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {!rows ? <p className="text-sm text-neutral-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No reviews yet. Members can review a product once it has been delivered to them.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="text-neutral-900">
                  <span className="text-amber-500">{'★'.repeat(r.rating)}</span><span className="text-neutral-300">{'★'.repeat(5 - r.rating)}</span>
                  {' '}<span className="font-medium">{r.title ?? ''}</span>
                  {r.status === 'HIDDEN' && <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600">hidden</span>}
                </p>
                <p className="mt-0.5 text-neutral-700">{r.body}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{r.product} - {r.author} ({r.memberCode}) - {new Date(r.at).toLocaleDateString('en-IN')}</p>
              </div>
              <button type="button" disabled={busy === r.id} onClick={() => toggle(r)} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50">
                {r.status === 'HIDDEN' ? 'Show' : 'Hide'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- pieces */

function Field({
  label, value, onChange, hint, error,
}: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-800">
        {label}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
        />
      </label>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p>
        : hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}
