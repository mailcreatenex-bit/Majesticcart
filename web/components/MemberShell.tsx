'use client';

import Link from 'next/link';
import type { RankInfo } from './RankPanel';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { showMoney, type MoneyView } from '@/lib/money';

/**
 * The frame every logged-in screen sits in.
 *
 * Its job is the wallet strip: on a site where nothing can be bought without a
 * wallet balance, that number has to be visible from wherever the member is
 * standing. Discovering an empty wallet at the Pay button is the failure this
 * exists to prevent.
 */

export interface MemberSummary {
  member: {
    id: string; code: string; name: string; phone: string; email: string | null; status: string; joinedAt: string;
    photoUrl: string | null; location: string | null;
  };
  rank: RankInfo;
  wallets: { shopping: MoneyView; income: MoneyView };
  volume: {
    lifetimeSelf: { centi: number; display: string };
    lifetimeGroup: { centi: number; display: string };
    period: string;
    periodSelf: { centi: number; display: string };
    periodGroup: { centi: number; display: string };
  };
  team: { direct: number };
  /** The plan's monthly repurchase target, or null when the plan has none. */
  repurchase: { targetBv: { centi: number; display: string } } | null;
  pending: { recharges: number; withdrawals: number; notifications: number };
}

const NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/orders', label: 'Orders' },
  { href: '/network', label: 'My team' },
  { href: '/statement', label: 'Statement' },
  { href: '/id-card', label: 'ID card' },
  { href: '/share', label: 'Share' },
];

/**
 * Loads the member summary once and hands it to the page.
 *
 * A render prop rather than a context, because every member page needs exactly
 * this one payload and nothing else — a context would be ceremony around a
 * single fetch.
 */
export function MemberShell({
  title,
  children,
}: {
  title: string;
  children: (data: MemberSummary, reload: () => void) => React.ReactNode;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<MemberSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<MemberSummary>('/me');
        if (!cancelled) { setData(me); setError(null); }
      } catch (err) {
        // A 401 has already redirected to login by the time this runs, so
        // anything reaching here is a real failure worth showing.
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your account.');
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  const reload = () => setNonce((n) => n + 1);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-[var(--ink)]">{title}</h1>
          {data && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              {data.member.name} · {data.member.code} · {data.rank.name}
            </p>
          )}
        </div>

        {data && (
          <div className="flex items-start gap-3">
            <div className="flex gap-3 text-right">
              <WalletChip label="Shopping" value={showMoney(data.wallets.shopping)} href="/recharge" cta="Add money" />
              <WalletChip label="Income" value={showMoney(data.wallets.income)} href="/wallet?kind=income" cta="Statement" />
            </div>
            <SignOut />
          </div>
        )}
      </header>

      {/* A member on hold can still read everything; they just cannot order.
          Saying so here beats a confusing failure at checkout. */}
      {data && data.member.status !== 'ACTIVE' && (
        <p role="status" className="mt-4 rounded-xl bg-[var(--notice-bg)] px-4 py-3 text-sm text-[var(--body)]">
          Your account is on hold, so new orders and withdrawals are paused. Contact customer care to sort it out.
        </p>
      )}

      <nav aria-label="Account" className="mt-6 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
        {NAV.map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${
                active
                  ? 'border-[var(--accent)] font-semibold text-[var(--ink)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">
        {error ? (
          <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[#C0392B]">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-3 rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]"
            >
              Try again
            </button>
          </div>
        ) : data ? (
          children(data, reload)
        ) : (
          <MemberSkeleton />
        )}
      </div>
    </div>
  );
}

/**
 * The refresh token behind this session is an httpOnly cookie the browser
 * cannot read or clear itself, so signing out has to be a request, not a
 * client-side state reset. The proxy at `app/api/[...path]/route.ts` reads
 * the cookie, revokes it on the API, and clears it either way.
 */
function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore: end the session locally regardless */ }
        router.replace('/login');
      }}
      className="mt-1 rounded-xl border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-tint)] disabled:opacity-50"
    >
      {busy ? '…' : 'Sign out'}
    </button>
  );
}

function WalletChip({ label, value, href, cta }: { label: string; value: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{label}</p>
      <p className="mt-0.5 font-semibold text-[var(--ink)]">{value}</p>
      <Link href={href} className="mt-1 block text-[11px] font-semibold text-[var(--accent)] hover:underline">
        {cta}
      </Link>
    </div>
  );
}

export function MemberSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
      ))}
    </div>
  );
}

/** Shared empty state, so every list reads the same way. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center">
      <h2 className="font-serif text-lg text-[var(--ink)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Status pills, one vocabulary across recharges, orders and withdrawals. */
export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    PENDING: 'bg-[#FDF6E7] text-[#8A6D1F]',
    PLACED: 'bg-[#FDF6E7] text-[#8A6D1F]',
    PACKED: 'bg-[#EAF1FB] text-[#2C5B9B]',
    SHIPPED: 'bg-[#EAF1FB] text-[#2C5B9B]',
    APPROVED: 'bg-[#E9F5EF] text-[#2C6B52]',
    DELIVERED: 'bg-[#E9F5EF] text-[#2C6B52]',
    PAID: 'bg-[#E9F5EF] text-[#2C6B52]',
    REJECTED: 'bg-[#FDECEA] text-[#A5342A]',
    CANCELLED: 'bg-[#FDECEA] text-[#A5342A]',
    RETURNED: 'bg-[#F3EEF1] text-[var(--body)]',
  };

  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone[status] ?? 'bg-[#F3EEF1] text-[var(--body)]'}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
