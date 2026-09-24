'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * The contact page's "write to us" form, for a visitor without an account. It creates a
 * support ticket that staff answer from the console, and the visitor gets a ticket
 * number and the date by which they will hear back. Members should use the Support tab
 * in their account, where the replies appear.
 */

const CATEGORIES: Record<string, string> = {
  ORDER: 'An order or delivery', WALLET: 'Wallet, recharge or withdrawal', ACCOUNT: 'My account',
  COMPLAINT: 'A complaint', OTHER: 'Something else',
};

export function ContactForm() {
  const [f, setF] = useState({ name: '', contact: '', category: 'OTHER', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ ticketNo: string }>('/support-public', { method: 'POST', body: f });
      setDone(r.ticketNo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your message. Please try again.');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div role="status" className="rounded-xl bg-[var(--notice-bg)] p-5 text-sm text-[var(--body)]">
        Thank you. Your reference is <strong className="text-[var(--ink)]">{done}</strong>. We acknowledge every message within 48 hours, on the phone number or email you gave.
      </div>
    );
  }

  const input = 'mt-1 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none';
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm text-[var(--body)]">Your name<input required value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} className={input} /></label>
      <label className="text-sm text-[var(--body)]">Phone or email<input required value={f.contact} onChange={(e) => set('contact', e.target.value)} maxLength={120} className={input} /></label>
      <label className="text-sm text-[var(--body)] sm:col-span-2">About
        <select value={f.category} onChange={(e) => set('category', e.target.value)} className={input}>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-sm text-[var(--body)] sm:col-span-2">Subject<input required value={f.subject} onChange={(e) => set('subject', e.target.value)} maxLength={120} className={input} /></label>
      <label className="text-sm text-[var(--body)] sm:col-span-2">Message<textarea required value={f.message} onChange={(e) => set('message', e.target.value)} rows={5} maxLength={2000} className={input} /></label>
      {error && <p role="alert" className="text-sm text-[#C0392B] sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-xl gold-foil px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50">{busy ? 'Sending…' : 'Send message'}</button>
      </div>
    </form>
  );
}
