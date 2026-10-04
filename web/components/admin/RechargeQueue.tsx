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
  /** False when the member paid and sent only the UTR. */
  hasScreenshot?: boolean;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

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
  const settle = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const reload = async () => {
    setSelected(new Set());
    try { await load(status, null); } catch { /* the list keeps what it had */ }
  };

  const approveBatch = async () => {
    if (selected.size === 0 || batchBusy) return;
    if (!window.confirm(`Approve ${selected.size} payment${selected.size === 1 ? '' : 's'} at the amount each member claimed? Only do this for ones you have matched to the bank statement.`)) return;
    setBatchBusy(true);
    setBatchNote(null);
    try {
      const r = await api<{ approved: string[]; skipped: { id: string; reason: string }[] }>('/admin/recharges/bulk-approve', { method: 'POST', body: { ids: [...selected] } });
      setBatchNote(`Approved ${r.approved.length}.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0].reason}` : ''}`);
      await reload();
    } catch (err) {
      setBatchNote(err instanceof ApiError ? err.message : 'Could not approve the batch.');
    } finally {
      setBatchBusy(false);
    }
  };

  const toggle = (id: string, on: boolean) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

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

      {status === 'PENDING' && <StatementPanel onApplied={reload} />}

      {error && <AdminError message={error} />}

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 shadow">
          <p className="text-sm text-neutral-800">{selected.size} selected</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700">Clear</button>
            <button type="button" onClick={approveBatch} disabled={batchBusy} className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white disabled:bg-neutral-300">
              {batchBusy ? 'Approving…' : 'Approve selected at claimed amounts'}
            </button>
          </div>
        </div>
      )}
      {batchNote && <p role="status" className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800">{batchNote}</p>}

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
            <RechargeCard key={r.id} row={r} onSettled={() => settle(r.id)} batch={r.status === 'PENDING' && r.flags.length === 0 ? { checked: selected.has(r.id), onChange: (v) => toggle(r.id, v) } : undefined} />
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

function RechargeCard({ row, onSettled, batch }: { row: RechargeRow; onSettled: () => void; batch?: { checked: boolean; onChange: (v: boolean) => void } }) {
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
      {batch && (
        <label className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-xs text-neutral-600">
          <input type="checkbox" checked={batch.checked} onChange={(e) => batch.onChange(e.target.checked)} className="h-4 w-4" />
          Select for batch approval
        </label>
      )}
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
          {row.hasScreenshot === false ? (
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              No screenshot attached. Match the UTR <span className="font-mono font-semibold">{row.utr}</span> against the bank statement.
            </p>
          ) : (
            <Screenshot rechargeId={row.id} />
          )}

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


/* ------------------------------------------------------ bank statement */

type Verdict = 'MATCHED' | 'AMOUNT_DIFFERS' | 'NOT_A_CREDIT' | 'NOT_FOUND' | 'SEEN_TWICE' | 'FLAGGED';
interface StatementItem { id: string; utr: string; verdict: Verdict; member: { name: string; memberCode: string } | null; claimed: MoneyView; bank: MoneyView | null }
interface StatementReview {
  understood: boolean; rowsRead: number; applied: boolean;
  counts: Record<Verdict, number>; approvedIds: string[]; failed: { id: string; reason: string }[]; items: StatementItem[];
}

const VERDICT_COPY: Record<Verdict, string> = {
  MATCHED: 'Matched: same UTR and amount',
  AMOUNT_DIFFERS: 'The bank shows a different amount',
  NOT_A_CREDIT: 'The UTR is there but not as money received',
  NOT_FOUND: 'Not in this statement',
  SEEN_TWICE: 'The UTR appears more than once',
  FLAGGED: 'Carries a security flag, review it yourself',
};

/**
 * Upload the bank's statement (CSV); every pending request whose UTR and exact amount appear as
 * money received is offered for approval in one click. Everything else stays in the list for a
 * person, with the reason. The server re-checks at the moment of approval, so what is approved is
 * decided there, not by this page.
 */
function StatementPanel({ onApplied }: { onApplied: () => Promise<void> }) {
  const [review, setReview] = useState<StatementReview | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (text: string, apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<StatementReview>('/admin/recharges/statement', { method: 'POST', body: { csv: text, apply } });
      if (apply) {
        setDone(`Approved ${r.approvedIds.length} payment${r.approvedIds.length === 1 ? '' : 's'}.${r.failed.length ? ` ${r.failed.length} could not be approved: ${r.failed[0].reason}` : ''}`);
        setReview(null);
        setCsv(null);
        await onApplied();
      } else {
        setReview(r);
        setDone(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that statement.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setReview(null);
    setDone(null);
    if (file.size > 3_500_000) { setError('That file is too large. Download one month at a time.'); return; }
    const text = await file.text();
    setCsv(text);
    await run(text, false);
  };

  const matched = review?.counts.MATCHED ?? 0;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Match a bank statement</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Download your bank statement as a CSV (one month is enough) and upload it. Payments whose UTR and amount are in the
        statement as money received are offered for approval in one click; everything else stays here for you.
      </p>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="mt-3 block w-full max-w-md text-sm text-neutral-700 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
      />
      {busy && <p className="mt-3 text-sm text-neutral-500">Reading {fileName}…</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}

      {review && !review.understood && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          That does not look like a bank statement CSV: no column for money received was found. Nothing was matched. Try downloading it as CSV or Excel-to-CSV from your bank.
        </p>
      )}

      {review?.understood && (
        <div className="mt-4">
          <p className="text-sm text-neutral-800">
            Read {review.rowsRead.toLocaleString('en-IN')} rows. <strong>{matched}</strong> of {review.items.length} pending payments match.
          </p>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {review.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className={i.verdict === 'MATCHED' ? 'text-green-700' : 'text-neutral-800'}>{i.member?.name ?? 'Member'}</span>
                  <span className="ml-2 font-mono text-xs text-neutral-500">{i.utr}</span>
                </span>
                <span className="text-right text-xs">
                  <span className="tabular-nums text-neutral-700">{showMoney(i.claimed)}</span>
                  {i.bank && i.verdict === 'AMOUNT_DIFFERS' && <span className="ml-2 tabular-nums text-red-700">bank: {showMoney(i.bank)}</span>}
                  <span className={`ml-2 ${i.verdict === 'MATCHED' ? 'font-semibold text-green-700' : 'text-neutral-500'}`}>{VERDICT_COPY[i.verdict]}</span>
                </span>
              </li>
            ))}
          </ul>
          {matched > 0 && csv && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { if (window.confirm(`Approve the ${matched} matched payment${matched === 1 ? '' : 's'}? Each is credited at the amount shown.`)) void run(csv, true); }}
              className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
            >
              Approve the {matched} matched
            </button>
          )}
        </div>
      )}
    </section>
  );
}
