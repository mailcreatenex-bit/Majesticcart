'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, AdminError, TableSkeleton } from './AdminShell';
import { TwoFactorPanel } from './TwoFactorPanel';

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
        <TwoFactorPanel />
        <CompanySettings />
        <PaymentSettings />
        <AiSettings />
      </div>
    </AdminShell>
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

interface CompanyInfo {
  tradeName: string;
  legalName: string;
  entityType: string;
  registrationNumber: string;
  gstin: string;
  registeredAddress: string;
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  grievanceOfficer: { name: string; designation: string; email: string; phone: string; address: string };
}

const EMPTY_COMPANY: CompanyInfo = {
  tradeName: '', legalName: '', entityType: '', registrationNumber: '', gstin: '', registeredAddress: '',
  supportEmail: '', supportPhone: '', supportHours: '',
  grievanceOfficer: { name: '', designation: '', email: '', phone: '', address: '' },
};

/**
 * The business's legal identity and grievance contact — shown on the contact
 * page, the site footer, the FAQ, and spliced into the Terms and Privacy
 * Policy. This used to be a hardcoded constant a developer had to edit and
 * redeploy; it's the last of the identified "everything should be editable"
 * gaps that carries real legal weight (Consumer Protection E-Commerce Rules
 * disclosures), so getting a field wrong here is worth double-checking
 * before saving.
 */
function CompanySettings() {
  const [form, setForm] = useState<CompanyInfo>(EMPTY_COMPANY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => api<CompanyInfo>('/admin/settings/company').then((c) => { setForm(c); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api('/admin/settings/company', { method: 'POST', body: form });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save company details.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Omit<CompanyInfo, 'grievanceOfficer'>) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const officerField = (key: keyof CompanyInfo['grievanceOfficer']) => ({
    value: form.grievanceOfficer[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, grievanceOfficer: { ...f.grievanceOfficer, [key]: e.target.value } })),
  });
  const inputClass = 'mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none';
  const labelClass = 'block text-sm font-medium text-neutral-800';

  if (!loaded) return <div className="max-w-xl rounded-xl border border-neutral-200 bg-white p-5"><TableSkeleton rows={3} /></div>;

  return (
    <div className="max-w-2xl rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Company &amp; legal details</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Shown on the contact page, the site footer, the FAQ, and spliced into the Terms and Privacy
        Policy. This is regulator-facing information under the Consumer Protection (E-Commerce)
        Rules — keep it accurate.
      </p>

      {error && <AdminError message={error} />}
      {saved && !error && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700">Saved. Changes are live immediately.</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Trade name<input {...field('tradeName')} className={inputClass} /></label>
        <label className={labelClass}>Legal name<input {...field('legalName')} className={inputClass} /></label>
        <label className={labelClass}>Entity type<input {...field('entityType')} placeholder="Private Limited / LLP / Proprietorship" className={inputClass} /></label>
        <label className={labelClass}>Registration number<input {...field('registrationNumber')} placeholder="Udyam / CIN" className={inputClass} /></label>
        <label className={labelClass}>GSTIN<input {...field('gstin')} className={inputClass} /></label>
        <label className={labelClass}>Support hours<input {...field('supportHours')} className={inputClass} /></label>
        <label className={`${labelClass} sm:col-span-2`}>Registered address<input {...field('registeredAddress')} className={inputClass} /></label>
        <label className={labelClass}>Support email<input {...field('supportEmail')} type="email" className={inputClass} /></label>
        <label className={labelClass}>Support phone<input {...field('supportPhone')} className={inputClass} /></label>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-neutral-900">Grievance officer</h3>
      <p className="mt-1 text-xs text-neutral-500">Named contact required by the E-Commerce and Direct Selling Rules.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Name<input {...officerField('name')} className={inputClass} /></label>
        <label className={labelClass}>Designation<input {...officerField('designation')} className={inputClass} /></label>
        <label className={labelClass}>Email<input {...officerField('email')} type="email" className={inputClass} /></label>
        <label className={labelClass}>Phone<input {...officerField('phone')} className={inputClass} /></label>
        <label className={`${labelClass} sm:col-span-2`}>Address for written complaints<input {...officerField('address')} className={inputClass} /></label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!form.legalName.trim() || !form.supportEmail.trim() || saving}
        className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
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
