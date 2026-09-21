'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, type MoneyView } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * The payout queue.
 *
 * Money leaving the platform. The amount has already been debited from the
 * member's income wallet when they requested it — the hold is what stops it
 * being spent twice while the transfer is arranged — so this screen is not
 * deciding whether they have the funds. It is recording that a bank transfer
 * happened, or giving the money back.
 *
 * Two things follow:
 *
 *   • **Marking paid requires a transfer reference.** It is the only link
 *     between a row here and a line on the bank statement, and without one a
 *     dispute six months later has nothing to check against.
 *   • **The account details are shown in full**, because finance has to read
 *     them to make the transfer. They are the snapshot taken at request time,
 *     not the member's current details — which is the answer if a member
 *     changes their account afterwards and disputes where the money went.
 */

interface Withdrawal {
  id: string;
  status: 'PENDING' | 'PAID' | 'REJECTED';
  requested: MoneyView;
  deduction: MoneyView;
  net: MoneyView;
  deductionPercent: number;
  member: { memberCode: string; name: string; phone: string };
  payout: {
    upi: string | null;
    holder: string | null;
    bank: string | null;
    account: string | null;
    accountLastFour: string | null;
    ifsc: string | null;
  } | null;
  transferRef: string | null;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export function WithdrawalQueueView() {
  return (
    <AdminShell
      title="Withdrawals"
      subtitle="The amount is already held from the member's wallet. Record the transfer, or return it."
      roles={['ADMIN', 'FINANCE']}
    >
      <Queue />
    </AdminShell>
  );
}

function Queue() {
  const [status, setStatus] = useState<'PENDING' | 'PAID' | 'REJECTED' | 'ALL'>('PENDING');
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: string, after: string | null) => {
    const qs = new URLSearchParams({ status: s });
    if (after) qs.set('cursor', after);
    const page = await api<{ items: Withdrawal[]; nextCursor: string | null }>(`/admin/withdrawals?${qs}`);
    setRows((prev) => (after ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    (async () => {
      try {
        await load(status, null);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load withdrawals.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, load]);

  const settle = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const pendingTotal = rows
    .filter((r) => r.status === 'PENDING')
    .reduce((sum, r) => sum + r.net.paise, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['PENDING', 'PAID', 'REJECTED', 'ALL'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                status === s ? 'bg-neutral-900 text-white' : 'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* The figure whoever is at the bank actually needs. */}
        {status === 'PENDING' && pendingTotal > 0 && (
          <p className="ml-auto text-sm text-neutral-600">
            To transfer:{' '}
            <span className="font-semibold tabular-nums text-neutral-900">
              {showMoney({ paise: pendingTotal, amount: (pendingTotal / 100).toFixed(2), display: `₹${(pendingTotal / 100).toLocaleString('en-IN')}` })}
            </span>
          </p>
        )}
      </div>

      {error && <AdminError message={error} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <AdminEmpty>
          {status === 'PENDING' ? 'No payouts waiting.' : `No ${status.toLowerCase()} withdrawals.`}
        </AdminEmpty>
      ) : (
        <ul className="space-y-3">
          {rows.map((w) => <WithdrawalCard key={w.id} row={w} onSettled={() => settle(w.id)} />)}
        </ul>
      )}

      {cursor && !loading && (
        <button
          type="button"
          onClick={() => void load(status, cursor)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function WithdrawalCard({ row, onSettled }: { row: Withdrawal; onSettled: () => void }) {
  const [transferRef, setTransferRef] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [busy, setBusy] = useState<null | 'paid' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const decided = row.status !== 'PENDING';

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { setCopied(null); }
  };

  const markPaid = async () => {
    if (transferRef.trim().length < 6 || busy) return;
    setBusy('paid');
    setError(null);
    try {
      await api(`/admin/withdrawals/${row.id}/paid`, {
        method: 'POST',
        body: { transferRef: transferRef.trim() },
      });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this as paid.');
      setBusy(null);
    }
  };

  const reject = async () => {
    if (note.trim().length < 4 || busy) return;
    setBusy('reject');
    setError(null);
    try {
      await api(`/admin/withdrawals/${row.id}/reject`, { method: 'POST', body: { note: note.trim() } });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject this request.');
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
            {row.member.phone} · requested {formatDate(row.createdAt, { time: true })}
          </p>
        </div>

        <div className="text-right">
          {/* The net is what gets transferred, so it is the number in bold.
              The gross and the deduction are shown because the member sees
              them too and will ask about the difference. */}
          <p className="text-xl font-semibold tabular-nums text-neutral-900">{showMoney(row.net)}</p>
          <p className="text-xs text-neutral-500">
            {showMoney(row.requested)} less {row.deductionPercent}% ({showMoney(row.deduction)})
          </p>
        </div>
      </div>

      {/* --------------------------------------------- where it has to go */}
      {row.payout && (
        <div className="border-b border-neutral-100 bg-neutral-50 p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Account, as recorded when the request was made
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {row.payout.upi && (
              <PayoutField label="UPI" value={row.payout.upi} copied={copied === 'upi'} onCopy={() => copy(row.payout!.upi!, 'upi')} />
            )}
            {row.payout.account && (
              <PayoutField label="Account" value={row.payout.account} copied={copied === 'acct'} onCopy={() => copy(row.payout!.account!, 'acct')} />
            )}
            {row.payout.ifsc && (
              <PayoutField label="IFSC" value={row.payout.ifsc} copied={copied === 'ifsc'} onCopy={() => copy(row.payout!.ifsc!, 'ifsc')} />
            )}
            {row.payout.holder && (
              <div>
                <dt className="text-xs text-neutral-500">Holder</dt>
                <dd className="text-neutral-900">{row.payout.holder}</dd>
              </div>
            )}
            {row.payout.bank && (
              <div>
                <dt className="text-xs text-neutral-500">Bank</dt>
                <dd className="text-neutral-900">{row.payout.bank}</dd>
              </div>
            )}
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            This is the snapshot from when the request was made, not the member&apos;s current
            details — so it stays the answer if they change their account afterwards.
          </p>
        </div>
      )}

      <div className="p-4">
        {decided ? (
          <p className="text-sm text-neutral-700">
            {row.status === 'PAID' ? 'Paid' : 'Rejected'}
            {row.transferRef && ` · reference ${row.transferRef}`}
            {row.reviewedAt && ` · ${formatDate(row.reviewedAt, { time: true })}`}
            {row.note && <span className="mt-1 block text-xs text-neutral-500">{row.note}</span>}
          </p>
        ) : mode === 'idle' ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-neutral-800">
                Transfer reference
                {/* Required. It is the only link between this row and a line on
                    the bank statement, and a dispute six months later has
                    nothing to check without it. */}
                <input
                  value={transferRef}
                  onChange={(e) => setTransferRef(e.target.value)}
                  placeholder="UTR or NEFT reference"
                  className="mt-1.5 block w-56 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-neutral-900 focus:outline-none"
                />
              </label>

              <button
                type="button"
                onClick={markPaid}
                disabled={transferRef.trim().length < 6 || !!busy}
                className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
              >
                {busy === 'paid' ? 'Recording…' : 'Mark paid'}
              </button>

              <button
                type="button"
                onClick={() => setMode('rejecting')}
                disabled={!!busy}
                className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Reject
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Make the transfer first, then record its reference here.
            </p>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium text-neutral-800">
              Why is this being rejected?
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                placeholder="e.g. account name does not match the member's name"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
              />
              <span className="mt-1 block text-xs font-normal text-neutral-500">
                The member sees this, and the held amount goes back to their income wallet.
              </span>
            </label>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={reject}
                disabled={note.trim().length < 4 || !!busy}
                className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
              >
                {busy === 'reject' ? 'Rejecting…' : 'Confirm rejection'}
              </button>
              <button
                type="button"
                onClick={() => { setMode('idle'); setNote(''); }}
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

function PayoutField({
  label, value, copied, onCopy,
}: {
  label: string; value: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="flex items-center gap-2">
        <code className="font-mono text-sm text-neutral-900">{value}</code>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-100"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </dd>
    </div>
  );
}
