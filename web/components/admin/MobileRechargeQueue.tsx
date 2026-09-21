'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, type MoneyView } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * Mobile recharge queue.
 *
 * The amount is already held from the member's shopping wallet — this screen
 * is not deciding whether they can afford it, it is recording that the
 * recharge was actually done with the operator (or giving the hold back if it
 * couldn't be). Same shape as WithdrawalQueue.tsx, one field simpler: there is
 * no deduction and no bank account to display, because this pays out inside
 * the platform's own service, not to an outside account.
 */

interface RechargeRow {
  id: string;
  mobileNumber: string;
  operator: 'JIO' | 'AIRTEL' | 'VI' | 'BSNL' | 'OTHER';
  amount: MoneyView;
  member: { memberCode: string; name: string; phone: string };
  createdAt: string;
}

export function MobileRechargeQueueView() {
  return (
    <AdminShell
      title="Mobile recharges"
      subtitle="The amount is already held from the member's shopping wallet. Complete the top-up with the operator, then record it here — or return it."
      roles={['ADMIN', 'FINANCE']}
    >
      <Queue />
    </AdminShell>
  );
}

function Queue() {
  const [rows, setRows] = useState<RechargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const items = await api<RechargeRow[]>('/admin/mobile-recharges');
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
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load recharge requests.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const settle = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const total = rows.reduce((sum, r) => sum + r.amount.paise, 0);

  return (
    <div className="space-y-4">
      {total > 0 && (
        <p className="text-sm text-neutral-600">
          Waiting to be recharged:{' '}
          <span className="font-semibold tabular-nums text-neutral-900">
            {showMoney({ paise: total, amount: (total / 100).toFixed(2), display: `₹${(total / 100).toLocaleString('en-IN')}` })}
          </span>
        </p>
      )}

      {error && <AdminError message={error} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <AdminEmpty>No recharges waiting.</AdminEmpty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => <RechargeCard key={r.id} row={r} onSettled={() => settle(r.id)} />)}
        </ul>
      )}
    </div>
  );
}

function RechargeCard({ row, onSettled }: { row: RechargeRow; onSettled: () => void }) {
  const [operatorRef, setOperatorRef] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'idle' | 'failing'>('idle');
  const [busy, setBusy] = useState<null | 'complete' | 'fail'>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    if (operatorRef.trim().length < 1 || busy) return;
    setBusy('complete');
    setError(null);
    try {
      await api(`/admin/mobile-recharges/${row.id}/complete`, { method: 'POST', body: { operatorRef: operatorRef.trim() } });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this as complete.');
      setBusy(null);
    }
  };

  const fail = async () => {
    if (reason.trim().length < 4 || busy) return;
    setBusy('fail');
    setError(null);
    try {
      await api(`/admin/mobile-recharges/${row.id}/fail`, { method: 'POST', body: { reason: reason.trim() } });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not return this request.');
      setBusy(null);
    }
  };

  return (
    <li className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-100 p-4">
        <div>
          <p className="font-semibold text-neutral-900">
            {row.member.name}
            <span className="ml-2 font-mono text-xs font-normal text-neutral-500">{row.member.memberCode}</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {row.mobileNumber} · {row.operator} · requested {formatDate(row.createdAt, { time: true })}
          </p>
        </div>
        <p className="text-xl font-semibold tabular-nums text-neutral-900">{showMoney(row.amount)}</p>
      </div>

      <div className="p-4">
        {mode === 'idle' ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="w-full text-sm font-medium text-neutral-800 sm:w-auto">
                Operator / recharge-dashboard reference
                <input
                  value={operatorRef}
                  onChange={(e) => setOperatorRef(e.target.value)}
                  placeholder="Transaction ID from the recharge dashboard"
                  className="mt-1.5 block w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-neutral-900 focus:outline-none sm:w-64"
                />
              </label>

              <button
                type="button"
                onClick={complete}
                disabled={operatorRef.trim().length < 1 || !!busy}
                className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
              >
                {busy === 'complete' ? 'Recording…' : 'Mark completed'}
              </button>

              <button
                type="button"
                onClick={() => setMode('failing')}
                disabled={!!busy}
                className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Couldn&apos;t complete
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Recharge {row.mobileNumber} for {showMoney(row.amount)} with {row.operator} first, then record it here.
            </p>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium text-neutral-800">
              Why couldn&apos;t this be completed?
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                placeholder="e.g. number is switched off / operator API is down"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
              />
              <span className="mt-1 block text-xs font-normal text-neutral-500">
                The member sees this, and the held amount goes back to their shopping wallet.
              </span>
            </label>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={fail}
                disabled={reason.trim().length < 4 || !!busy}
                className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
              >
                {busy === 'fail' ? 'Returning…' : 'Confirm and return funds'}
              </button>
              <button
                type="button"
                onClick={() => { setMode('idle'); setReason(''); }}
                className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>
    </li>
  );
}
