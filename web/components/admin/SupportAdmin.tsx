'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, TableSkeleton } from './AdminShell';

/**
 * The support inbox. Tickets are listed oldest first within each status so nothing
 * waits behind newer ones; the two clocks the rules set (acknowledge within 48 hours,
 * resolve within a month) are shown per ticket and turn red when missed.
 */

interface Reply { id: string; from: 'MEMBER' | 'GUEST' | 'ADMIN'; body: string; at: string }
interface Ticket {
  id: string; ticketNo: string; category: string; subject: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  createdAt: string; acknowledgedAt: string | null; acknowledgeBy: string; resolveBy: string;
  overdueAck: boolean; overdueResolve: boolean; name: string; contact: string; memberCode: string | null; replies: Reply[];
}

const FILTERS = [{ k: '', l: 'All' }, { k: 'OPEN', l: 'Open' }, { k: 'IN_PROGRESS', l: 'In progress' }, { k: 'RESOLVED', l: 'Resolved' }];
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function SupportAdminView() {
  return (
    <AdminShell title="Support" subtitle="Questions and complaints. Acknowledge within 48 hours, resolve within a month." permission="support.manage">
      <Inbox />
    </AdminShell>
  );
}

function Inbox() {
  const [filter, setFilter] = useState('OPEN');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    try { setTickets(await api<Ticket[]>(`/admin/support${filter ? `?status=${filter}` : ''}`)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load tickets.'); }
  };
  useEffect(() => { setTickets(null); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.k} type="button" onClick={() => setFilter(f.k)} aria-pressed={filter === f.k}
            className={`rounded-full border px-4 py-1.5 text-sm ${filter === f.k ? 'border-neutral-900 bg-neutral-900 font-semibold text-white' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}>{f.l}</button>
        ))}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!tickets && !error && <TableSkeleton rows={4} />}
      {tickets && tickets.length === 0 && <p className="text-sm text-neutral-500">Nothing here.</p>}
      {tickets && tickets.map((t) => (
        <Panel key={t.id} title={`${t.ticketNo} - ${t.subject}`} action={
          <button type="button" onClick={() => setOpenId(openId === t.id ? null : t.id)} className="text-xs font-semibold text-neutral-700 hover:underline">{openId === t.id ? 'Close' : 'Open'}</button>
        }>
          <p className="text-xs text-neutral-500">
            {t.name}{t.memberCode ? ` (${t.memberCode})` : ' (visitor)'} - {t.contact} - {t.category} - {when(t.createdAt)}
          </p>
          <p className="mt-1 text-xs">
            <span className={t.status === 'RESOLVED' ? 'text-green-700' : 'text-neutral-600'}>{t.status.replace('_', ' ').toLowerCase()}</span>
            {t.status !== 'RESOLVED' && !t.acknowledgedAt && (
              <span className={`ml-3 ${t.overdueAck ? 'font-semibold text-red-700' : 'text-amber-700'}`}>{t.overdueAck ? 'Acknowledgement overdue' : `Acknowledge by ${when(t.acknowledgeBy)}`}</span>
            )}
            {t.overdueResolve && <span className="ml-3 font-semibold text-red-700">Resolution overdue</span>}
          </p>
          {openId === t.id && <Thread t={t} onChanged={load} />}
        </Panel>
      ))}
    </div>
  );
}

function Thread({ t, onChanged }: { t: Ticket; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 space-y-3">
      <ul className="space-y-2">
        {t.replies.map((r) => (
          <li key={r.id} className={`rounded-lg px-3 py-2 text-sm ${r.from === 'ADMIN' ? 'bg-neutral-100' : 'bg-amber-50'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{r.from === 'ADMIN' ? 'Staff' : r.from === 'GUEST' ? 'Visitor' : 'Member'} - {when(r.at)}</p>
            <p className="mt-0.5 whitespace-pre-line text-neutral-800">{r.body}</p>
          </li>
        ))}
      </ul>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="Write a reply" aria-label="Reply"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || body.trim().length < 10} onClick={() => run(async () => { await api(`/admin/support/${t.id}/reply`, { method: 'POST', body: { body } }); setBody(''); })}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-neutral-300">Send reply</button>
        {t.status !== 'RESOLVED' ? (
          <button type="button" disabled={busy} onClick={() => run(() => api(`/admin/support/${t.id}/status`, { method: 'POST', body: { status: 'RESOLVED' } }))}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50">Mark resolved</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => run(() => api(`/admin/support/${t.id}/status`, { method: 'POST', body: { status: 'OPEN' } }))}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-100 disabled:opacity-50">Re-open</button>
        )}
        <span className="self-center text-[11px] text-neutral-400">The person is notified of replies and when it is resolved.</span>
      </div>
    </div>
  );
}
