'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { showMoney, showVolume, type MoneyView, type VolumeView } from '@/lib/money';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton, useAdmin } from './AdminShell';

/**
 * The admin dashboard.
 *
 * Ordered by what needs a decision, not by what is impressive. The queues come
 * first, because a pending recharge is a member who has paid and is waiting;
 * the revenue figures come second, because nobody acts on them at 9am.
 *
 * The payout ratio is the number that matters most and it is the easiest to
 * skip past, so it gets its own treatment: commission as a share of revenue is
 * what decides whether the plan is solvent, and a plan paying out more than it
 * takes in is a plan that fails suddenly rather than gradually.
 */

interface Summary {
  revenue: MoneyView;
  commissionPaid: MoneyView;
  payoutRatioBp: number;
  businessVolume: VolumeView;
  walletFloat: MoneyView;
  orderCount: number;
  memberCount: number;
  activeMemberCount: number;
  pendingRecharges: number;
  pendingWithdrawals: number;
  openAlerts: number;
  ordersToShip: number;
  lowStockCount: number;
}

interface DriftRow {
  walletId: string;
  memberCode: string;
  kind: string;
  stored: MoneyView;
  derived: MoneyView;
  drift: MoneyView;
}

interface Breakdown { type: string; total: MoneyView; count: number }
interface Earner { id: string; memberCode: string; name: string; rankIndex: number; earned: MoneyView }

export function AdminDashboardView() {
  return (
    <AdminShell title="Dashboard" subtitle="What needs a decision, and how the plan is holding up.">
      <Dashboard />
    </AdminShell>
  );
}

