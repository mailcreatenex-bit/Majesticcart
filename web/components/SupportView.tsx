'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { MemberShell } from './MemberShell';

/**
 * A member's support tickets: raise one, follow the replies, answer back.
 *
 * Each ticket shows the two dates a complaint is held to - acknowledged within 48
 * hours, resolved within a month - so a member can see what to expect.
 */

export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  ORDER: 'An order or delivery', WALLET: 'Wallet, recharge or withdrawal', ACCOUNT: 'My account',
  PLAN: 'The plan or my income', COMPLAINT: 'A complaint', OTHER: 'Something else',
};

interface Ticket {
  id: string; ticketNo: string; category: string; subject: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  createdAt: string; acknowledgedAt: string | null; resolvedAt: string | null; acknowledgeBy: string; resolveBy: string;
  replies: { id: string; from: 'MEMBER' | 'GUEST' | 'ADMIN'; body: string; at: string }[];
}

const STATUS_TEXT = { OPEN: 'Open', IN_PROGRESS: 'We are on it', RESOLVED: 'Resolved' } as const;
const STATUS_STYLE = { OPEN: 'bg-[#FDF3DC] text-[#9A6A08]', IN_PROGRESS: 'bg-[#E6F0FB] text-[#1F5DA8]', RESOLVED: 'bg-[#E8F5EC] text-[#1F7A3D]' } as const;

export function SupportView() {
  return (
    <MemberShell title="Support">
      {() => <Support />}
    </MemberShell>
  );
}

function Support() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try { setTickets(await api<Ticket[]>('/support')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load your tickets.'); setTickets([]); }
  };
  useEffect(() => { void load(); }, []);

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm leading-relaxed text-[var(--body)]">
        Ask a question or raise a complaint. We acknowledge every ticket within 48 hours and aim to resolve it within a month.
      </p>
      {error && <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>}

      {showForm ? (
        <NewTicket onDone={async () => { setShowForm(false); await load(); }} onCancel={() => setShowForm(false)} />
      ) : (
        <button type="button" onClick={() => setShowForm(true)} className="rounded-xl gold-foil px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20">New ticket</button>
      )}

      {tickets === null ? (
        <div className="h-24 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
      ) : tickets.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">You have no tickets.</p>
      ) : (
        <ul className="space-y-4">
          {tickets.map((t) => <TicketCard key={t.id} t={t} onChanged={load} />)}
        </ul>
      )}
    </div>
  );
}

function NewTicket({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [category, setCategory] = useState('ORDER');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await api('/support', { method: 'POST', body: { category, subject, message } }); await onDone(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send your ticket.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-serif text-lg text-[var(--ink)]">New ticket</h2>
      <label className="mt-3 block text-xs uppercase tracking-wider text-[var(--faint)]" htmlFor="tk-cat">About</label>
      <select id="tk-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)]">
        {Object.entries(TICKET_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Subject" aria-label="Subject" className="mt-3 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={5} placeholder="What happened? Include an order number if there is one." aria-label="Message" className="mt-3 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none" />
      {error && <p role="alert" className="mt-2 text-sm text-[#C0392B]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} disabled={busy} className="rounded-xl gold-foil px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">Cancel</button>
      </div>
    </section>
  );
}

function TicketCard({ t, onChanged }: { t: Ticket; onChanged: () => Promise<void> }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try { await api(`/support/${t.id}/reply`, { method: 'POST', body: { body: reply } }); setReply(''); await onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send your reply.'); }
    finally { setBusy(false); }
  };

  return (
    <li className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--ink)]">{t.subject}</p>
          <p className="text-xs text-[var(--faint)]">{t.ticketNo} · {TICKET_CATEGORY_LABEL[t.category] ?? t.category} · {formatDate(t.createdAt)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[t.status]}`}>{STATUS_TEXT[t.status]}</span>
      </div>
      <ul className="mt-4 space-y-3">
        {t.replies.map((r) => (
          <li key={r.id} className={`rounded-xl px-4 py-3 text-sm ${r.from === 'ADMIN' ? 'bg-[var(--accent-soft)]' : 'bg-[var(--surface-tint)]'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{r.from === 'ADMIN' ? 'Majestic Cart' : 'You'} · {formatDate(r.at)}</p>
            <p className="mt-1 whitespace-pre-line text-[var(--body)]">{r.body}</p>
          </li>
        ))}
      </ul>
      {t.status !== 'RESOLVED' && !t.acknowledgedAt && (
        <p className="mt-3 text-xs text-[var(--muted)]">We will acknowledge this by {formatDate(t.acknowledgeBy)}.</p>
      )}
      <div className="mt-3 flex gap-2">
        <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} placeholder={t.status === 'RESOLVED' ? 'Reply to re-open' : 'Add a reply'} aria-label="Reply" className="min-w-0 flex-1 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none" />
        <button type="button" onClick={send} disabled={busy || reply.trim().length < 10} className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--gold-pale)] disabled:opacity-40">Reply</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[#C0392B]">{error}</p>}
    </li>
  );
}
