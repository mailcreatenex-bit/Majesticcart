'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { parseRupeeInput, showMoney, showVolume, type MoneyView, type VolumeView } from '@/lib/money';
import { MemberShell } from './MemberShell';

/**
 * Withdraw income to a bank account.
 *
 * The income wallet is the only one that can leave the platform. Three things
 * stand between a member and the money, and all three are shown before they
 * type an amount rather than after they submit:
 *
 *   1. **Payout details on file.** Payouts only go to an account in the
 *      member's own name.
 *   2. **The repurchase requirement**, if the plan has one. Rendered as a
 *      checklist showing how much is bought against the target, not as a bare
 *      error — a member who cannot withdraw should know what to do about it.
 *   3. **The deduction.** Shown as a live quote from the server, so the member
 *      sees what lands in their bank before they commit, not after.
 *
 * Every figure here comes from the server. The deduction percentage is part of
 * the plan, which the client can change, so computing it in the browser would
 * mean a number that silently goes stale the day they do.
 */

interface Quote {
  requested: MoneyView;
  deduction: MoneyView;
  net: MoneyView;
  deductionPercent: number;
  repurchase: { required: boolean; bought: VolumeView; target: VolumeView };
}

interface PayoutSummary {
  upi: string | null;
  bank: string | null;
  accountLast4: string | null;
}

export function WithdrawView() {
  return (
    <MemberShell title="Withdraw income">
      {(data, reload) => (
        <Withdraw incomeBalance={data.wallets.income} onDone={reload} />
      )}
    </MemberShell>
  );
}

function Withdraw({ incomeBalance, onDone }: { incomeBalance: MoneyView; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payout, setPayout] = useState<PayoutSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MoneyView | null>(null);

  const amountPaise = parseRupeeInput(amount);

  useEffect(() => {
    api<PayoutSummary>('/me/payout').then(setPayout).catch(() => setPayout(null));
  }, []);

  /**
   * Re-quote as the amount changes, debounced.
   *
   * Aborted on every keystroke, so a slow response for ₹50 cannot arrive after
   * a fast one for ₹500 and overwrite it — the classic out-of-order race that
   * shows the member a deduction for an amount they are no longer entering.
   */
  useEffect(() => {
    if (amountPaise <= 0) { setQuote(null); return; }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = await api<Quote>(
          `/wallet/withdrawal/quote?amount=${(amountPaise / 100).toFixed(2)}`,
          { signal: controller.signal },
        );
        setQuote(q);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setQuote(null);
      }
    }, 350);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [amountPaise]);

  const hasPayout = !!(payout && (payout.upi || payout.accountLast4));
  const overBalance = amountPaise > incomeBalance.paise;
  const repurchaseBlocked = !!quote?.repurchase.required;

  const canSubmit = amountPaise > 0 && !overBalance && hasPayout && !repurchaseBlocked && !!quote && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const w = await api<{ net: MoneyView }>('/wallet/withdrawal', {
        method: 'POST',
        body: { amount: (amountPaise / 100).toFixed(2) },
        // No client key: one PENDING withdrawal per member, checked in the transaction.
      });
      setDone(w.net);
      setAmount('');
      setQuote(null);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-[#9DC5B0] bg-[#E9F5EF] p-6">
        <h2 className="font-serif text-xl text-[#2C6B52]">Withdrawal requested</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#2C6B52]">
          {showMoney(done)} will be transferred to your account. The amount has been held from
          your income wallet already, so it cannot be spent twice while the transfer is processed.
        </p>
        <Link href="/wallet?kind=income" className="mt-4 inline-block text-sm font-semibold text-[#2C6B52] underline">
          See your statement →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="font-serif text-xl text-[var(--ink)]">How much?</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Available: <span className="font-semibold text-[var(--ink)]">{showMoney(incomeBalance)}</span>
        </p>

        <div className="mt-5 flex items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] pl-4">
          <span className="text-[var(--muted)]">₹</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
            className="w-full bg-transparent px-2 py-3 text-lg text-[var(--ink)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAmount((incomeBalance.paise / 100).toFixed(2))}
            className="mr-2 shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]"
          >
            All
          </button>
        </div>

        {overBalance && (
          <p className="mt-2 text-xs text-[#C0392B]">
            That is more than your income wallet holds.
          </p>
        )}

        {/* ------------------------------------------------ the deduction */}
        {quote && !overBalance && (
          <dl className="mt-5 space-y-2 rounded-xl bg-[var(--page)] p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">You requested</dt>
              <dd className="text-[var(--ink)]">{showMoney(quote.requested)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Deduction ({quote.deductionPercent}%)</dt>
              <dd className="text-[var(--ink)]">−{showMoney(quote.deduction)}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--line)] pt-2 font-semibold text-[var(--ink)]">
              {/* The number that matters is what lands in the bank, so it is
                  the one in bold. */}
              <dt>Reaches your account</dt>
              <dd>{showMoney(quote.net)}</dd>
            </div>
          </dl>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="mt-5 w-full rounded-xl gold-foil px-6 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#E8DDE3] disabled:text-[#A79AA1] disabled:shadow-none"
        >
          {submitting ? 'Submitting…' : 'Request withdrawal'}
        </button>

        <p className="mt-3 text-center text-xs leading-relaxed text-[var(--muted)]">
          Withdrawals are checked and paid by our team. The amount is held from your wallet as soon
          as you request it, so it cannot be spent twice while it is processed.
        </p>
      </section>

      {/* --------------------------------------------------- requirements */}
      <aside className="h-fit space-y-4">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Before you can withdraw</h2>

          <ul className="mt-3 space-y-3 text-sm">
            <Requirement met={hasPayout} label="Payout details on file">
              {hasPayout ? (
                <span className="text-[var(--muted)]">
                  {payout!.upi ?? `${payout!.bank ?? 'Bank'} •••• ${payout!.accountLast4}`}
                </span>
              ) : (
                <Link href="/account" className="font-semibold text-[var(--accent)] hover:underline">
                  Add them →
                </Link>
              )}
            </Requirement>

            {/* A checklist, not an error. A member who cannot withdraw should
                be able to see how far off they are and what closes the gap. */}
            {quote && (
              <Requirement met={!quote.repurchase.required} label="Repurchase for this period">
                <span className="text-[var(--muted)]">
                  {showVolume(quote.repurchase.bought)} of {showVolume(quote.repurchase.target)}
                </span>
                {quote.repurchase.required && (
                  <Link href="/shop" className="ml-2 font-semibold text-[var(--accent)] hover:underline">
                    Shop →
                  </Link>
                )}
              </Requirement>
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--page)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Good to know</h2>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--muted)]">
            <li>Payouts go only to an account in your own name.</li>
            <li>Your shopping wallet cannot be withdrawn — it buys products only.</li>
            <li>TDS is deducted where it applies, and shown on your statement.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Requirement({ met, label, children }: { met: boolean; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          met ? 'bg-[#E9F5EF] text-[#2C6B52]' : 'bg-[#FDF6E7] text-[#8A6D1F]'
        }`}
      >
        {met ? '✓' : '!'}
      </span>
      <span className="min-w-0">
        <span className="block text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-xs">{children}</span>
      </span>
    </li>
  );
}
