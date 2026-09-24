'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { MemberShell } from './MemberShell';

/**
 * A monthly income statement, on screen and as a PDF.
 *
 * Every figure comes from the API's ledger-backed statement; the PDF is drawn in
 * the browser from that same object (jsPDF, loaded only when someone presses the
 * button), so there is no second calculation that could disagree with the screen.
 *
 * The "deduction withheld" is what the company keeps back from each withdrawal
 * and accounts for as tax deducted at source. It is shown as its own line, per
 * withdrawal and in total, because that is the figure a member needs for their
 * own tax return.
 */

interface Money { paise: string; amount: string; display: string }
interface Statement {
  period: string;
  generatedAt: string;
  member: { code: string; name: string; location: string | null };
  income: { category: string; label: string; count: number; amount: Money }[];
  totalIncome: Money;
  credits: { at: string; label: string; amount: Money; note: string | null }[];
  creditsTruncated: boolean;
  withdrawals: { at: string; status: string; requested: Money; deduction: Money; deductionPct: number; net: Money; transferRef: string | null }[];
  withdrawalTotals: { requested: Money; deduction: Money; net: Money };
  openingBalance: Money;
  closingBalance: Money;
}

const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

/** The last twelve months, newest first. */
function recentPeriods(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const STATUS_TEXT: Record<string, string> = { PENDING: 'Pending', PAID: 'Paid', REJECTED: 'Rejected (returned to wallet)' };

export function StatementView() {
  return (
    <MemberShell title="Income statement">
      {() => <Statement />}
    </MemberShell>
  );
}

function Statement() {
  const periods = useMemo(recentPeriods, []);
  const [period, setPeriod] = useState(periods[0]);
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<Statement>(`/me/income-statement?period=${period}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load the statement.'); });
    return () => { cancelled = true; };
  }, [period]);

  const download = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const { buildStatementPdf } = await import('@/lib/statement-pdf');
      const blob = buildStatementPdf(data, monthLabel(data.period));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MajesticCart-Income-Statement-${data.member.code}-${data.period}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch {
      setError('The PDF could not be created. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="stmt-period" className="text-xs uppercase tracking-wider text-[var(--faint)]">Month</label>
          <select
            id="stmt-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="mt-1 block rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
          >
            {periods.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={download}
          disabled={!data || saving}
          className="rounded-xl gold-foil px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50"
        >
          {saving ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>}
      {!data && !error && <div className="h-48 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />}

      {data && (
        <>
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg text-[var(--ink)]">Income earned in {monthLabel(data.period)}</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {data.income.map((r) => (
                  <tr key={r.category} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 text-[var(--body)]">{r.label}</td>
                    <td className="py-2 text-xs text-[var(--faint)]">{r.count > 0 ? `${r.count} credit${r.count === 1 ? '' : 's'}` : ''}</td>
                    <td className="py-2 text-right text-[var(--ink)]">{r.amount.display}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-3 font-semibold text-[var(--ink)]" colSpan={2}>Total income</td>
                  <td className="pt-3 text-right font-serif text-xl text-[var(--ink)]">{data.totalIncome.display}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg text-[var(--ink)]">Withdrawals and deduction (TDS)</h2>
            {data.withdrawals.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No withdrawals were requested this month.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--faint)]">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Requested</th>
                      <th className="pb-2 font-medium">Deduction</th>
                      <th className="pb-2 font-medium">Paid to you</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.withdrawals.map((w, i) => (
                      <tr key={i} className="border-t border-[var(--line)]">
                        <td className="py-2 text-[var(--body)]">{formatDate(w.at)}</td>
                        <td className="py-2 text-[var(--ink)]">{w.requested.display}</td>
                        <td className="py-2 text-[var(--ink)]">{w.deduction.display} <span className="text-xs text-[var(--faint)]">({w.deductionPct}%)</span></td>
                        <td className="py-2 text-[var(--ink)]">{w.net.display}</td>
                        <td className="py-2 text-xs text-[var(--muted)]">{STATUS_TEXT[w.status] ?? w.status}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--line-strong)] font-semibold">
                      <td className="pt-3 text-[var(--ink)]">Total</td>
                      <td className="pt-3 text-[var(--ink)]">{data.withdrawalTotals.requested.display}</td>
                      <td className="pt-3 text-[var(--ink)]">{data.withdrawalTotals.deduction.display}</td>
                      <td className="pt-3 text-[var(--ink)]">{data.withdrawalTotals.net.display}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--faint)]">
              Rejected withdrawals are returned to your wallet and are not counted in the totals.
            </p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Income wallet, start of month</p>
              <p className="mt-1 font-serif text-2xl text-[var(--ink)]">{data.openingBalance.display}</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Income wallet, end of month</p>
              <p className="mt-1 font-serif text-2xl text-[var(--ink)]">{data.closingBalance.display}</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
