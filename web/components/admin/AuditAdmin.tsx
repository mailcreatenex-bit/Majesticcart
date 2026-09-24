'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, TableSkeleton } from './AdminShell';

/**
 * The audit log, read-only: who did what, and when. Filter by the kind of action to answer
 * "who changed the plan", "who paid out royalty", "who approved that withdrawal".
 */

interface Entry { id: string; at: string; actor: string; action: string; detail: Record<string, unknown> | null }

const FILTERS = [
  { k: '', l: 'Everything' }, { k: 'plan.', l: 'Plan changes' }, { k: 'royalty.', l: 'Royalty payouts' },
  { k: 'withdrawal.', l: 'Withdrawals' }, { k: 'recharge.', l: 'Recharges' }, { k: 'coupon.', l: 'Coupons' },
  { k: 'product.', l: 'Products' }, { k: 'role.', l: 'Roles' }, { k: 'admin.', l: 'Admin accounts' }, { k: 'support.', l: 'Support' },
];

const summarise = (d: Entry['detail']): string => {
  if (!d) return '';
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
};

export function AuditAdminView() {
  return (
    <AdminShell title="Audit log" subtitle="Who did what, and when. Read-only." permission="security.view">
      <Audit />
    </AdminShell>
  );
}

function Audit() {
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    api<Entry[]>(`/admin/audit${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the audit log.'); });
    return () => { cancelled = true; };
  }, [prefix]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.k} type="button" aria-pressed={prefix === f.k} onClick={() => setPrefix(f.k)}
            className={`rounded-full border px-3 py-1 text-xs ${prefix === f.k ? 'border-neutral-900 bg-neutral-900 font-semibold text-white' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}>{f.l}</button>
        ))}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <TableSkeleton rows={6} />}
      {rows && (
        <Panel title={`Latest ${rows.length} entries`}>
          {rows.length === 0 ? <p className="text-sm text-neutral-500">No entries.</p> : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <li key={r.id} className="py-2.5 text-sm">
                  <p className="text-neutral-900"><span className="font-mono text-xs font-semibold">{r.action}</span> <span className="text-neutral-500">by {r.actor}</span></p>
                  <p className="text-xs text-neutral-500">{new Date(r.at).toLocaleString('en-IN')}</p>
                  {summarise(r.detail) && <p className="mt-0.5 break-words text-xs text-neutral-600">{summarise(r.detail)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
