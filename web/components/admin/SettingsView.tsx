'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, AdminError } from './AdminShell';

/**
 * Store-level settings. Just AI for now — see `StoreSetting` in the schema,
 * which was built as a general key/value store and had never been written to
 * until this.
 *
 * The Gemini key is the client's own: entered here, encrypted at rest the
 * same way a member's bank details are, and never sent back to the browser
 * again after it's saved — the console can confirm a key ending in ...1a2b is
 * configured, not show the key itself.
 */

interface AiStatus { configured: boolean; last4: string | null }

interface PaymentStatus {
  upiId: string;
  payeeName: string;
  minRecharge: { amount: string };
  maxRecharge: { amount: string };
  note: string;
  qrUrl: string | null;
}

export function SettingsView() {
  return (
    <AdminShell title="Settings" subtitle="Store-level configuration." permission="settings.manage">
      <div className="space-y-6">
        <TwoFactorSettings />
        <PaymentSettings />
        <AiSettings />
      </div>
    </AdminShell>
  );
}

interface AdminMe { totpEnabled: boolean }
interface TotpSetup { secret: string; otpauthUrl: string; qrUrl: string }

/**
 * Two-factor enrolment.
 *
 * The console has nagged about this being off since the day it was built
 * (see the banner in AdminShell), but nothing behind that banner ever let an
 * admin actually turn it on — `totpProvisioningUri()` existed, unused, since
 * the schema was written. This is that missing other half.
 */
function TwoFactorSettings() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<AdminMe>('/admin/auth/me').then(setMe).catch(() => setMe(null));
  useEffect(() => { load(); }, []);

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
      setSetup(null);
      setCode('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm that code.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/admin/auth/totp/disable', { method: 'POST', body: { password } });
      setDisabling(false);
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Two-factor authentication</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            An authenticator app code, in addition to your password, on every sign-in. Required in
            spirit on any account that can approve payments — this is what actually turns it on.
          </p>
        </div>
        {me && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            me.totpEnabled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {me.totpEnabled ? 'Enabled' : 'Not enabled'}
          </span>
        )}
      </div>

      {error && <AdminError message={error} />}

      {me && !me.totpEnabled && !setup && (
        <button
          type="button"
          onClick={startSetup}
          disabled={busy}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {busy ? 'Starting…' : 'Enable two-factor authentication'}
        </button>
      )}

      {setup && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-neutral-700">
            Scan this with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code
            it shows.
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
              {busy ? 'Confirming…' : 'Confirm and enable'}
            </button>
            <button
              type="button"
              onClick={() => { setSetup(null); setError(null); }}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {me?.totpEnabled && !disabling && (
        <button
          type="button"
          onClick={() => setDisabling(true)}
          className="mt-4 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          Turn off
        </button>
      )}

      {disabling && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-neutral-800">
            Confirm your password to turn it off
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmDisable}
              disabled={!password.trim() || busy}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-red-200"
            >
              {busy ? 'Turning off…' : 'Turn off 2FA'}
            </button>
            <button
              type="button"
              onClick={() => { setDisabling(false); setPassword(''); setError(null); }}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentSettings() {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [form, setForm] = useState({ upiId: '', payeeName: '', minRecharge: '', maxRecharge: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => api<PaymentStatus>('/admin/settings/payment').then((s) => {
    setStatus(s);
    setForm({
      upiId: s.upiId, payeeName: s.payeeName,
      minRecharge: s.minRecharge.amount, maxRecharge: s.maxRecharge.amount, note: s.note,
    });
  }).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api('/admin/settings/payment', { method: 'POST', body: form });
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save payment settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Payment (recharge QR)</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        The UPI ID and QR every member sees on the wallet recharge screen. This is where their
        payment actually lands — double-check the preview scans to the right account before
        relying on it.
      </p>

      {error && <AdminError message={error} />}
      {saved && !error && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700">Saved.</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-neutral-800">
          UPI ID
          <input
            value={form.upiId}
            onChange={(e) => setForm((f) => ({ ...f, upiId: e.target.value }))}
            placeholder="yourname@bank"
            autoComplete="off"
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 font-mono text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Payee name
          <input
            value={form.payeeName}
            onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Minimum recharge (₹)
          <input
            value={form.minRecharge}
            onChange={(e) => setForm((f) => ({ ...f, minRecharge: e.target.value.replace(/[^\d.]/g, '') }))}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Maximum recharge (₹)
          <input
            value={form.maxRecharge}
            onChange={(e) => setForm((f) => ({ ...f, maxRecharge: e.target.value.replace(/[^\d.]/g, '') }))}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
      </div>

      <label className="mt-4 block text-sm font-medium text-neutral-800">
        Note shown under the QR
        <textarea
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <button
          type="button"
          onClick={save}
          disabled={!form.upiId.trim() || !form.payeeName.trim() || saving}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {status?.qrUrl && (
          <div className="flex items-center gap-3 rounded-lg border border-neutral-200 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, not an app asset next/image can optimise */}
            <img src={status.qrUrl} alt="Current recharge QR preview" className="h-20 w-20" />
            <div className="text-xs text-neutral-500">
              <div className="font-semibold text-neutral-800">Live preview</div>
              What members see right now.
            </div>
          </div>
        )}
        {status && !status.qrUrl && (
          <p className="text-xs text-neutral-500">No UPI ID saved yet — members see &quot;payment is not configured&quot; instead of a QR.</p>
        )}
      </div>
    </div>
  );
}

function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = () => api<AiStatus>('/admin/settings/ai').then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!key.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api('/admin/settings/ai', { method: 'POST', body: { apiKey: key.trim() } });
      setKey('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that key.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await api('/admin/settings/ai/clear', { method: 'POST', body: {} });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that key.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="max-w-xl rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">AI shade finder</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            Lets a member upload a selfie and get shade suggestions from the current makeup
            catalogue. Runs on your own Google Gemini API key — nothing is bundled, and every
            call is billed to your Google account, not ours.
          </p>
        </div>
        {status && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            status.configured ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'
          }`}>
            {status.configured ? `Connected · …${status.last4}` : 'Not configured'}
          </span>
        )}
      </div>

      {error && <AdminError message={error} />}

      <label className="mt-4 block text-sm font-medium text-neutral-800">
        {status?.configured ? 'Replace the key' : 'Gemini API key'}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="AIza..."
          autoComplete="off"
          className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 font-mono text-sm focus:border-neutral-900 focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!key.trim() || saving}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {saving ? 'Saving…' : 'Save key'}
        </button>
        {status?.configured && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? 'Removing…' : 'Remove key'}
          </button>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        Get a key from{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold text-neutral-800 underline">
          Google AI Studio
        </a>
        . Without one, the shade finder shows members a plain "not set up yet" message rather
        than an error — the rest of the site is unaffected either way.
      </p>
    </div>
  );
}
