'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * Errors the site hit, grouped so one bug that fires a thousand times is one row with a count.
 * "Server" errors come from the API, "Browser" ones from a visitor's page. Mark one resolved
 * once it is fixed; if it comes back it reopens by itself.
 */

interface Row {
  id: string; source: 'api' | 'web'; message: string; detail: string | null; path: string | null;
  status: number | null; count: number; firstSeenAt: string; lastSeenAt: string; resolved: boolean;
}

export function ErrorsAdminView() {
  return (
    <AdminShell title="Errors" subtitle="What went wrong on the site, newest first." permission="security.view">
      <Errors />
    </AdminShell>
  );
}

function Errors() {
  const [showResolved, setShowResolved] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api<{ items: Row[] }>(`/admin/errors?resolved=${showResolved}`)).items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load errors.');
    }
  }, [showResolved]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  const resolve = async (id: string) => {
    try {
      await api(`/admin/errors/${id}/resolve`, { method: 'POST', body: {} });
      setRows((r) => r?.filter((x) => x.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update it.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {([[false, 'Open'], [true, 'Resolved']] as const).map(([v, label]) => (
          <button key={label} type="button" onClick={() => setShowResolved(v)} className={`rounded-lg px-3 py-1.5 text-sm ${showResolved === v ? 'bg-neutral-900 text-white' : 'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <AdminError message={error} />}
      {!rows && !error && <TableSkeleton rows={4} />}
      {rows && rows.length === 0 && <AdminEmpty>{showResolved ? 'Nothing resolved yet.' : 'No open errors. Nice.'}</AdminEmpty>}

      <ul className="space-y-3">
        {rows?.map((r) => (
          <li key={r.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 break-words">{r.message}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${r.source === 'api' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{r.source === 'api' ? 'Server' : 'Browser'}</span>
                  {r.path && <span className="font-mono">{r.path}</span>}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {r.count.toLocaleString('en-IN')} time{r.count === 1 ? '' : 's'} · first {formatDate(r.firstSeenAt, { time: true })} · last {formatDate(r.lastSeenAt, { time: true })}
                </p>
              </div>
              <div className="flex gap-2">
                {r.detail && (
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100">
                    {open === r.id ? 'Hide details' : 'Details'}
                  </button>
                )}
                {!r.resolved && (
                  <button type="button" onClick={() => resolve(r.id)} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">Mark resolved</button>
                )}
              </div>
            </div>
            {open === r.id && r.detail && (
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-700">{r.detail}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
