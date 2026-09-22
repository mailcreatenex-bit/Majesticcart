'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatRupees, formatDate, showMoney, parseRupeeInput, type MoneyView } from '@/lib/money';
import { MemberShell, StatusPill, EmptyState } from './MemberShell';

/**
 * Wallet recharge.
 *
 * This is the only way money enters the platform, and it is deliberately not
 * automatic: the member pays by UPI to the account on screen, submits the UTR
 * and a screenshot, and an admin verifies it against the bank statement before
 * a single paisa is credited.
 *
 * Everything on this screen follows from that being manual:
 *
 *   • **Nothing pretends to be instant.** The button says "Submit for
 *     approval", not "Add money". A member who expects an instant credit and
 *     does not get one assumes the money is gone, and in an MLM that becomes an
 *     accusation within the hour.
 *   • **The UTR is the key.** It is what the admin matches against the bank
 *     statement, and the backend enforces one approved credit per UTR. So the
 *     form explains where to find it rather than labelling it and hoping.
 *   • **Pending requests are shown first**, above the form. The commonest
 *     support question here is "where is my money" and the answer is usually
 *     "still pending" — which the member can see for themselves.
 */

interface PayInfo {
  upiId: string;
  payeeName: string;
  /** Server-rendered QR image. Never generated in the browser. */
  qrUrl: string;
  minPaise: number;
  maxPaise: number;
  note: string | null;
}

interface RechargeRequest {
  id: string;
  claimed: MoneyView;
  credited: MoneyView | null;
  utr: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  reviewedAt: string | null;
  at: string;
}

export function RechargeView() {
  const params = useSearchParams();
  // Pre-filled by checkout when the wallet was short. The member should not
  // have to work out the number they were just shown.
  const suggested = params.get('amount');
  const next = params.get('next');

  return (
    <MemberShell title="Add money to wallet">
      {(data, reload) => (
        <RechargeForm
          suggestedRupees={suggested}
          nextPath={next}
          shoppingBalance={data.wallets.shopping}
          onCredited={reload}
        />
      )}
    </MemberShell>
  );
}

