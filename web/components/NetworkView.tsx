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

export interface NetworkCopy {
  levelsExplainer: string; emptyTitle: string; emptyBody: string;
  incomeDisclaimer: string; inviteIntro: string; storefrontPitch: string;
  shareMessageTemplate: string;
}

export function NetworkView({ content }: { content: NetworkCopy }) {
  return (
    <MemberShell title="My team">
      {(data) => <Team memberCode={data.member.code} content={content} />}
    </MemberShell>
  );
}

function Team({ memberCode, content }: { memberCode: string; content: NetworkCopy }) {
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
      <ReferralCard memberCode={memberCode} content={content} />

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
            {content.levelsExplainer}
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
              title={content.emptyTitle}
              body={content.emptyBody}
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
        {content.incomeDisclaimer}
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

function ReferralCard({ memberCode, content }: { memberCode: string; content: NetworkCopy }) {
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
        {content.inviteIntro}
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
          {link && <ShareRow link={link} memberCode={memberCode} messageTemplate={content.shareMessageTemplate} />}
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
            {content.storefrontPitch}
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

/**
 * Direct share links, not a copy-paste-only widget. WhatsApp, Telegram,
 * Facebook and email all have a stable web URL that needs no app registration
 * of ours; Messenger and Instagram do not offer one (Meta requires a
 * registered app id for Messenger's dialog, and Instagram has no web share
 * intent at all) so those two use the mobile app's own deep-link scheme —
 * they open the app with the link pre-filled on a phone that has it
 * installed, and are a harmless no-op tap anywhere else.
 */
function ShareRow({ link, memberCode, messageTemplate }: { link: string; memberCode: string; messageTemplate: string }) {
  const intro = messageTemplate.replace('{code}', memberCode);
  const encodedMessage = encodeURIComponent(`${intro}: ${link}`);
  const encodedIntro = encodeURIComponent(intro);
  const encodedLink = encodeURIComponent(link);

  const targets = [
    { name: 'WhatsApp', href: `https://wa.me/?text=${encodedMessage}`, icon: WhatsAppIcon },
    { name: 'Telegram', href: `https://t.me/share/url?url=${encodedLink}&text=${encodedIntro}`, icon: TelegramIcon },
    { name: 'Messenger', href: `fb-messenger://share?link=${encodedLink}`, icon: MessengerIcon },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}`, icon: FacebookIcon },
    { name: 'Instagram', href: `instagram://share?text=${encodedMessage}`, icon: InstagramIcon },
    { name: 'Email', href: `mailto:?subject=${encodeURIComponent('Join Majestic Cart')}&body=${encodedMessage}`, icon: EmailIcon },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
      {targets.map((t) => (
        <a
          key={t.name}
          href={t.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share on ${t.name}`}
          title={t.name}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--muted)] transition hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]"
        >
          <t.icon />
        </a>
      ))}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.35-.5.05-1.03.24-3.44-.72-2.9-1.16-4.76-4.08-4.9-4.27-.14-.19-1.17-1.56-1.17-2.98s.74-2.11 1-2.4c.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.24.58.82 2 .89 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.41.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.52 1.9 1.05.94 1.93 1.23 2.21 1.37.28.14.44.12.6-.07.16-.19.69-.8.87-1.08.18-.28.36-.23.6-.14.24.09 1.53.72 1.79.85.26.14.43.2.5.31.07.12.07.66-.17 1.35Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.5 4.5 2.7 11.9c-1 .4-1 1 .18 1.34l4.8 1.5 1.85 5.7c.22.62.4.87.82.87.32 0 .47-.15.66-.33l1.77-1.72 4.9 3.62c.68.4 1.16.2 1.34-.63l3.1-14.7c.27-1.1-.28-1.55-1.62-1.05Zm-3.08 3.6-7.4 6.7-.3 3.15-1.5-4.65 8.9-5.6c.4-.24.76-.11.46.18l-.16.22Z" />
    </svg>
  );
}

function MessengerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.15 2 11.27c0 2.92 1.46 5.53 3.75 7.23V22l3.43-1.88c.9.25 1.85.38 2.82.38 5.52 0 10-4.15 10-9.27C22 6.15 17.52 2 12 2Zm1 12.5-2.55-2.72-4.98 2.72 5.48-5.82 2.6 2.72 4.93-2.72L13 14.5Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7.5H16l.5-3H13.5V8.5c0-.87.24-1.46 1.5-1.46H16.6V4.36C16.3 4.32 15.3 4.24 14.1 4.24c-2.4 0-4.05 1.47-4.05 4.17v2.13H7.5v3H10V21h3.5Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </svg>
  );
}
