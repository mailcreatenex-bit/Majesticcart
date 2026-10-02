'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showVolume, type VolumeView } from '@/lib/money';
import { MemberShell } from './MemberShell';

/**
 * The member's business dashboard: team size, this month against the monthly
 * target, how far the next rank is, and who on the direct team could use a
 * nudge. Volume and counts only. There is no income figure anywhere on this
 * screen, on purpose: it is the screen a member is most likely to screenshot
 * and share.
 */

type Reason = 'BELOW_TARGET' | 'NO_ORDER_THIS_MONTH' | 'NEVER_ORDERED';

interface Dash {
  period: string;
  daysLeft: number;
  team: { total: number; active: number; direct: number; joinedThisMonth: number };
  month: { own: VolumeView; group: VolumeView; target: VolumeView | null; targetPct: number | null; remaining: VolumeView | null; directsOnTarget: number | null };
  history: { period: string; own: VolumeView; group: VolumeView }[];
  rank: { name: string; next: { name: string; requiredBv: VolumeView; currentBv: VolumeView; remainingBv: VolumeView; pct: number } | null };
  needsNudge: { id: string; name: string; code: string; reason: Reason; monthBv: VolumeView; gapBv: VolumeView | null; lastOrderAt: string | null; nudgedRecently: boolean }[];
  needsNudgeTotal: number;
}

const REASON: Record<Reason, string> = {
  BELOW_TARGET: 'Close to target',
  NO_ORDER_THIS_MONTH: 'No order this month',
  NEVER_ORDERED: 'Has not ordered yet',
};

export function TeamDashboardView() {
  return (
    <MemberShell title="Dashboard">
      {() => <Dashboard />}
    </MemberShell>
  );
}

function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Dash>('/me/team-dashboard')
      .then((r) => { if (!cancelled) setD(r); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="mt-6 text-sm text-[#C0392B]">{error}</p>;
  if (!d) return <div className="mt-6 h-96 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />;

  const peak = Math.max(1, ...d.history.map((h) => h.own.centi));

  return (
    <div className="mt-6 space-y-6">
      {/* ------------------------------------------------------ team size */}
      <section aria-label="Team size" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Your team" value={d.team.total} />
        <Stat label="Active" value={d.team.active} />
        <Stat label="Directly sponsored" value={d.team.direct} />
        <Stat label="Joined this month" value={d.team.joinedThisMonth} />
      </section>

      {/* ------------------------------------------------ this month */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg text-[var(--ink)]">This month ({d.period})</h2>
          <p className="text-xs text-[var(--muted)]">{d.daysLeft} {d.daysLeft === 1 ? 'day' : 'days'} left</p>
        </div>

        {d.month.target ? (
          <>
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span className="font-semibold text-[var(--ink)]">{showVolume(d.month.own)}</span>
              <span className="text-[var(--muted)]">of {showVolume(d.month.target)} monthly target</span>
            </div>
            <Bar pct={d.month.targetPct ?? 0} label="Progress to this month's target" />
            <p className="mt-2 text-sm text-[var(--body)]">
              {d.month.remaining && d.month.remaining.centi > 0
                ? `${showVolume(d.month.remaining)} more to reach this month's target.`
                : 'You have reached this month’s target.'}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-[var(--body)]">Your own purchases this month: <strong>{showVolume(d.month.own)}</strong></p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 text-sm">
          <div>
            <dt className="text-xs text-[var(--muted)]">Team volume this month</dt>
            <dd className="font-semibold text-[var(--ink)]">{showVolume(d.month.group)}</dd>
          </div>
          {d.month.directsOnTarget !== null && (
            <div>
              <dt className="text-xs text-[var(--muted)]">Direct team on target</dt>
              <dd className="font-semibold text-[var(--ink)]">{d.month.directsOnTarget} of {d.team.direct}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5" aria-label="Your volume over the last six months">
          <p className="text-xs text-[var(--muted)]">Your purchases, last six months</p>
          <div className="mt-2 flex h-24 items-end gap-2">
            {d.history.map((h) => (
              <div key={h.period} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div
                  title={`${h.period}: ${showVolume(h.own)}`}
                  className="w-full rounded-t bg-[var(--accent)]/80"
                  style={{ height: `${Math.max(3, (h.own.centi / peak) * 100)}%` }}
                />
                <span className="text-[10px] text-[var(--faint)]">{h.period.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- rank */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-serif text-lg text-[var(--ink)]">Rank</h2>
        <p className="mt-1 text-sm text-[var(--body)]">You are <strong>{d.rank.name}</strong>.</p>
        {d.rank.next ? (
          <>
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span className="text-[var(--muted)]">Next: {d.rank.next.name}</span>
              <span className="text-[var(--muted)]">{showVolume(d.rank.next.currentBv)} / {showVolume(d.rank.next.requiredBv)}</span>
            </div>
            <Bar pct={d.rank.next.pct} label={`Progress to ${d.rank.next.name}`} />
            <p className="mt-2 text-sm text-[var(--body)]">{showVolume(d.rank.next.remainingBv)} to go.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--body)]">You are at the top rank.</p>
        )}
      </section>

      {/* ----------------------------------------------------- nudge */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-serif text-lg text-[var(--ink)]">Who needs a nudge</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          People you sponsored directly who are behind this month. A reminder goes to them as a short message from you. You can remind each person once every three days.
        </p>
        {d.needsNudge.length === 0 ? (
          <p className="mt-4 rounded-xl bg-[var(--page)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            Everyone on your direct team is on track. Nice work.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {d.needsNudge.map((n) => <NudgeRow key={n.id} n={n} />)}
          </ul>
        )}
        {d.needsNudgeTotal > d.needsNudge.length && (
          <p className="mt-3 text-xs text-[var(--faint)]">Showing {d.needsNudge.length} of {d.needsNudgeTotal}.</p>
        )}
        <Link href="/network" className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] hover:underline">See the full team →</Link>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{value.toLocaleString('en-IN')}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-tint)]">
      <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function NudgeRow({ n }: { n: Dash['needsNudge'][number] }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(n.nudgedRecently ? 'sent' : 'idle');
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    setState('sending');
    setMessage(null);
    try {
      await api(`/me/team/${n.id}/nudge`, { method: 'POST', body: {} });
      setState('sent');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not send the reminder.');
      setState('error');
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--ink)]">{n.name} <span className="font-mono text-xs text-[var(--faint)]">{n.code}</span></p>
        <p className="text-xs text-[var(--muted)]">
          {REASON[n.reason]}
          {n.reason === 'BELOW_TARGET' && n.gapBv ? ` · ${showVolume(n.gapBv)} short` : ''}
          {n.reason === 'NO_ORDER_THIS_MONTH' && n.lastOrderAt ? ` · last order ${formatDate(n.lastOrderAt)}` : ''}
        </p>
        {message && <p role="alert" className="mt-1 text-xs text-[#C0392B]">{message}</p>}
      </div>
      <button
        type="button"
        onClick={send}
        disabled={state === 'sending' || state === 'sent'}
        className="shrink-0 rounded-xl border border-[var(--line-strong)] px-4 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:text-[var(--faint)]"
      >
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Reminded' : 'Send a reminder'}
      </button>
    </li>
  );
}
