'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * Discount coupons.
 *
 * A code is never deleted once created — only deactivated. An order already
 * placed against it keeps its own couponCode and discount snapshotted
 * (Order.couponCode / discountPaise), so removing the coupon row itself would
 * only orphan the admin's ability to look it up, never break an invoice.
 */

interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number; // basis points for PERCENT, paise for FIXED
  maxDiscountPaise: string | number | null;
  minOrderPaise: string | number;
  usageLimit: number | null;
  usedCount: number;
  perMemberLimit: number;
  isActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function CouponAdminView() {
  return (
    <AdminShell title="Coupons" subtitle="Discount codes members apply at checkout." roles={['ADMIN', 'FINANCE']}>
      <Coupons />
    </AdminShell>
  );
}

function Coupons() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCoupons(await api<AdminCoupon[]>('/admin/coupons'));
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load coupons.'))
      .finally(() => setLoading(false));
  }, [load]);

  if (error && coupons.length === 0) return <AdminError message={error} />;
  if (loading) return <TableSkeleton rows={5} />;

  return (
    <div className="space-y-5">
      {creating ? (
        <CouponForm onDone={async () => { setCreating(false); await load(); }} onCancel={() => setCreating(false)} />
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Create coupon
          </button>
        </div>
      )}

      {coupons.length === 0 ? (
        <AdminEmpty>No coupons yet.</AdminEmpty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Min order</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Per member</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {coupons.map((c) => (
                <CouponRow key={c.id} coupon={c} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CouponRow({ coupon, onChanged }: { coupon: AdminCoupon; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/admin/coupons/${coupon.id}/active`, { method: 'POST', body: { isActive: !coupon.isActive } });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const discountLabel = coupon.type === 'PERCENT'
    ? `${(coupon.value / 100).toFixed(coupon.value % 100 === 0 ? 0 : 1)}% off${coupon.maxDiscountPaise ? `, up to ₹${(Number(coupon.maxDiscountPaise) / 100).toFixed(0)}` : ''}`
    : `₹${(Number(coupon.value) / 100).toFixed(0)} off`;

  const expired = coupon.expiresAt ? new Date(coupon.expiresAt) < new Date() : false;
  const exhausted = coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit;

  return (
    <tr className={coupon.isActive && !expired && !exhausted ? '' : 'bg-neutral-50 text-neutral-400'}>
      <td className="px-4 py-3">
        <p className="font-mono font-semibold text-neutral-900">{coupon.code}</p>
        {coupon.description && <p className="mt-0.5 text-xs text-neutral-500">{coupon.description}</p>}
      </td>
      <td className="px-4 py-3">{discountLabel}</td>
      <td className="px-4 py-3 tabular-nums">
        {Number(coupon.minOrderPaise) > 0 ? `₹${(Number(coupon.minOrderPaise) / 100).toFixed(0)}` : '—'}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {coupon.usedCount}{coupon.usageLimit != null ? ` / ${coupon.usageLimit}` : ''}
        {exhausted && <span className="ml-1 text-xs font-semibold text-red-700">exhausted</span>}
      </td>
      <td className="px-4 py-3 tabular-nums">{coupon.perMemberLimit}×</td>
      <td className="px-4 py-3 text-xs text-neutral-500">
        {coupon.startsAt && <div>From {new Date(coupon.startsAt).toLocaleDateString('en-IN')}</div>}
        {coupon.expiresAt && (
          <div className={expired ? 'font-semibold text-red-700' : ''}>
            {expired ? 'Expired ' : 'Until '}{new Date(coupon.expiresAt).toLocaleDateString('en-IN')}
          </div>
        )}
        {!coupon.startsAt && !coupon.expiresAt && '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="text-xs font-semibold text-neutral-700 hover:underline disabled:text-neutral-300"
        >
          {coupon.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------- form */

function CouponForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({
    code: '',
    description: '',
    type: 'PERCENT' as 'PERCENT' | 'FIXED',
    value: '',
    maxDiscount: '',
    minOrder: '0',
    usageLimit: '',
    perMemberLimit: '1',
    startsAt: '',
    expiresAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await api('/admin/coupons', {
        method: 'POST',
        body: {
          code: form.code.trim(),
          description: form.description.trim() || undefined,
          type: form.type,
          value: form.value,
          maxDiscount: form.type === 'PERCENT' && form.maxDiscount ? form.maxDiscount : undefined,
          minOrder: form.minOrder || '0',
          usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
          perMemberLimit: Number(form.perMemberLimit) || 1,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        },
      });
      await onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not create the coupon.');
      }
      setSaving(false);
    }
  };

  return (
    <Panel title="New coupon">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" value={form.code} onChange={(v) => set('code', v.toUpperCase())} error={fieldErrors.code}
          hint="3–24 letters, digits or hyphens — members type this exactly" />
        <Field label="Description (admin-only)" value={form.description} onChange={(v) => set('description', v)} />

        <label className="block text-sm font-medium text-neutral-800">
          Type
          <select
            value={form.type}
            onChange={(e) => set('type', e.target.value as 'PERCENT' | 'FIXED')}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="PERCENT">Percentage off</option>
            <option value="FIXED">Flat amount off</option>
          </select>
        </label>

        <Field
          label={form.type === 'PERCENT' ? 'Percent off (e.g. 10)' : 'Amount off (₹)'}
          value={form.value}
          onChange={(v) => set('value', v.replace(/[^\d.]/g, ''))}
          error={fieldErrors.value}
        />

        {form.type === 'PERCENT' && (
          <Field label="Max discount (₹, optional)" value={form.maxDiscount} onChange={(v) => set('maxDiscount', v.replace(/[^\d.]/g, ''))}
            hint="Caps a big basket from taking the percentage at full strength" />
        )}
        <Field label="Minimum order (₹)" value={form.minOrder} onChange={(v) => set('minOrder', v.replace(/[^\d.]/g, ''))} />

        <Field label="Total use limit (optional)" value={form.usageLimit} onChange={(v) => set('usageLimit', v.replace(/\D/g, ''))}
          hint="Leave blank for unlimited redemptions across all members" />
        <Field label="Uses per member" value={form.perMemberLimit} onChange={(v) => set('perMemberLimit', v.replace(/\D/g, ''))} />

        <label className="block text-sm font-medium text-neutral-800">
          Starts (optional)
          <input
            type="date"
            value={form.startsAt}
            onChange={(e) => set('startsAt', e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Expires (optional)
          <input
            type="date"
            value={form.expiresAt}
            onChange={(e) => set('expiresAt', e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !form.code.trim() || !form.value}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {saving ? 'Saving…' : 'Create coupon'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
    </Panel>
  );
}

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
