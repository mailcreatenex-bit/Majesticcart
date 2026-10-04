'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { showMoney, type MoneyView } from '@/lib/money';
import { AdminShell, AdminError, Panel, TableSkeleton } from './AdminShell';

/**
 * Store analytics: the funnel from visit to order, what people look at and
 * buy, and where checkout stalls. Anonymous, per-session; see
 * backend/src/analytics/analytics.service.ts for exactly what is recorded.
 */

interface Report {
  days: number;
  funnel: { type: string; label: string; sessions: number; fromPreviousPct: number; fromVisitPct: number; lost: number }[];
  summary: { visits: number; orders: number; revenue: MoneyView; conversionPct: number; abandonedBags: number };
  checkoutBlockers: { reason: string; sessions: number }[];
  mostViewed: { slug: string; name: string; views: number; adds: number; addRatePct: number }[];
  topSellers: { productId: string; name: string; units: number; revenue: MoneyView }[];
  daily: { day: string; visits: number; orders: number }[];
}

const BLOCKER_LABEL: Record<string, string> = {
  login_required: 'Had to log in first',
  wallet_short: 'Shopping wallet too low',
  address_missing: 'Delivery address not filled in',
  order_error: 'The order failed to go through',
  other: 'Other',
};

const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']] as const;

export function AnalyticsAdminView() {
  return (
    <AdminShell title="Analytics" subtitle="Who visits, what they look at, and where they stop." permission="reports.view">
      <Analytics />
    </AdminShell>
  );
}

function Analytics() {
  const [days, setDays] = useState<number>(30);
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setR(null);
    api<Report>(`/admin/analytics?days=${days}`)
      .then((d) => { if (!cancelled) { setR(d); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load analytics.'); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1">
        {RANGES.map(([n, label]) => (
          <button
            key={n}
            type="button"
            onClick={() => setDays(n)}
            className={`rounded-lg px-3 py-1.5 text-sm ${days === n ? 'bg-neutral-900 text-white' : 'border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <AdminError message={error} />}
      {!r && !error && <TableSkeleton rows={6} />}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Store visits" value={r.summary.visits.toLocaleString('en-IN')} />
            <Kpi label="Orders" value={r.summary.orders.toLocaleString('en-IN')} />
            <Kpi label="Order value" value={showMoney(r.summary.revenue)} />
            <Kpi label="Visit → order" value={`${r.summary.conversionPct}%`} hint="of visits that ended in an order" />
            <Kpi label="Bags abandoned" value={r.summary.abandonedBags.toLocaleString('en-IN')} hint="added something, never ordered" />
          </div>

          {r.summary.visits === 0 && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No visits recorded in this period yet. Tracking started when this feature was switched on, so the numbers fill in from today.
            </p>
          )}

          <Panel title="Where shoppers drop off">
            <ol className="space-y-3">
              {r.funnel.map((s, i) => (
                <li key={s.type}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-neutral-900">{s.label}</span>
                    <span className="tabular-nums text-neutral-600">
                      {s.sessions.toLocaleString('en-IN')}
                      {i > 0 && <span className="ml-2 text-xs text-neutral-500">{s.fromPreviousPct}% of the step before</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-neutral-800" style={{ width: `${Math.max(s.sessions > 0 ? 1 : 0, s.fromVisitPct)}%` }} />
                  </div>
                  {i > 0 && s.lost > 0 && (
                    <p className="mt-0.5 text-xs text-red-700">{s.lost.toLocaleString('en-IN')} stopped before this step</p>
                  )}
                </li>
              ))}
            </ol>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Why checkout stalls">
              {r.checkoutBlockers.length === 0 ? (
                <p className="text-sm text-neutral-500">No stalls recorded.</p>
              ) : (
                <ul className="divide-y divide-neutral-100 text-sm">
                  {r.checkoutBlockers.map((b) => (
                    <li key={b.reason} className="flex justify-between py-2">
                      <span>{BLOCKER_LABEL[b.reason] ?? b.reason}</span>
                      <span className="tabular-nums text-neutral-600">{b.sessions.toLocaleString('en-IN')} sessions</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Best sellers">
              {r.topSellers.length === 0 ? (
                <p className="text-sm text-neutral-500">No orders in this period.</p>
              ) : (
                <div className="overflow-x-auto"><table className="w-full min-w-[18rem] text-sm">
                  <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 font-medium">Product</th><th className="pb-1 text-right font-medium">Units</th><th className="pb-1 text-right font-medium">Value</th></tr></thead>
                  <tbody className="divide-y divide-neutral-100">
                    {r.topSellers.map((t) => (
                      <tr key={t.productId}>
                        <td className="py-1.5 pr-2">{t.name}</td>
                        <td className="py-1.5 text-right tabular-nums">{t.units}</td>
                        <td className="py-1.5 text-right tabular-nums">{showMoney(t.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </Panel>
          </div>

          <Panel title="Most looked at">
            {r.mostViewed.length === 0 ? (
              <p className="text-sm text-neutral-500">No product views recorded yet.</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[22rem] text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 font-medium">Product</th><th className="pb-1 text-right font-medium">Viewed</th><th className="pb-1 text-right font-medium">Added to bag</th><th className="pb-1 text-right font-medium">Add rate</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {r.mostViewed.map((p) => (
                    <tr key={p.slug}>
                      <td className="py-1.5 pr-2">{p.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.views}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.adds}</td>
                      <td className={`py-1.5 text-right tabular-nums ${p.views >= 10 && p.addRatePct < 5 ? 'text-red-700' : ''}`}>{p.addRatePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <p className="mt-2 text-xs text-neutral-500">Counted in sessions, not clicks. A low add rate on a much-viewed product (shown in red) usually means price, photos or description are putting people off.</p>
          </Panel>

          <Panel title="Visits and orders by day">
            <DailyChart rows={r.daily} />
          </Panel>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function DailyChart({ rows }: { rows: Report['daily'] }) {
  const peak = Math.max(1, ...rows.map((d) => d.visits));
  return (
    <div>
      <div className="flex h-32 items-end gap-0.5" role="img" aria-label="Visits per day">
        {rows.map((d) => (
          <div key={d.day} className="group relative flex flex-1 flex-col justify-end" title={`${d.day}: ${d.visits} visits, ${d.orders} orders`}>
            <div className="w-full rounded-t bg-neutral-300" style={{ height: `${Math.max(2, (d.visits / peak) * 100)}%` }} />
            {d.orders > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t bg-neutral-900" style={{ height: `${Math.max(4, (d.orders / peak) * 100)}%` }} />}
          </div>
        ))}
      </div>
      <p className="mt-2 flex gap-4 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-300" />Visits</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-900" />Orders</span>
        <span className="ml-auto">{rows[0]?.day} to {rows[rows.length - 1]?.day}</span>
      </p>
    </div>
  );
}
