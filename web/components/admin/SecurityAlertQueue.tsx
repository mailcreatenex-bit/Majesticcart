'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * Fraud/abuse signals the platform raises on its own — duplicate UTRs, reused
 * recharge screenshots, and so on — with somewhere to actually see and clear
 * them. The dashboard's "Security alerts" count linked nowhere before this.
 */

interface AlertRow {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  type: string;
  message: string;
  memberId: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export function SecurityAlertQueueView() {
  return (
    <AdminShell
      title="Security alerts"
      subtitle="Fraud and abuse signals the platform raised on its own. Resolve once you've reviewed and acted on one."
      roles={['ADMIN', 'FINANCE', 'SUPPORT']}
    >
      <Queue />
    </AdminShell>
  );
}

const SEVERITY_STYLE: Record<AlertRow['severity'], string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-200',
  LOW: 'bg-neutral-100 text-neutral-600 border-neutral-200',
};

function Queue() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const items = await api<AlertRow[]>('/admin/security-alerts');
    setRows(items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load alerts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const resolved = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className="space-y-4">
      {error && <AdminError message={error} />}
      {loading ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <AdminEmpty>Nothing open — every raised signal has been reviewed.</AdminEmpty>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => <AlertCard key={a.id} row={a} onResolved={() => resolved(a.id)} />)}
        </ul>
      )}
    </div>
  );
}

function AlertCard({ row, onResolved }: { row: AlertRow; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/security-alerts/${row.id}/resolve`, { method: 'POST', body: {} });
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve this alert.');
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[row.severity]}`}>
              {row.severity}
            </span>
            <span className="font-mono text-xs text-neutral-500">{row.type}</span>
          </div>
          <p className="mt-1.5 text-sm text-neutral-900">{row.message}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {formatDate(row.createdAt, { time: true })}
            {row.memberId && <> · member <span className="font-mono">{row.memberId}</span></>}
            {row.refType && row.refId && <> · {row.refType} <span className="font-mono">{row.refId}</span></>}
          </p>
        </div>
        <button
          type="button"
          onClick={resolve}
          disabled={busy}
          className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {busy ? 'Resolving…' : 'Mark resolved'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
