'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type VolumeView } from '@/lib/money';
import { MemberShell, EmptyState } from './MemberShell';
import { NetworkTree, metTarget, type TeamContext, type TreeNode } from './NetworkTree';
import { buildReferralLink } from '@/lib/referral';

/**
 * The team.
 *
 * Two things this screen deliberately does not do:
 *
 *   • **It does not show income.** Not the member's, and certainly not anyone
 *     else's. A downline's earnings are their business, and a screen that
 *     displays them is how a team lead ends up pressuring people over numbers
 *     they never agreed to share.
 *   • **It does not load the whole tree.** A member with 10,000 people below
 *     them gets counts per level from one indexed prefix query, and expands one
 *     branch at a time. There is no endpoint that returns everyone.
 *
 * Contact details are not here either — only a first name, a member code and a
 * status. The full list of names, numbers and addresses is exactly the export a
 * departing team lead would want, and there is no screen that hands it over.
 */

interface Direct {
  id: string;
  code: string;
  name: string;
  status: string;
  rankIndex: number;
  groupBv: VolumeView;
  monthBv: VolumeView;
  directCount: number;
  joinedAt: string;
}

interface Network {
  me: { code: string; depth: number };
  levels: { level: number; total: number; active: number }[];
  totals: { team: number; active: number; direct: number };
  directs: Direct[];
  truncated: boolean;
  period: string;
  rankNames: string[];
  target: VolumeView | null;
}

interface SearchHit extends TreeNode { level: number }

export function NetworkView() {
  return (
    <MemberShell title="My team">
      {(data) => <Team memberCode={data.member.code} />}
    </MemberShell>
  );
}