function RechargeForm({
  suggestedRupees, nextPath, shoppingBalance, onCredited,
}: {
  suggestedRupees: string | null;
  nextPath: string | null;
  shoppingBalance: MoneyView;
  onCredited: () => void;
}) {
  const [pay, setPay] = useState<PayInfo | null>(null);
  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState(suggestedRupees ?? '');
  const [utr, setUtr] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, history] = await Promise.all([
          api<PayInfo>('/wallet/pay-info'),
          api<{ requests: RechargeRequest[] }>('/me/recharges?take=10'),
        ]);
        if (cancelled) return;
        setPay(info);
        setRequests(history.requests);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the payment details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pending = requests.filter((r) => r.status === 'PENDING');

  const amountPaise = useMemo(() => parseRupeeInput(amount), [amount]);

  const valid =
    amountPaise > 0 &&
    (!pay || (amountPaise >= pay.minPaise && amountPaise <= pay.maxPaise)) &&
    /^[A-Z0-9]{12,22}$/.test(utr.trim().toUpperCase()) &&
    !!screenshot;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      // The image goes straight to object storage on a one-time ticket. A 4 MB
      // screenshot through the API process is memory pressure for no benefit,
      // and members on patchy data would upload it twice.
      const ticket = await api<{ uploadUrl: string; objectKey: string }>(
        '/wallet/upload-ticket',
        {
          method: 'POST',
          body: { purpose: 'recharge-screenshot', contentType: screenshot!.type, contentLength: screenshot!.size },
        },
      );

      const put = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: screenshot,
        headers: { 'Content-Type': screenshot!.type },
      });
      if (!put.ok) throw new ApiError('The screenshot could not be uploaded. Try again.', put.status);

      await api('/wallet/recharge', {
        method: 'POST',
        body: { amount: (amountPaise / 100).toFixed(2), utr: utr.trim().toUpperCase(), screenshotKey: ticket.objectKey },
        // No client key: the UTR is the dedupe key: one bank payment, one credit.
      });

      const history = await api<{ requests: RechargeRequest[] }>('/me/recharges?take=10');
      setRequests(history.requests);
      setDone(true);
      setAmount('');
      setUtr('');
      setScreenshot(null);
      onCredited();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not submit the request. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />;
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ submitted state */}
      {done && (
        <div role="status" className="rounded-2xl border border-[#9DC5B0] bg-[#E9F5EF] p-5">
          <h2 className="font-serif text-lg text-[#2C6B52]">Submitted for approval</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[#2C6B52]">
            Our team will check the payment against the bank statement and credit your wallet.
            Most are done within a few working hours. You will get a notification either way.
          </p>
          {nextPath && (
            <p className="mt-3 text-sm text-[#2C6B52]">
              Your bag is still waiting.{' '}
              <Link href={nextPath} className="font-semibold underline">
                Back to checkout →
              </Link>
            </p>
          )}
        </div>
      )}

      {/* --------------------------------------------- pending, up front */}
      {pending.length > 0 && !done && (
        <div className="rounded-2xl border border-[var(--notice-border)] bg-[var(--notice-bg)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">
            {pending.length === 1 ? 'A request is being checked' : `${pending.length} requests are being checked`}
          </h2>
          <ul className="mt-3 space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--body)]">
                  {showMoney(r.claimed)} · UTR {r.utr}
                </span>
                <span className="text-xs text-[var(--muted)]">{formatDate(r.at, { time: true })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-[var(--body)]">
            Nothing has been deducted twice — a pending request is a payment we have not yet matched
            to the bank statement. You can still submit another for a different payment.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------ pay to */}
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="font-serif text-xl text-[var(--ink)]">1. Pay by UPI</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Scan this with any UPI app, or copy the ID below.
          </p>

          {pay ? (
            <>
              <div className="mx-auto mt-5 w-fit rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                {/* Rendered by the server, not generated here: a QR built in the
                    browser from a client-held string is a QR an extension or a
                    tampered bundle could repoint at another account. */}
                <Image src={pay.qrUrl} alt={`UPI QR code for ${pay.payeeName}`} width={220} height={220} unoptimized />
              </div>

              <div className="mt-4 rounded-xl bg-[var(--page)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">UPI ID</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <code className="text-sm font-semibold text-[var(--ink)]">{pay.upiId}</code>
                  <CopyButton value={pay.upiId} />
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">{pay.payeeName}</p>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
                Pay between {formatRupees(pay.minPaise)} and {formatRupees(pay.maxPaise)} in one
                transfer. {pay.note}
              </p>
            </>
          ) : (
            <p className="mt-5 text-sm text-[#C0392B]">
              Payment details are unavailable right now. Please try again shortly.
            </p>
          )}
        </section>

        {/* ------------------------------------------------------- claim */}
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="font-serif text-xl text-[var(--ink)]">2. Tell us about it</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            So we can match your payment to your account.
          </p>

          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-[var(--ink)]">
              Amount paid
              <div className="mt-1.5 flex items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] pl-4">
                <span className="text-[var(--muted)]">₹</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal"
                  placeholder="0"
                  aria-invalid={!!fieldErrors.amount}
                  className="w-full bg-transparent px-2 py-3 text-[var(--ink)] focus:outline-none"
                />
              </div>
            </label>
            {fieldErrors.amount && <p className="text-xs text-[#C0392B]">{fieldErrors.amount}</p>}
            {suggestedRupees && amount === suggestedRupees && (
              <p className="-mt-2 text-xs text-[var(--muted)]">
                Pre-filled with what your bag needs. You can add more.
              </p>
            )}

            <label className="block text-sm font-medium text-[var(--ink)]">
              UTR / reference number
              <input
                value={utr}
                onChange={(e) => setUtr(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 22))}
                placeholder="e.g. 412345678901"
                aria-invalid={!!fieldErrors.utr}
                className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
            {/* Where to find it, not just what it is called. Members look for
                "UTR" and see "Transaction ID" in their app. */}
            <p className="-mt-2 text-xs leading-relaxed text-[var(--muted)]">
              In your UPI app, open the payment and look for <em>UTR</em>, <em>UPI transaction ID</em> or{' '}
              <em>Reference number</em>. It is 12 digits or more. {fieldErrors.utr}
            </p>

            <label className="block text-sm font-medium text-[var(--ink)]">
              Payment screenshot
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--body)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[var(--gold-pale)]"
              />
            </label>
            {screenshot && (
              <p className="-mt-2 text-xs text-[var(--muted)]">
                {screenshot.name} · {(screenshot.size / 1024).toFixed(0)} KB
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!valid || submitting}
              className="w-full rounded-xl gold-foil px-6 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#E8DDE3] disabled:text-[#A79AA1] disabled:shadow-none"
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>

            {/* The button does not say "Add money" for a reason. It does not
                add money; it asks someone to. */}
            <p className="text-center text-xs leading-relaxed text-[var(--muted)]">
              Your wallet is credited after our team matches this payment to the bank statement.
              It is not instant.
            </p>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------- history */}
      <section>
        <h2 className="font-serif text-xl text-[var(--ink)]">Recent requests</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Shopping wallet balance: {showMoney(shoppingBalance)}
        </p>

        <div className="mt-4">
          {requests.length === 0 ? (
            <EmptyState
              title="No requests yet"
              body="Once you submit a payment it will appear here with its status."
            />
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">
                        {showMoney(r.claimed)}
                        {/* An admin may approve a different amount from the one
                            claimed — usually because the bank shows less. The
                            member must see which figure was actually credited. */}
                        {r.credited && r.credited.paise !== r.claimed.paise && (
                          <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                            credited {showMoney(r.credited)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--muted)]">UTR {r.utr}</p>
                    </div>
                    <div className="text-right">
                      <StatusPill status={r.status} />
                      <p className="mt-1 text-xs text-[var(--faint)]">{formatDate(r.at, { time: true })}</p>
                    </div>
                  </div>

                  {/* A rejection the member cannot explain becomes a support
                      call, and then an accusation. The reason travels with it. */}
                  {r.note && (
                    <p className="mt-3 rounded-xl bg-[var(--page)] px-3 py-2 text-xs leading-relaxed text-[var(--body)]">
                      {r.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
