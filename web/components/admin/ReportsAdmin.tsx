'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, TableSkeleton } from './AdminShell';

/**
 * The four operating reports: payout against sales, top sponsors, new joins per day
 * and inactive members. Each can be downloaded as a CSV that opens in Excel.
 */

interface Column { key: string; label: string; kind?: 'money' | 'percent' | 'number' | 'date' | 'text' }
interface Report {
  key: string; title: string; description: string; columns: Column[];
  rows: Record<string, string | number | null>[]; note?: string;
}

const TABS = [
  { key: 'payout-vs-sales', label: 'Payout vs sales' },
  { key: 'top-sponsors', label: 'Top sponsors' },
  { key: 'new-joins', label: 'New joins' },
  { key: 'inactive-members', label: 'Inactive members' },
];

const isNumeric = (k?: Column['kind']) => k === 'money' || k === 'number' || k === 'percent';

const fmt = (v: string | number | null | undefined, kind?: Column['kind']): string => {
  if (v === null || v === undefined || v === '') return '-';
  if (kind === 'money') return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === 'percent') return `${v}%`;
  if (kind === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A cell that starts with = + - @ can run as a formula when opened in a spreadsheet.
  const risky = /^[=+@]/.test(s) || (/^-/.test(s) && Number.isNaN(Number(s)));
  const safe = risky ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function ReportsAdminView() {
  return (
    <AdminShell title="Reports" subtitle="What was sold, what was paid, who is growing and who has gone quiet." permission="reports.view">
      <Reports />
    </AdminShell>
  );
}

function Reports() {
  const [tab, setTab] = useState(TABS[0].key);
  const [days, setDays] = useState(60);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<Report>(`/admin/reports/${tab}${tab === 'inactive-members' ? `?days=${days}` : ''}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not run the report.'); });
    return () => { cancelled = true; };
  }, [tab, days]);

  const download = () => {
    if (!data) return;
    const lines = [data.columns.map((c) => csvCell(c.label)).join(',')];
    for (const r of data.rows) lines.push(data.columns.map((c) => csvCell(r[c.key])).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `majestic-cart-${data.key}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === t.key ? 'border-neutral-900 bg-neutral-900 font-semibold text-white' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <TableSkeleton rows={6} />}

      {data && (
        <Panel
          title={data.title}
          action={
            <div className="flex items-center gap-3">
              {tab === 'inactive-members' && (
                <label className="text-xs text-neutral-600">
                  No order in{' '}
                  <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded border border-neutral-300 px-1.5 py-1 text-xs">
                    {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </label>
              )}
              <button type="button" onClick={download} disabled={data.rows.length === 0} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-40">
                Download CSV
              </button>
            </div>
          }
        >
          <p className="text-sm text-neutral-600">{data.description}</p>
          {data.note && <p className="mt-1 text-xs text-neutral-500">{data.note}</p>}
          {data.rows.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">Nothing to show for this report yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                    {data.columns.map((c) => (
                      <th key={c.key} className={`py-2 pr-4 font-medium ${isNumeric(c.kind) ? 'text-right' : ''}`}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100 last:border-0">
                      {data.columns.map((c) => (
                        <td key={c.key} className={`py-2 pr-4 text-neutral-800 ${isNumeric(c.kind) ? 'text-right tabular-nums' : ''}`}>{fmt(r[c.key], c.kind)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
