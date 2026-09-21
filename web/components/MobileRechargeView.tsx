'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { parseRupeeInput, showMoney, formatDate, type MoneyView } from '@/lib/money';
import { MemberShell } from './MemberShell';

/**
 * Spend the shopping wallet on a mobile top-up instead of a product.
 *
 * Mirrors WithdrawView.tsx on purpose — same "quote, submit, held
 * immediately" shape — but this debits SHOPPING, not INCOME, and there is no
 * deduction: a recharge is a purchase at face value, not a payout.
 */

type Operator = 'JIO' | 'AIRTEL' | 'VI' | 'BSNL' | 'OTHER';
const OPERATORS: { value: Operator; label: string }[] = [
  { value: 'JIO', label: 'Jio' },
  { value: 'AIRTEL', label: 'Airtel' },
  { value: 'VI', label: 'Vi' },
  { value: 'BSNL', label: 'BSNL' },
  { value: 'OTHER', label: 'Other' },
];
const QUICK_AMOUNTS = [49, 99, 199, 299, 499, 999];
const MAX_PAISE = 500000; // ₹5,000 — mirrors MobileRechargeService's ceiling

interface RechargeRow {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  mobileNumber: string;
  operator: Operator;
  amount: MoneyView;
  failureReason: string | null;
  createdAt: string;
}

interface PlanOption {
  amount: MoneyView;
  validity: string;
  data: string;
}

export function MobileRechargeView() {
  return (
    <MemberShell title="Mobile recharge">
      {(data, reload) => <Recharge shoppingBalance={data.wallets.shopping} onDone={reload} />}
    </MemberShell>
  );
}

