'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatRupees, formatDate, parseRupeeInput, showMoney, type MoneyView } from '@/lib/money';
import { AdminShell, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * The recharge review queue.
 *
 * This screen is the bottleneck of the entire business. Nobody can buy anything
 * until someone here has matched a UPI payment to a bank statement and clicked
 * approve. A member sitting in this queue has already paid real money and is
 * waiting, and every minute in the queue is a minute they spend wondering where
 * it went.
 *
 * Three decisions follow from that:
 *
 *   • **The amount is typed, not confirmed.** The field starts empty and the
 *     approve button stays dead until it is filled. The member's claim is shown
 *     next to it for comparison, never pre-filled into it — a pre-filled field
 *     is a field that gets accepted without being read, and the whole point of
 *     this screen is that a human compared two numbers.
 *   • **Flags are shown before the buttons**, in the reading order of the card,
 *     with what each one means spelled out. "DUPLICATE_UTR" tells an operator
 *     nothing; "this UTR has been submitted before" tells them what to check.
 *   • **Rejection requires a reason**, and that reason reaches the member. A
 *     rejection someone cannot explain becomes a support call, and then an
 *     accusation that the company has taken their money.
 *
 * The screenshot is fetched on demand as a short-lived signed URL rather than
 * embedded in the list. It shows a member's bank app, their name and their
 * transaction history, and 50 of those preloaded into one page is 50 people's
 * banking on screen at once.
 */

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

interface RechargeRow {
  id: string;
  status: Status;
  utr: string;
  flags: string[];
  claimed: MoneyView;
  credited: MoneyView | null;
  member: { memberCode: string; name: string; phone: string; rankIndex: number };
  createdAt: string;
  reviewedAt: string | null;
  note: string | null;
}

/** What a flag actually means, and what to do about it. */
const FLAG_COPY: Record<string, { label: string; detail: string; severe: boolean }> = {
  DUPLICATE_UTR: {
    label: 'UTR seen before',
    detail: 'This reference has already been submitted, by this member or another. Check the bank statement for one payment, not two.',
    severe: true,
  },
  REUSED_SCREENSHOT: {
    label: 'Screenshot reused',
    detail: 'Byte-identical to an image submitted before, usually from a different account. Two people claiming one payment.',
    severe: true,
  },
  LARGE_AMOUNT: {
    label: 'Large amount',
    detail: 'Above the review threshold in settings. Worth a second look at the statement rather than the screenshot.',
    severe: false,
  },
  VELOCITY: {
    label: 'Many requests today',
    detail: 'More requests in 24 hours than the settings allow. Not wrong by itself, but unusual.',
    severe: false,
  },
  SHARED_DEVICE: {
    label: 'Shared device',
    detail: 'This device is linked to more accounts than the settings allow. Often a family; sometimes one person running several accounts.',
    severe: false,
  },
};

export function RechargeQueueView() {
  return (
    <AdminShell
      title="Recharges"
      subtitle="Match each payment to the bank statement before crediting it."
      permission="finance.recharges"
    >
      <Queue />
    </AdminShell>
  );
}

function Queue() {
  const [status, setStatus] = useState<Status | 'ALL'>('PENDING');
  const [rows, setRows] = useState<RechargeRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: Status | 'ALL', after: string | null) => {
    const qs = new URLSearchParams({ status: s });
    if (after) qs.set('cursor', after);
    const page = await api<{ items: RechargeRow[]; nextCursor: string | null }>(`/admin/recharges?${qs}`);
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
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the queue.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, load]);

  /**
   * Remove a decided row rather than reloading the list.
   *
   * Reloading would reorder everything underneath the operator's cursor mid-
   * review, which on a long queue means losing your place after every decision.
   */
  const settle = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((s) => (
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

      {error && <AdminError message={error} />}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <AdminEmpty>
          {status === 'PENDING'
            ? 'Nothing waiting. Every payment submitted has been dealt with.'
            : `No ${status.toLowerCase()} requests.`}
        </AdminEmpty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <RechargeCard key={r.id} row={r} onSettled={() => settle(r.id)} />
          ))}
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

/* ----------------------------------------------------------------- card */