function Dashboard() {
  const admin = useAdmin();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drift, setDrift] = useState<DriftRow[] | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown[]>([]);
  const [earners, setEarners] = useState<Earner[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canSeeFinance = admin.role === 'ADMIN' || admin.role === 'FINANCE';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, b, e] = await Promise.all([
          api<Summary>('/admin/dashboard'),
          api<Breakdown[]>('/admin/dashboard/commission-breakdown').catch(() => []),
          api<Earner[]>('/admin/dashboard/top-earners?limit=5').catch(() => []),
        ]);
        if (cancelled) return;
        setSummary(s);
        setBreakdown(b);
        setEarners(e);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
      }

      // Separate, and only for the roles that may see it: a SUPPORT user gets a
      // 403 here and that must not take the whole dashboard down with it.
      if (canSeeFinance) {
        try {
          const d = await api<DriftRow[]>('/admin/dashboard/ledger-drift');
          if (!cancelled) setDrift(d);
        } catch {
          if (!cancelled) setDrift(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [canSeeFinance]);

  if (error) return <AdminError message={error} />;
  if (!summary) return <TableSkeleton rows={4} />;

  const payoutPercent = (summary.payoutRatioBp / 100).toFixed(1);
  // 60% of BV is where assertSustainable() in the plan refuses to publish. The
  // dashboard flags the same threshold so it is visible before it is hit,
  // rather than only at the moment someone tries to save a change.
  const payoutHigh = summary.payoutRatioBp >= 6000;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ drift, if any */}
      {drift && drift.length > 0 && (
        <Panel
          title={`Ledger drift — ${drift.length} wallet${drift.length === 1 ? '' : 's'}`}
          tone="alert"
        >
          {/* This list should always be empty. Anything in it means something
              wrote to Wallet outside LedgerService, which is an incident and
              not a report — so it sits at the top of the page in red rather
              than on a reconciliation screen someone visits monthly. */}
          <p className="text-sm text-red-700">
            A wallet balance does not match the sum of its ledger entries. Something has written to
            Wallet outside LedgerService. Stop approvals and payouts until this is explained.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="pb-2">Member</th><th className="pb-2">Wallet</th>
                  <th className="pb-2 text-right">Stored</th>
                  <th className="pb-2 text-right">Ledger</th>
                  <th className="pb-2 text-right">Drift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {drift.map((d) => (
                  <tr key={d.walletId}>
                    <td className="py-2 font-mono text-xs">{d.memberCode}</td>
                    <td className="py-2">{d.kind}</td>
                    <td className="py-2 text-right">{showMoney(d.stored)}</td>
                    <td className="py-2 text-right">{showMoney(d.derived)}</td>
                    <td className="py-2 text-right font-semibold text-red-700">{showMoney(d.drift)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ------------------------------------------------------- queues */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Queue
          label="Recharges to check"
          count={summary.pendingRecharges}
          href="/admin/recharges"
          hint="Members who have paid and are waiting"
          urgent={summary.pendingRecharges > 0}
          visible={canSeeFinance}
        />
        <Queue
          label="Orders to ship"
          count={summary.ordersToShip}
          href="/admin/orders"
          hint="Placed or packed, not yet dispatched"
          visible={admin.role === 'ADMIN' || admin.role === 'SUPPORT'}
        />
        <Queue
          label="Withdrawals to pay"
          count={summary.pendingWithdrawals}
          href="/admin/withdrawals"
          hint="Held from income wallets already"
          visible={canSeeFinance}
        />
        <Queue
          label="Security alerts"
          count={summary.openAlerts}
          href="/admin/security-alerts"
          hint="Unresolved"
          urgent={summary.openAlerts > 0}
          visible
        />
      </div>

      {/* --------------------------------------------------- solvency */}
      {canSeeFinance && (
        <Panel title="Is the plan paying out more than it takes in?">
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">Commission / revenue</p>
              <p className={`mt-1 text-4xl font-semibold tabular-nums ${payoutHigh ? 'text-red-700' : 'text-neutral-900'}`}>
                {payoutPercent}%
              </p>
            </div>
            <dl className="grid flex-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Revenue" value={showMoney(summary.revenue)} />
              <Row label="Commission paid" value={showMoney(summary.commissionPaid)} />
              <Row label="Business volume" value={showVolume(summary.businessVolume)} />
              {/* The float is money members have paid in and not yet spent. It
                  is a liability, not income — worth showing next to revenue so
                  the two are never confused. */}
              <Row label="Wallet float (owed)" value={showMoney(summary.walletFloat)} />
            </dl>
          </div>

          {payoutHigh && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              Payouts are at or above the 60% ceiling the plan validator enforces. Publishing a more
              generous plan will be refused, and the current one is already close to the limit of
              what the margin supports.
            </p>
          )}
        </Panel>
      )}

      {/* -------------------------------------------------- membership */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Members" value={summary.memberCount.toLocaleString('en-IN')}
          hint={`${summary.activeMemberCount.toLocaleString('en-IN')} active`} />
        <Stat label="Orders" value={summary.orderCount.toLocaleString('en-IN')} hint="Excluding cancelled" />
        <Stat label="Low stock" value={String(summary.lowStockCount)} hint="10 units or fewer"
          href={admin.role === 'ADMIN' ? '/admin/catalog' : undefined} />
      </div>

      {/* --------------------------------------- where commission goes */}
      {canSeeFinance && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Commission by type">
            {breakdown.length === 0 ? (
              <AdminEmpty>No commission has been paid yet.</AdminEmpty>
            ) : (
              <ul className="space-y-2">
                {breakdown.map((b) => {
                  const widest = Math.max(...breakdown.map((x) => x.total.paise)) || 1;
                  return (
                    <li key={b.type} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 text-neutral-600">{label(b.type)}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-neutral-100">
                        <div className="h-full rounded bg-neutral-800"
                          style={{ width: `${Math.max(3, (b.total.paise / widest) * 100)}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right tabular-nums text-neutral-900">
                        {showMoney(b.total)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Top earners">
            {earners.length === 0 ? (
              <AdminEmpty>Nobody has earned commission yet.</AdminEmpty>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {earners.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="text-neutral-900">{e.name}</span>
                      <span className="ml-2 font-mono text-xs text-neutral-500">{e.memberCode}</span>
                    </span>
                    <span className="tabular-nums text-neutral-900">{showMoney(e.earned)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function Queue({
  label, count, href, hint, urgent, visible,
}: {
  label: string; count: number; href: string; hint: string; urgent?: boolean; visible: boolean;
}) {
  if (!visible) return null;

  return (
    <Link
      href={href}
      className={`block rounded-xl border bg-white p-4 transition hover:shadow-sm ${
        urgent && count > 0 ? 'border-amber-300' : 'border-neutral-200'
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${urgent && count > 0 ? 'text-amber-700' : 'text-neutral-900'}`}>
        {count}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </Link>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </>
  );

  return href ? (
    <Link href={href} className="block rounded-xl border border-neutral-200 bg-white p-4 hover:shadow-sm">{body}</Link>
  ) : (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">{body}</div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}

/** Commission enum values as an operator would say them. */
function label(type: string): string {
  // These are CommissionType values, which spell it GENERATION. The ledger's
  // own enum says GENERATION_BONUS for the same money — two enums, two
  // spellings, and mixing them up shows an unlabelled row rather than failing.
  const map: Record<string, string> = {
    SELF: 'Self purchase',
    DIRECT: 'Direct income',
    TEAM: 'Team income',
    GENERATION: 'Generation bonus',
    ROYALTY: 'Royalty',
  };
  return map[type] ?? type.replace(/_/g, ' ').toLowerCase();
}