function Recharge({ shoppingBalance, onDone }: { shoppingBalance: MoneyView; onDone: () => void }) {
  const [mobileNumber, setMobileNumber] = useState('');
  const [operator, setOperator] = useState<Operator>('JIO');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: MoneyView; mobileNumber: string } | null>(null);
  const [history, setHistory] = useState<RechargeRow[] | null>(null);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);

  // Live plan browsing, read straight off each operator's own public plans
  // page (there is no recharge-aggregator account behind this — see
  // RechargePlansService). Best-effort: an empty or failed fetch just leaves
  // the amount field as the only way to pick a value, rather than an error.
  useEffect(() => {
    if (operator === 'OTHER') { setPlans(null); return; }
    let cancelled = false;
    setPlansLoading(true);
    setPlans(null);
    api<{ plans: PlanOption[] }>(`/wallet/mobile-recharge/plans?operator=${operator}`)
      .then((r) => { if (!cancelled) setPlans(r.plans); })
      .catch(() => { if (!cancelled) setPlans([]); })
      .finally(() => { if (!cancelled) setPlansLoading(false); });
    return () => { cancelled = true; };
  }, [operator]);

  const loadHistory = () => {
    api<RechargeRow[]>('/wallet/mobile-recharge').then(setHistory).catch(() => setHistory([]));
  };
  useEffect(loadHistory, []);

  // Fulfilment is a person on our side, not an instant API callback, so the
  // member's own screen is the only thing that will ever tell them it moved —
  // polling while something is still PENDING is what keeps that true without
  // a manual refresh. `onDone` (not just `loadHistory`) on every tick so the
  // shopping wallet balance shown above also catches a completion or refund.
  useEffect(() => {
    if (!history?.some((r) => r.status === 'PENDING')) return;
    const id = setInterval(() => { loadHistory(); onDone(); }, 15000);
    return () => clearInterval(id);
  }, [history, onDone]);

  const amountPaise = parseRupeeInput(amount);
  const validNumber = /^[6-9]\d{9}$/.test(mobileNumber.trim());
  const overBalance = amountPaise > shoppingBalance.paise;
  const overCeiling = amountPaise > MAX_PAISE;
  const alreadyPending = history?.some((r) => r.status === 'PENDING') ?? false;

  const canSubmit = validNumber && amountPaise > 0 && !overBalance && !overCeiling && !alreadyPending && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<{ amount: MoneyView; mobileNumber: string }>('/wallet/mobile-recharge', {
        method: 'POST',
        body: { mobileNumber: mobileNumber.trim(), operator, amount: (amountPaise / 100).toFixed(2) },
      });
      setDone({ amount: r.amount, mobileNumber: r.mobileNumber });
      setMobileNumber('');
      setAmount('');
      loadHistory();
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
        <h2 className="font-serif text-xl text-[#2C6B52]">Recharge requested</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#2C6B52]">
          {showMoney(done.amount)} has been held from your shopping wallet to recharge {done.mobileNumber}.
          It usually completes within a few hours — you&apos;ll get a notification either way.
        </p>
        <button type="button" onClick={() => setDone(null)} className="mt-4 text-sm font-semibold text-[#2C6B52] underline">
          Request another →
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="font-serif text-xl text-[var(--ink)]">Recharge a mobile number</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Shopping wallet available: <span className="font-semibold text-[var(--ink)]">{showMoney(shoppingBalance)}</span>
        </p>

        <label className="mt-5 block text-xs font-semibold text-[var(--body)]" htmlFor="mobile">Mobile number</label>
        <input
          id="mobile"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          placeholder="98765 00002"
          className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-lg text-[var(--ink)] focus:outline-none"
        />

        <label className="mt-4 block text-xs font-semibold text-[var(--body)]">Operator</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {OPERATORS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOperator(o.value)}
              className={`rounded-lg border px-3.5 py-2 text-sm font-medium ${
                operator === o.value ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {operator !== 'OTHER' && (
          <div className="mt-4">
            <label className="block text-xs font-semibold text-[var(--body)]">
              {OPERATORS.find((o) => o.value === operator)?.label} plans
            </label>
            {plansLoading && (
              <p className="mt-1.5 text-xs text-[var(--muted)]">Checking current plans…</p>
            )}
            {!plansLoading && plans && plans.length === 0 && (
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                Couldn&apos;t load current plans right now — enter an amount below instead.
              </p>
            )}
            {!plansLoading && plans && plans.length > 0 && (
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {plans.map((p) => {
                  const selected = amount === p.amount.amount;
                  return (
                    <button
                      key={p.amount.paise}
                      type="button"
                      onClick={() => setAmount(p.amount.amount)}
                      className={`rounded-xl border p-3 text-left ${
                        selected ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line-strong)] hover:bg-[var(--surface-tint)]'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-serif text-lg text-[var(--ink)]">{p.amount.display}</span>
                        <span className="text-xs text-[var(--muted)]">{p.validity}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{p.data}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label className="mt-4 block text-xs font-semibold text-[var(--body)]" htmlFor="amount">
          {operator !== 'OTHER' && plans && plans.length > 0 ? 'Or enter a custom amount' : 'Amount'}
        </label>
        <div className="mt-1.5 flex items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] pl-4">
          <span className="text-[var(--muted)]">₹</span>
          <input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
            className="w-full bg-transparent px-2 py-3 text-lg text-[var(--ink)] focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]"
            >
              ₹{v}
            </button>
          ))}
        </div>

        {overBalance && <p className="mt-2 text-xs text-[#C0392B]">That is more than your shopping wallet holds.</p>}
        {overCeiling && <p className="mt-2 text-xs text-[#C0392B]">Recharges are capped at ₹5,000 at a time.</p>}
        {alreadyPending && (
          <p className="mt-2 text-xs text-[#C0392B]">You already have a recharge in progress — wait for it to complete first.</p>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="mt-5 w-full rounded-xl gold-foil px-6 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#E8DDE3] disabled:text-[#A79AA1] disabled:shadow-none"
        >
          {submitting ? 'Submitting…' : 'Recharge from wallet'}
        </button>

        <p className="mt-3 text-center text-xs leading-relaxed text-[var(--muted)]">
          The amount is held from your shopping wallet the moment you submit. If we can&apos;t complete the
          recharge, it goes straight back to your wallet.
        </p>
      </section>

      <aside className="h-fit space-y-4">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--page)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Good to know</h2>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--muted)]">
            <li>This spends your shopping wallet — the same balance an order would spend.</li>
            <li>₹10 minimum, ₹5,000 maximum per recharge, one in progress at a time.</li>
            <li>Recharges are fulfilled by our team, usually within a few hours.</li>
          </ul>
        </div>

        {history && history.length > 0 && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Recent recharges</h2>
            <ul className="mt-3 space-y-3">
              {history.slice(0, 5).map((r) => (
                <li key={r.id} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--ink)]">{r.mobileNumber}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-0.5 text-[var(--muted)]">{showMoney(r.amount)} · {formatDate(r.createdAt)}</div>
                  {r.status === 'FAILED' && r.failureReason && (
                    <div className="mt-0.5 text-[#C0392B]">{r.failureReason}</div>
                  )}
                </li>
              ))}
            </ul>
            <Link href="/wallet" className="mt-4 inline-block text-xs font-semibold text-[var(--accent)] hover:underline">
              See full wallet statement →
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

function StatusPill({ status }: { status: RechargeRow['status'] }) {
  const styles: Record<RechargeRow['status'], string> = {
    PENDING: 'bg-[#FDF6E7] text-[#8A6D1F]',
    COMPLETED: 'bg-[#E9F5EF] text-[#2C6B52]',
    FAILED: 'bg-[#FDECEA] text-[#C0392B]',
  };
  const labels: Record<RechargeRow['status'], string> = { PENDING: 'In progress', COMPLETED: 'Completed', FAILED: 'Failed' };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[status]}`}>{labels[status]}</span>;
}
