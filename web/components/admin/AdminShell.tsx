'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * The admin console frame.
 *
 * Role handling here is **presentation only**. Every admin API route carries
 * its own `@AdminOnly(...)` on the server, so hiding a nav item and refusing an
 * action are two independent mechanisms and neither relies on the other. A
 * FINANCE user who types `/admin/plan` into the address bar gets a 403 from the
 * API, not a plan editor — this shell just spares them the trip.
 *
 * That separation is the point. A console that enforces permissions in the
 * browser is a console whose permissions can be turned off with devtools.
 */

export type AdminRole = 'ADMIN' | 'FINANCE' | 'SUPPORT';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

const AdminContext = createContext<AdminUser | null>(null);

export function useAdmin(): AdminUser {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error('useAdmin must be used inside <AdminShell>');
  return admin;
}

/** Which roles the server will accept for each area, mirrored for the nav. */
const NAV: { href: string; label: string; roles: AdminRole[] }[] = [
  { href: '/admin', label: 'Dashboard', roles: ['ADMIN', 'FINANCE', 'SUPPORT'] },
  { href: '/admin/recharges', label: 'Recharges', roles: ['ADMIN', 'FINANCE'] },
  { href: '/admin/orders', label: 'Orders', roles: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/withdrawals', label: 'Withdrawals', roles: ['ADMIN', 'FINANCE'] },
  { href: '/admin/mobile-recharges', label: 'Mobile recharges', roles: ['ADMIN', 'FINANCE'] },
  { href: '/admin/security-alerts', label: 'Security alerts', roles: ['ADMIN', 'FINANCE', 'SUPPORT'] },
  { href: '/admin/catalog', label: 'Catalogue', roles: ['ADMIN'] },
  { href: '/admin/coupons', label: 'Coupons', roles: ['ADMIN', 'FINANCE'] },
  { href: '/admin/plan', label: 'Plan', roles: ['ADMIN'] },
  { href: '/admin/settings', label: 'Settings', roles: ['ADMIN'] },
  // Still no 'Reports' link: the API's ReportController (GET /reports/:key)
  // is a general ad-hoc query/aggregation tool (see reporting/catalog.ts) —
  // the old prototype/ReportBuilder.jsx was the only UI that ever called it,
  // and that file was removed as dead code (see AUDIT_FIXES.md). The one
  // piece of it that was actually load-bearing — the dashboard's "Security
  // alerts" count having nowhere to click through to — is now its own real
  // page above. The rest (ad-hoc dimension/measure queries) stays unbuilt
  // until someone actually asks for it.
];

export function AdminShell({
  title,
  subtitle,
  /** Roles this page needs. The server checks too; this avoids a dead render. */
  roles,
  children,
}: {
  title: string;
  subtitle?: string;
  roles?: AdminRole[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<AdminUser>('/admin/auth/me');
        if (!cancelled) setAdmin(me);
      } catch (err) {
        if (cancelled) return;
        // A 401 has already redirected to the member login by the time this
        // runs, which is the wrong door for an admin. Send them to theirs.
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load the console.');
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-sm text-[#C0392B]">{error}</p>
        <Link href="/admin/login" className="mt-4 inline-block text-sm font-semibold text-[#B84654] hover:underline">
          Sign in again
        </Link>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-neutral-200" />
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100" />)}
        </div>
      </div>
    );
  }

  const allowed = !roles || roles.includes(admin.role);
  const visibleNav = NAV.filter((n) => n.roles.includes(admin.role));

  return (
    <AdminContext.Provider value={admin}>
      {/* Deliberately not the storefront's palette. An admin acting on real
          money should never be one glance away from thinking they are looking
          at the shop. */}
      <div className="min-h-screen bg-[#F7F7F8]">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/admin" className="text-sm font-semibold tracking-tight text-neutral-900">
              Majestic Cart <span className="text-neutral-400">admin</span>
            </Link>

            <nav aria-label="Admin" className="hidden gap-0.5 md:flex">
              {visibleNav.map((n) => {
                const active = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="text-neutral-500">
                {admin.name} · <span className="font-semibold text-neutral-700">{admin.role}</span>
              </span>
              <SignOut />
            </div>
          </div>

          {/* Mobile nav, so a rejection can be handled from a phone — which is
              where an admin will be when a member is waiting on them. */}
          <nav aria-label="Admin" className="flex gap-0.5 overflow-x-auto border-t border-neutral-200 px-4 py-2 md:hidden">
            {visibleNav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-neutral-600">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>

        {/* 2FA is a contractual promise on an account that can move money.
            Nagging beats a quiet gap. */}
        {!admin.totpEnabled && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
            <p className="mx-auto max-w-6xl text-xs text-amber-900">
              Two-factor authentication is not enabled on this account. It should be, on any account
              that can approve payments.{' '}
              <Link href="/admin/settings" className="font-semibold underline">Turn it on</Link>.
            </p>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
            </div>
          </div>

          <div className="mt-6">
            {allowed ? children : (
              <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
                <p className="text-sm text-neutral-600">
                  Your role ({admin.role}) does not have access to this area.
                </p>
                <Link href="/admin" className="mt-3 inline-block text-sm font-semibold text-neutral-900 hover:underline">
                  Back to the dashboard
                </Link>
              </div>
            )}
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}

function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // The refresh token is an httpOnly cookie, so the server clears it. A
        // failure here still ends the session client-side rather than leaving
        // the admin apparently signed in.
        try { await api('/admin/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
        router.replace('/admin/login');
      }}
      className="rounded-lg border border-neutral-300 px-2.5 py-1 font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400"
    >
      {busy ? '…' : 'Sign out'}
    </button>
  );
}

/* --------------------------------------------------------------- pieces */

export function Panel({
  title, children, action, tone,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'alert';
}) {
  return (
    <section className={`rounded-xl border bg-white ${tone === 'alert' ? 'border-red-300' : 'border-neutral-200'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function AdminEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
      {children}
    </p>
  );
}

export function AdminError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />
      ))}
    </div>
  );
}
