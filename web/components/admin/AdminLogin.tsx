'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

/**
 * Admin sign-in.
 *
 * Its own page, not a mode of the member login: an admin signs in with an email
 * and a second factor, a member with a phone number and an OTP, and the two
 * have separate lockout counters and separate audit trails. "Five failed
 * attempts" means something very different for each.
 *
 * The TOTP field is always shown rather than revealed after a first failed
 * attempt. Whether 2FA is required is decided by the account on the server, and
 * a two-step reveal would leak which accounts have it enabled — telling an
 * attacker which ones are worth a password-only attempt.
 */
export function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await api('/admin/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password, ...(totpCode ? { totpCode } : {}) },
        // A wrong password here is a 401 too, but it means "try again," not
        // "your session ended" — the api() client's default 401 handling
        // would otherwise bounce this straight back to a blank login page
        // before this catch block ever saw the real message.
        skipAuthRedirect: true,
      });
      // Only a path from this site, never an absolute URL from the query
      // string: `?next=https://evil.example` would otherwise turn the login
      // into an open redirect that arrives with a fresh admin session.
      const target = next && next.startsWith('/admin') ? next : '/admin';
      router.replace(target);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F8] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          Majestic Cart <span className="text-neutral-400">admin</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in to the console.</p>

        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
          <label className="block text-sm font-medium text-neutral-800">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <label className="block text-sm font-medium text-neutral-800">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
          </label>

          <label className="block text-sm font-medium text-neutral-800">
            Authenticator code
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 font-mono tracking-widest text-neutral-900 focus:border-neutral-900 focus:outline-none"
            />
            <span className="mt-1 block text-xs font-normal text-neutral-500">
              Leave blank if two-factor is not set up on your account.
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 font-semibold text-white disabled:bg-neutral-300"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-500">
          Repeated failed attempts lock the account and raise a security alert.
        </p>
      </div>
    </div>
  );
}
