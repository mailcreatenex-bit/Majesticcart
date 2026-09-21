'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatDate, showMoney, type MoneyView } from '@/lib/money';
import { MemberShell, EmptyState } from './MemberShell';

/**
 * Wallet statements.
 *
 * Two wallets, and the separation between them is not cosmetic:
 *
 *   • **Shopping** is funded by verified UPI payments and spends on orders. It
 *     can never be withdrawn as cash. That is what keeps a recharge a purchase
 *     of store credit rather than a deposit — and a deposit taken by a company
 *     that is not a bank is a different kind of business with a different set
 *     of laws attached.
 *   • **Income** is funded by commission on delivered orders and withdraws to a
 *     bank account.
 *
 * Money moves one way only: income into shopping, never the reverse. The screen
 * says so rather than leaving the member to discover it.
 */

interface LedgerEntry {
  id: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: MoneyView;
  balanceAfter: MoneyView;
  category: string;
  label: string;
  ref: { type: string; id: string } | null;
  note: string | null;
  at: string;
}

interface Statement {
  kind: 'SHOPPING' | 'INCOME';
  balance: MoneyView;
  entries: LedgerEntry[];
  nextCursor: string | null;
}

export function WalletView() {
  const params = useSearchParams();
  const kind = params.get('kind') === 'income' ? 'INCOME' : 'SHOPPING';

  return (
    <MemberShell title="Wallet">
      {(data) => (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <WalletCard
              title="Shopping wallet"
              balance={showMoney(data.wallets.shopping)}
              body="Funded by UPI payments you submit for approval. Spends on orders — or on a mobile recharge, if you'd rather not shop right now. Cannot be withdrawn as cash."
              action={{ href: '/recharge', label: 'Add money' }}
              secondaryAction={{ href: '/wallet/mobile-recharge', label: 'Recharge mobile instead' }}
              active={kind === 'SHOPPING'}
              href="/wallet"
            />
            <WalletCard
              title="Income wallet"
              balance={showMoney(data.wallets.income)}
              body="Earned on orders that have been delivered. Withdraws to your bank account, or moves into your shopping wallet."
              action={{ href: '/wallet/withdraw', label: 'Withdraw' }}
              active={kind === 'INCOME'}
              href="/wallet?kind=income"
            />
          </div>

          <Statement kind={kind} />
        </div>
      )}
    </MemberShell>
  );
}

function WalletCard({
  title, balance, body, action, secondaryAction, active, href,
}: {
  title: string;
  balance: string;
  body: string;
  action: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
  active: boolean;
  href: string;
}) {
  return (
    <div className={`rounded-2xl border bg-[var(--surface)] p-5 ${active ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
          <p className="mt-1 font-serif text-2xl text-[var(--ink)]">{balance}</p>
        </div>
        <Link href={action.href} className="shrink-0 rounded-xl border border-[var(--line-strong)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]">
          {action.label}
        </Link>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {!active && (
          <Link href={href} className="inline-block text-xs font-semibold text-[var(--accent)] hover:underline">
            See statement →
          </Link>
        )}
        {secondaryAction && (
          <Link href={secondaryAction.href} className="inline-block text-xs font-semibold text-[var(--accent)] hover:underline">
            {secondaryAction.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

function Statement({ kind }: { kind: 'SHOPPING' | 'INCOME' }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after: string | null) => {
    const qs = after ? `?cursor=${encodeURIComponent(after)}` : '';
    const page = await api<Statement>(`/me/wallet/${kind.toLowerCase()}${qs}`);
    // Appended, never replaced: a cursor page is the next slice, and replacing
    // would make "Load more" look like it lost everything above it.
    setEntries((prev) => (after ? [...prev, ...page.entries] : page.entries));
    setCursor(page.nextCursor);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    (async () => {
      try {
        await load(null);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the statement.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const more = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch {
      setError('Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />)}
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>;
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        body={
          kind === 'SHOPPING'
            ? 'Once a recharge is approved it will appear here, along with every order it pays for.'
            : 'Income appears here once an order you or your team placed has been delivered.'
        }
        action={
          kind === 'SHOPPING' ? (
            <Link href="/recharge" className="rounded-xl bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--gold-pale)]">
              Add money
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <section>
      <h2 className="font-serif text-xl text-[var(--ink)]">
        {kind === 'SHOPPING' ? 'Shopping' : 'Income'} statement
      </h2>

      <ul className="mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--ink)]">{e.label}</p>
              <p className="mt-0.5 text-xs text-[var(--faint)]">{formatDate(e.at, { time: true })}</p>
              {e.note && <p className="mt-1 text-xs text-[var(--muted)]">{e.note}</p>}
              {/* Only orders get a link. A recharge or a withdrawal reference is
                  an internal id with no page of its own to reach. */}
              {e.ref?.type === 'order' && (
                <Link href={`/orders/${e.ref.id}`} className="mt-1 inline-block text-xs font-semibold text-[var(--accent)] hover:underline">
                  View order →
                </Link>
              )}
            </div>

            <div className="shrink-0 text-right">
              <p className={`font-semibold ${e.direction === 'CREDIT' ? 'text-[#2C6B52]' : 'text-[var(--ink)]'}`}>
                {e.direction === 'CREDIT' ? '+' : '−'}{showMoney(e.amount)}
              </p>
              {/* The running balance is stored on the entry, so this is what was
                  true at that moment — not a figure derived now from a
                  different set of rows. */}
              <p className="mt-0.5 text-xs text-[var(--faint)]">
                Balance {showMoney(e.balanceAfter)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          onClick={more}
          disabled={loadingMore}
          className="mt-4 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:text-[var(--faint)]"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
