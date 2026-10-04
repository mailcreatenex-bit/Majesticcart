'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, AdminError, Panel, TableSkeleton } from './AdminShell';

/**
 * Where the delivery company, SMS, WhatsApp, email and alert settings are entered.
 *
 * Keys are saved encrypted and never shown again: a saved key appears as "saved, ending
 * in 1a2b", and typing a new one replaces it. Leaving a key box empty keeps what is saved.
 */

interface FieldStatus { set: boolean; value?: string; last4?: string }
type Status = Record<string, Record<string, FieldStatus>>;
interface Overview { status: Status; live: { sms: boolean; whatsapp: boolean; email: boolean; courier: boolean } }

interface Field { key: string; label: string; secret?: boolean; hint?: string; placeholder?: string }
interface Section {
  id: 'courier' | 'sms' | 'whatsapp' | 'email' | 'alerts';
  title: string;
  intro: string;
  fields: Field[];
  /** Test buttons: path under /admin/integrations and what to ask for. */
  test?: { path: string; label: string; ask?: 'phone' | 'email' };
  liveKey?: keyof Overview['live'];
}

const SECTIONS: Section[] = [
  {
    id: 'courier',
    title: 'Delivery company',
    intro: 'Enter the keys from Delhivery and/or Shiprocket. Members then see live parcel scans on their order page, the product page can check pincodes, and a delivered parcel can mark the order delivered by itself. You can add or change these at any time.',
    liveKey: 'courier',
    test: { path: 'courier/test', label: 'Test the keys' },
    fields: [
      { key: 'delhiveryToken', label: 'Delhivery API token', secret: true, hint: 'From your Delhivery account, under API access.' },
      { key: 'shiprocketEmail', label: 'Shiprocket login email', hint: 'Use an API user created in Shiprocket, not your main login.' },
      { key: 'shiprocketPassword', label: 'Shiprocket password', secret: true },
      { key: 'webhookSecret', label: 'Webhook secret', secret: true, hint: 'Any long random text. Give the same text to the courier, and point its webhook at /api/webhooks/courier with a header named x-courier-secret.' },
      { key: 'etaText', label: 'Delivery time shown to customers', placeholder: '3 to 7 working days', hint: 'Shown on the product page after a pincode check.' },
    ],
  },
  {
    id: 'sms',
    title: 'SMS (verification codes and order updates)',
    intro: 'Your SMS provider\'s address and key. Indian SMS needs DLT registration, a sender ID and an approved template: your provider will give you these. Until this is set, verification codes are not sent to phones.',
    liveKey: 'sms',
    test: { path: 'sms/test', label: 'Send a test SMS', ask: 'phone' },
    fields: [
      { key: 'endpoint', label: 'Provider address', placeholder: 'https://…', hint: 'The web address the provider tells you to send messages to.' },
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'senderId', label: 'Sender ID', placeholder: 'MJSTIC' },
      { key: 'templateId', label: 'Template ID', hint: 'The DLT template for the verification code message.' },
    ],
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp (order and wallet updates)',
    intro: 'Your WhatsApp Business provider\'s address and token. Members who have messages on get shipped and delivered updates here.',
    liveKey: 'whatsapp',
    test: { path: 'whatsapp/test', label: 'Send a test message', ask: 'phone' },
    fields: [
      { key: 'endpoint', label: 'Provider address', placeholder: 'https://…' },
      { key: 'token', label: 'Access token', secret: true },
      { key: 'template', label: 'Template name (if your provider needs one)' },
    ],
  },
  {
    id: 'email',
    title: 'Email (password reset and sign-up)',
    intro: 'A Resend API key, to send verification emails.',
    liveKey: 'email',
    test: { path: 'email/test', label: 'Send a test email', ask: 'email' },
    fields: [
      { key: 'apiKey', label: 'Resend API key', secret: true },
      { key: 'from', label: 'Send from', placeholder: 'Majestic Cart <hello@yourdomain.in>', hint: 'Must be an address on a domain you have verified with Resend.' },
    ],
  },
  {
    id: 'alerts',
    title: 'Error alerts',
    intro: 'When the site hits a new kind of error, an email goes here (needs email set up above). Errors are also listed under Errors in this console.',
    fields: [{ key: 'email', label: 'Send alerts to', placeholder: 'you@yourdomain.in' }],
  },
];