function Team({ memberCode }: { memberCode: string }) {
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [belowOnly, setBelowOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Search runs after a short pause in typing, and only for two characters or more.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: SearchHit[] }>(`/me/network-search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setHits(r.results);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const n = await api<Network>('/me/network');
        if (!cancelled) setNetwork(n);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your team.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>;
  }
  if (!network) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />)}
      </div>
    );
  }

  const ctx: TeamContext = { rankNames: network.rankNames, target: network.target };
  const activeDirects = network.directs.filter((d) => d.status === 'ACTIVE');
  const metCount = activeDirects.filter((d) => metTarget(d, ctx) === true).length;
  const belowCount = activeDirects.filter((d) => metTarget(d, ctx) === false).length;
  const shownDirects = belowOnly ? activeDirects.filter((d) => metTarget(d, ctx) === false) : network.directs;

  return (
    <div className="space-y-6">
      <ReferralCard memberCode={memberCode} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Direct" value={network.totals.direct} hint="People you sponsored yourself" />
        <Stat label="Total team" value={network.totals.team} hint="Everyone below you, to ten levels" />
        <Stat label="Active" value={network.totals.active} hint="Accounts currently in good standing" />
      </div>

      {/* --------------------------------------------------------- levels */}
      {network.levels.length > 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">By level</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Level 1 is the people you sponsored. Level 2 is the people they sponsored, and so on.
          </p>

          <ul className="mt-4 space-y-2">
            {network.levels.map((l) => {
              const widest = Math.max(...network.levels.map((x) => x.total)) || 1;
              return (
                <li key={l.level} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs text-[var(--muted)]">Level {l.level}</span>
                  {/* A bar rather than a number alone: the shape of a team —
                      wide and shallow, or narrow and deep — is the thing a
                      member actually wants to read here. */}
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-[var(--page)]">
                    <div
                      className="h-full rounded-lg bg-gradient-to-r from-[var(--gold)] to-[var(--gold-mid)]"
                      style={{ width: `${Math.max(4, (l.total / widest) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-[var(--body)]">
                    {l.total} <span className="text-[var(--faint)]">({l.active} active)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------------- search */}
      <section aria-label="Find someone in your team">
        <label htmlFor="team-search" className="font-serif text-xl text-[var(--ink)]">Find someone in your team</label>
        <input
          id="team-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="First name or member ID"
          autoComplete="off"
          className="mt-3 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none"
        />
        {query.trim().length >= 2 && (
          <div className="mt-3" aria-live="polite">
            {searching && hits === null ? (
              <p className="text-sm text-[var(--muted)]">Searching…</p>
            ) : hits && hits.length > 0 ? (
              <>
                <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                  {hits.map((h) => {
                    const met = h.status === 'ACTIVE' ? metTarget(h, ctx) : null;
                    return (
                      <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3">
                        <span className="text-sm font-medium text-[var(--ink)]">{h.name}</span>
                        <code className="text-[11px] text-[var(--muted)]">{h.code}</code>
                        <span className="rounded-full bg-[var(--gold-pale)] px-2 py-0.5 text-[10px] font-semibold text-[var(--gold-mid)]">{ctx.rankNames[h.rankIndex] ?? 'Member'}</span>
                        {met !== null && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${met ? 'bg-[#E8F5EC] text-[#1F7A3D]' : 'bg-[#FDF3DC] text-[#9A6A08]'}`}>{met ? 'Target met' : 'Below target'}</span>
                        )}
                        <span className="w-full text-[11px] text-[var(--faint)]">Level {h.level} · This month {h.monthBv?.display}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">No one in your team matches “{query.trim()}”.</p>
            )}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- directs */}
      <section>
        <h2 className="font-serif text-xl text-[var(--ink)]">People you sponsored</h2>

        {network.target && activeDirects.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm">
            <span className="text-[var(--body)]">
              This month&apos;s target is <strong className="text-[var(--ink)]">{network.target.display}</strong> of purchases:
              {' '}<strong className="text-[#1F7A3D]">{metCount} met</strong>, <strong className="text-[#9A6A08]">{belowCount} below</strong>.
            </span>
            {belowCount > 0 && (
              <button
                type="button"
                aria-pressed={belowOnly}
                onClick={() => setBelowOnly((v) => !v)}
                className={`ml-auto rounded-full border px-3 py-1 text-xs font-semibold ${belowOnly ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--gold-pale)]' : 'border-[var(--line-strong)] text-[var(--body)] hover:bg-[var(--surface-tint)]'}`}
              >
                {belowOnly ? 'Showing below target' : 'Show only below target'}
              </button>
            )}
          </div>
        )}

        <div className="mt-4">
          {shownDirects.length === 0 && network.directs.length > 0 ? (
            <EmptyState title="Everyone has met the target" body="Nobody in your direct team is below this month's target." />
          ) : network.directs.length === 0 ? (
            <EmptyState
              title="Nobody yet"
              body="Share your referral link with anyone who wants to sell the products. They will appear here once they sign up."
            />
          ) : (
            <NetworkTree
              rootLabel="You"
              ctx={ctx}
              nodes={shownDirects.map((d) => ({
                id: d.id, code: d.code, name: d.name, status: d.status,
                rankIndex: d.rankIndex, monthBv: d.monthBv, directCount: d.directCount, joinedAt: d.joinedAt,
              }))}
            />
          )}
        </div>

        {network.truncated && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Showing the most recent 100. Use the team report in your account for the full list.
          </p>
        )}
      </section>

      {/* Said plainly, because someone will ask. */}
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Earnings are not shown here — neither yours nor anyone else&apos;s. Your own income is in your
        wallet statement; what the people in your team earn is theirs to share or not.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{label}</p>
      <p className="mt-1 font-serif text-3xl text-[var(--ink)]">{value.toLocaleString('en-IN')}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{hint}</p>
    </div>
  );
}

function ReferralCard({ memberCode }: { memberCode: string }) {
  const [copied, setCopied] = useState<'link' | 'code' | 'storefront' | null>(null);
  const [origin, setOrigin] = useState('');

  // Read after mount: `window` does not exist during SSR, and hard-coding the
  // origin would break the link on a preview deployment.
  useEffect(() => setOrigin(window.location.origin), []);

  // buildReferralLink throws on a code it does not recognise. That should not
  // be possible — the code comes from the API — but a throw here would blank
  // the whole team page over a link widget, so it degrades to the plain origin.
  let link = '';
  if (origin) {
    try {
      link = buildReferralLink('/', memberCode, origin);
    } catch {
      link = origin;
    }
  }
  const storefront = origin ? `${origin}/mc/${memberCode}` : '';

  const copy = async (value: string, which: 'link' | 'code' | 'storefront') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-gradient-to-br from-[var(--accent-soft)] to-white p-5">
      <h2 className="font-serif text-lg text-[var(--ink)]">Invite someone</h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        Anyone who signs up through your link or with your ID joins your team. Joining is free.
      </p>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Your member ID</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="font-mono text-lg font-semibold text-[var(--ink)]">{memberCode}</code>
            <button
              type="button"
              onClick={() => copy(memberCode, 'code')}
              className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]"
            >
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Referral link</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="min-w-0 truncate text-xs text-[var(--body)]">{link || '…'}</code>
            <button
              type="button"
              onClick={() => copy(link, 'link')}
              disabled={!link}
              className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)] disabled:text-[var(--faint)]"
            >
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">Your storefront</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="min-w-0 truncate text-xs text-[var(--body)]">{storefront || '…'}</code>
            <button
              type="button"
              onClick={() => copy(storefront, 'storefront')}
              disabled={!storefront}
              className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)] disabled:text-[var(--faint)]"
            >
              {copied === 'storefront' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--faint)]">
            A full page with your name on it, not just a tracked link — better for a WhatsApp
            status or a bio link.
          </p>
        </div>
      </div>

      {/* The referral parameter is stripped by middleware and the page carries
          a canonical without it, so 500 members sharing the same product page
          do not create 500 competing URLs. Worth saying, because it looks like
          the link "loses" the code. */}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--faint)]">
        The code is remembered when someone opens your link, even though it disappears from the
        address bar.
      </p>
    </section>
  );
}
