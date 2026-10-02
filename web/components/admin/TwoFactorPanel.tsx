'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AdminError } from './AdminShell';

interface AdminMe { totpEnabled: boolean }
interface TotpSetup { secret: string; otpauthUrl: string; qrUrl: string }

/**
 * Two-factor enrolment for the signed-in admin.
 *
 * Required on every admin account: until it is on, the API refuses everything
 * in the console except this. Once confirmed, every session is ended, so the
 * next sign-in is the first one that asks for a code. It cannot be switched
 * off here; a lost phone is cleared by another admin (Roles & admins).
 */
export function TwoFactorPanel({ forced = false }: { forced?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<AdminMe>('/admin/auth/me').then(setMe).catch(() => setMe(null)); }, []);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<TotpSetup>('/admin/auth/totp/setup', { method: 'POST', body: {} }));
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/auth/totp/enable', { method: 'POST', body: { code } });
      // Every session was just ended on the server; go and sign in with the first code.
      router.replace('/admin/login?notice=2fa');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm that code.');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Two-factor sign-in</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            A code from an authenticator app, as well as your password, on every sign-in. It is
            required on every admin account, because these accounts can approve payments.
          </p>
        </div>
        {me && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${me.totpEnabled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {me.totpEnabled ? 'On' : 'Not set up'}
          </span>
        )}
      </div>

      {forced && !me?.totpEnabled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You need to set this up before you can use the console. It takes about a minute.
        </p>
      )}

      {error && <div className="mt-3"><AdminError message={error} /></div>}

      {me?.totpEnabled && (
        <p className="mt-4 text-sm text-neutral-700">
          It is on for your account. If you change phones or lose the app, another admin can reset it under Roles &amp; admins, and you set it up again.
        </p>
      )}

      {me && !me.totpEnabled && !setup && (
        <button
          type="button"
          onClick={startSetup}
          disabled={busy}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {busy ? 'Starting…' : 'Set up two-factor sign-in'}
        </button>
      )}

      {setup && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-neutral-700">
            Scan this with Google Authenticator, Authy, or any authenticator app, then enter the 6-digit code it shows.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, not an app asset next/image can optimise */}
            <img src={setup.qrUrl} alt="Scan with your authenticator app" className="h-40 w-40 rounded-lg border border-neutral-200" />
            <div className="text-xs text-neutral-500">
              <div className="font-semibold text-neutral-700">Can&apos;t scan it?</div>
              <div className="mt-1">Enter this key manually:</div>
              <div className="mt-1 break-all rounded bg-neutral-50 px-2 py-1 font-mono text-neutral-800">{setup.secret}</div>
            </div>
          </div>
          <label className="block text-sm font-medium text-neutral-800">
            6-digit code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              autoComplete="off"
              className="mt-1.5 w-40 rounded-lg border border-neutral-300 px-3 py-2.5 font-mono text-sm tracking-widest focus:border-neutral-900 focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmSetup}
              disabled={code.length !== 6 || busy}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
            >
              {busy ? 'Confirming…' : 'Confirm and turn on'}
            </button>
            <button
              type="button"
              onClick={() => { setSetup(null); setError(null); }}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-neutral-500">After this you will be signed out once and asked for a code the next time you sign in.</p>
        </div>
      )}
    </div>
  );
}