export function IntegrationsAdminView() {
  return (
    <AdminShell title="Integrations" subtitle="Delivery company, SMS, WhatsApp and email keys. Saved encrypted." permission="settings.manage">
      <Integrations />
    </AdminShell>
  );
}

function Integrations() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/admin/integrations'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the settings.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <AdminError message={error} />;
  if (!data) return <TableSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      {SECTIONS.map((s) => (
        <SectionForm key={s.id} section={s} status={data.status[s.id]} live={s.liveKey ? data.live[s.liveKey] : undefined} onSaved={load} />
      ))}
    </div>
  );
}

function SectionForm({ section, status, live, onSaved }: { section: Section; status: Record<string, FieldStatus>; live?: boolean; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState('');

  // Plain fields start with what is saved; secret fields start empty (they are never sent back).
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const f of section.fields) if (!f.secret) init[f.key] = status[f.key]?.value ?? '';
    setForm(init);
  }, [section, status]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {};
      for (const f of section.fields) {
        const v = (form[f.key] ?? '').trim();
        // A blank secret box means "keep what is saved"; a blank plain box clears it.
        if (f.secret && v === '') continue;
        body[f.key] = v;
      }
      await api(`/admin/integrations/${section.id}`, { method: 'PUT', body });
      setMessage({ ok: true, text: 'Saved.' });
      setForm((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, section.fields.find((f) => f.key === k)?.secret ? '' : v])));
      await onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const clearSecret = async (key: string) => {
    if (!window.confirm('Remove the saved key? Anything that depends on it stops until you add a new one.')) return;
    setBusy(true);
    try {
      await api(`/admin/integrations/${section.id}`, { method: 'PUT', body: { [key]: null } });
      await onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not remove it.' });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!section.test) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = section.test.ask === 'phone' ? { phone: target } : section.test.ask === 'email' ? { to: target } : {};
      const r = await api<{ message?: string; results?: { courier: string; ok: boolean; message: string }[] }>(`/admin/integrations/${section.test.path}`, { method: 'POST', body });
      if (r.results) setMessage({ ok: r.results.every((x) => x.ok), text: r.results.map((x) => x.message).join(' ') });
      else setMessage({ ok: true, text: r.message ?? 'Done.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'The test failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={section.title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-neutral-500">{section.intro}</p>
        {live !== undefined && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${live ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {live ? 'On' : 'Not set up'}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {section.fields.map((f) => {
          const st = status[f.key];
          return (
            <label key={f.key} className="block text-sm font-medium text-neutral-800">
              {f.label}
              {f.secret && st?.set && (
                <span className="ml-2 text-xs font-normal text-green-700">
                  saved, ending in {st.last4}{' '}
                  <button type="button" onClick={() => clearSecret(f.key)} disabled={busy} className="ml-1 text-red-700 underline">remove</button>
                </span>
              )}
              <input
                type={f.secret ? 'password' : 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.secret ? (st?.set ? 'Type a new one to replace it' : f.placeholder ?? '') : f.placeholder}
                autoComplete="off"
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none"
              />
              {f.hint && <span className="mt-1 block text-xs font-normal text-neutral-500">{f.hint}</span>}
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300">
          {busy ? 'Working…' : 'Save'}
        </button>
        {section.test && (
          <>
            {section.test.ask && (
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={section.test.ask === 'phone' ? 'Your mobile number' : 'Your email'}
                className="w-48 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
              />
            )}
            <button type="button" onClick={runTest} disabled={busy || (!!section.test.ask && !target.trim())} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400">
              {section.test.label}
            </button>
          </>
        )}
      </div>
      {message && (
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}
    </Panel>
  );
}
