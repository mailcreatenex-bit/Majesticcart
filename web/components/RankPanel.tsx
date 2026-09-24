'use client';

import { useEffect, useState } from 'react';
import { showVolume, type VolumeView } from '@/lib/money';

/**
 * Rank, as something to aim at rather than a word on a card.
 *
 * The plan's ranks are configurable (see PlanEditor), so nothing here assumes
 * a fixed ladder of names — the crown fills in proportion to `index`, and the
 * bar reads whatever the next rank happens to be called.
 *
 * The celebration fires once per rank, on the device that saw the change, and
 * is remembered in localStorage. It is deliberately not driven by a server
 * flag: a "congratulations" that replays every time the page loads stops
 * meaning anything, and one that needs a database write to acknowledge is a
 * lot of machinery for a small moment.
 */

const SEEN_RANK_KEY = 'mc-seen-rank';

export interface RankInfo {
  index: number;
  name: string;
  next: {
    name: string;
    requiredBv: VolumeView;
    remainingBv: VolumeView;
    currentBv: VolumeView;
    basis: 'GROUP_BV' | 'TEAM_BV';
    selfPct: number;
    teamPct: number;
    currentSelfPct: number;
    currentTeamPct: number;
  } | null;
}

export function RankPanel({ rank, joinedLabel }: { rank: RankInfo; joinedLabel: string }) {
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    let previous: number | null = null;
    try {
      const raw = localStorage.getItem(SEEN_RANK_KEY);
      previous = raw === null ? null : Number(raw);
    } catch { return; } // storage blocked: skip the celebration rather than break the page

    // Only celebrate a rank that went *up*, and never on first load — a new
    // member opening their account for the first time has not just achieved
    // anything, and congratulating them for it is noise.
    if (previous !== null && Number.isFinite(previous) && rank.index > previous) {
      setCelebrate(true);
    }
    try { localStorage.setItem(SEEN_RANK_KEY, String(rank.index)); } catch { /* nothing to do */ }
  }, [rank.index]);

  const pct = rank.next
    ? Math.min(100, Math.max(2,
        ((rank.next.requiredBv.centi - rank.next.remainingBv.centi) /
          Math.max(1, rank.next.requiredBv.centi)) * 100))
    : 100;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-[var(--accent-soft)] to-[var(--surface)] p-5">
      {celebrate && <RankUpBanner name={rank.name} onDismiss={() => setCelebrate(false)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <RankCrown index={rank.index} topped={rank.next === null} />
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Current rank</p>
            <p className="font-serif text-2xl leading-tight text-[var(--ink)]">{rank.name}</p>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">Member since {joinedLabel}</p>
      </div>

      {rank.next ? (
        <div className="mt-5">
          <div className="flex justify-between text-xs text-[var(--body)]">
            <span>Next: <span className="font-semibold text-[var(--ink)]">{rank.next.name}</span></span>
            <span>{showVolume(rank.next.remainingBv)} to go</span>
          </div>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-tint)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label={`Progress to ${rank.next.name}`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--gold-deep)] via-[var(--gold)] to-[var(--gold-mid)] transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {Math.round(pct)}% of the way there.
          </p>

          {/* What is still needed, spelled out: the number, what it is counted on, and what the rank is worth. */}
          <dl className="mt-4 grid gap-3 rounded-xl bg-[var(--surface)] p-4 text-xs sm:grid-cols-3">
            <div>
              <dt className="uppercase tracking-wider text-[var(--faint)]">You have</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)]">
                {showVolume(rank.next.currentBv)} <span className="font-normal text-[var(--muted)]">of {showVolume(rank.next.requiredBv)}</span>
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wider text-[var(--faint)]">Still needed</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)]">{showVolume(rank.next.remainingBv)}</dd>
              <dd className="mt-0.5 text-[11px] text-[var(--muted)]">
                {rank.next.basis === 'TEAM_BV'
                  ? 'Counted on your team’s purchases, not your own.'
                  : 'Counted on your own and your whole team’s purchases.'}
              </dd>
            </div>
            <div>
              <dt className="uppercase tracking-wider text-[var(--faint)]">What {rank.next.name} pays</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)]">
                {rank.next.selfPct}% <span className="font-normal text-[var(--muted)]">on your purchases{rank.next.selfPct !== rank.next.currentSelfPct ? `, up from ${rank.next.currentSelfPct}%` : ''}</span>
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-[var(--surface-tint)] px-4 py-3 text-xs text-[var(--body)]">
          You are at the top rank. Nothing left to climb.
        </p>
      )}
    </section>
  );
}

/**
 * The logo's crown, filling as the rank rises.
 *
 * Caps the visual scale at five even when the plan defines more ranks: past
 * that the difference between one crown and the next stops being legible, and
 * the number beside it is doing the real work anyway.
 */
function RankCrown({ index, topped }: { index: number; topped: boolean }) {
  const level = Math.min(index, 5);
  const fill = topped ? 1 : level / 5;

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--gold-mid)]/40 bg-[var(--surface)]">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="rank-crown-fill" x1="0" y1="1" x2="0" y2="0">
            {/* Fills bottom-up, so a higher rank is visibly a fuller crown
                rather than just a different colour. */}
            <stop offset={fill} stopColor="var(--gold)" />
            <stop offset={fill} stopColor="var(--faint)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <path
          d="M3 18h18l-1.2-9.4-4.2 3.2L12 5.5 8.4 11.8 4.2 8.6Z"
          fill="url(#rank-crown-fill)"
          stroke="var(--gold-mid)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="20.5" r="1" fill="var(--gold-mid)" />
      </svg>
    </div>
  );
}

function RankUpBanner({ name, onDismiss }: { name: string; onDismiss: () => void }) {
  return (
    <div
      // Polite, not assertive: this is good news, not something that should
      // interrupt whatever a screen reader is currently saying.
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--gold-mid)]/40 bg-[var(--surface)] p-4"
    >
      <SparkleIcon />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-lg leading-tight text-[var(--ink)]">You reached {name}</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--body)]">
          Your new rate applies to commission earned from here on. Income already credited stays as it was paid.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-tint)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 5l14 14M19 5L5 19" />
        </svg>
      </button>
    </div>
  );
}

/** The four-point star from the logo, not a generic sparkle. */
function SparkleIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" className="shrink-0 text-[var(--gold)]" aria-hidden="true">
      <path d="M12 2.5 13.7 9l6.5 1.7-6.5 1.7L12 19l-1.7-6.6L3.8 10.7 10.3 9Z" fill="currentColor" />
      <path d="M18.5 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