function RechargeCard({ row, onSettled }: { row: RechargeRow; onSettled: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  const amountPaise = parseRupeeInput(amount);
  const decided = row.status !== 'PENDING';
  const flags = row.flags.map((f) => FLAG_COPY[f] ?? { label: f, detail: '', severe: true });
  const severe = flags.some((f) => f.severe);

  /** True when the operator typed something other than what the member claimed. */
  const differs = amountPaise > 0 && amountPaise !== row.claimed.paise;

  const approve = async () => {
    if (amountPaise <= 0 || busy) return;
    setBusy('approve');
    setError(null);
    try {
      await api(`/admin/recharges/${row.id}/approve`, {
        method: 'POST',
        body: { amount: (amountPaise / 100).toFixed(2), ...(note ? { note } : {}) },
        // No client key: the row is locked and its status checked, so a second press is a 409.
      });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve this request.');
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!note.trim() || busy) return;
    setBusy('reject');
    setError(null);
    try {
      await api(`/admin/recharges/${row.id}/reject`, {
        method: 'POST',
        body: { note: note.trim() },
        // No client key: the row is locked and its status checked, so a second press is a 409.
      });
      onSettled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject this request.');
      setBusy(null);
    }
  };

  return (
    <li className={`rounded-xl border bg-white ${severe && !decided ? 'border-red-300' : 'border-neutral-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-100 p-4">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900">
            {row.member.name}
            <span className="ml-2 font-mono text-xs font-normal text-neutral-500">{row.member.memberCode}</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {row.member.phone} · submitted {formatDate(row.createdAt, { time: true })}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-neutral-500">Member claims</p>
          <p className="text-xl font-semibold tabular-nums text-neutral-900">{showMoney(row.claimed)}</p>
          <p className="mt-0.5 font-mono text-xs text-neutral-500">UTR {row.utr}</p>
        </div>
      </div>

      {/* ----------------------------------------------------- the flags */}
      {flags.length > 0 && (
        <div className={`border-b border-neutral-100 px-4 py-3 ${severe ? 'bg-red-50' : 'bg-amber-50'}`}>
          <ul className="space-y-1.5">
            {flags.map((f) => (
              <li key={f.label} className="text-xs leading-relaxed">
                <span className={`font-semibold ${f.severe ? 'text-red-800' : 'text-amber-900'}`}>{f.label}.</span>{' '}
                <span className={f.severe ? 'text-red-700' : 'text-amber-800'}>{f.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------ already decided */}
      {decided ? (
        <div className="px-4 py-3 text-sm">
          <p className="text-neutral-700">
            {row.status === 'APPROVED' ? 'Credited' : 'Rejected'}
            {row.credited && ` ${showMoney(row.credited)}`}
            {row.reviewedAt && ` on ${formatDate(row.reviewedAt, { time: true })}`}
          </p>
          {row.note && <p className="mt-1 text-xs text-neutral-500">{row.note}</p>}
        </div>
      ) : (
        <div className="p-4">
          <Screenshot rechargeId={row.id} />

          {mode === 'idle' ? (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-sm font-medium text-neutral-800">
                  Amount on the bank statement
                  <div className="mt-1.5 flex items-center rounded-lg border border-neutral-300 bg-white pl-3">
                    <span className="text-neutral-500">₹</span>
                    {/* Deliberately not pre-filled with the claim. A pre-filled
                        field is one that gets accepted without being read, and
                        this screen exists so that a person compared two
                        numbers. */}
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-32 bg-transparent px-2 py-2 tabular-nums text-neutral-900 focus:outline-none"
                    />
                  </div>
                </label>

                <button
                  type="button"
                  onClick={approve}
                  disabled={amountPaise <= 0 || !!busy}
                  className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
                >
                  {busy === 'approve' ? 'Crediting…' : `Credit ${amountPaise > 0 ? formatRupees(amountPaise) : '—'}`}
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

              {differs && (
                <p className="mt-2 text-xs text-amber-800">
                  That is {amountPaise > row.claimed.paise ? 'more' : 'less'} than the member claimed
                  ({showMoney(row.claimed)}). They will see the amount you credit, not the amount
                  they asked for — add a note so they know why.
                </p>
              )}

              <label className="mt-3 block text-xs font-medium text-neutral-600">
                Note for the member (optional on approval)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. bank shows ₹500, not ₹5,000"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
              </label>
            </>
          ) : (
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-800">
                Why is this being rejected?
                {/* Required, and it reaches the member. A rejection nobody can
                    explain becomes an accusation that the money was taken. */}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  autoFocus
                  placeholder="e.g. no payment with this UTR in the statement"
                  className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
                <span className="mt-1 block text-xs font-normal text-neutral-500">
                  The member sees this. Nothing is deducted — a rejected request never credited.
                </span>
              </label>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={reject}
                  disabled={!note.trim() || !!busy}
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
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* ----------------------------------------------------------- screenshot */

/**
 * The payment screenshot, fetched on demand.
 *
 * Not embedded in the list: the URL is signed and short-lived, and 50 of them
 * preloaded means 50 members' bank apps, names and transaction histories on one
 * screen at once. The operator asks for the one they are looking at.
 */
function Screenshot({ rechargeId }: { rechargeId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    if (busy || url) return;
    setBusy(true);
    try {
      const r = await api<{ url: string; expiresInSeconds: number }>(`/admin/recharges/${rechargeId}/screenshot`);
      setUrl(r.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the screenshot.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-xs text-red-700">{error}</p>;

  if (!url) {
    return (
      <button
        type="button"
        onClick={show}
        disabled={busy}
        className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400"
      >
        {busy ? 'Loading…' : 'View payment screenshot'}
      </button>
    );
  }

  return (
    <figure>
      {/* A plain <img>, not next/image: the URL is signed and expires in ten
          minutes, so routing it through the image optimiser would cache a
          rendition that outlives the signature and then 404s. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Payment screenshot submitted by the member"
        className="max-h-96 rounded-lg border border-neutral-200"
      />
      <figcaption className="mt-1 text-xs text-neutral-500">
        This link expires in ten minutes. Reload the page to get another.
      </figcaption>
    </figure>
  );
}
