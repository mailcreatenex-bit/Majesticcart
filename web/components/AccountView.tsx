'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, showVolume } from '@/lib/money';
import { RankPanel } from './RankPanel';
import { MemberShell, type MemberSummary } from './MemberShell';

/**
 * The account overview.
 *
 * Where a member stands, and the two things they have to keep current: their
 * delivery address and their payout details.
 *
 * Payout details are shown masked and never in full. The API stores them
 * encrypted and returns only the last four digits — there is no reason for a
 * full account number to travel to a browser and sit in its cache, and the
 * member already knows their own account.
 */

interface PayoutSummary {
  upi: string | null;
  holder: string | null;
  bank: string | null;
  accountLast4: string | null;
  ifsc: string | null;
}

export function AccountView() {
  return (
    <MemberShell title="Your account">
      {(data, reload) => <Overview data={data} reload={reload} />}
    </MemberShell>
  );
}

function Overview({ data, reload }: { data: MemberSummary; reload: () => void }) {
  return (
    <div className="space-y-6">
      <RankPanel rank={data.rank} joinedLabel={formatDate(data.member.joinedAt)} />

      {/* --------------------------------------------------- volume */}
      <div className="grid gap-4 sm:grid-cols-2">
        <VolumeCard
          title={`This month (${data.volume.period})`}
          self={showVolume(data.volume.periodSelf)}
          group={showVolume(data.volume.periodGroup)}
        />
        <VolumeCard
          title="Lifetime"
          self={showVolume(data.volume.lifetimeSelf)}
          group={showVolume(data.volume.lifetimeGroup)}
        />
      </div>

      <MessagesToggle initial={data.member.notifyExternal ?? true} />

      {/* Anything waiting on someone else, in one place. */}
      {(data.pending.recharges > 0 || data.pending.withdrawals > 0) && (
        <section className="rounded-2xl border border-[var(--notice-border)] bg-[var(--notice-bg)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">Waiting on us</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--body)]">
            {data.pending.recharges > 0 && (
              <li>
                {data.pending.recharges} wallet {data.pending.recharges === 1 ? 'recharge' : 'recharges'} being checked ·{' '}
                <Link href="/recharge" className="font-semibold text-[var(--accent)] hover:underline">See</Link>
              </li>
            )}
            {data.pending.withdrawals > 0 && (
              <li>
                {data.pending.withdrawals} {data.pending.withdrawals === 1 ? 'withdrawal' : 'withdrawals'} being processed ·{' '}
                <Link href="/wallet?kind=income" className="font-semibold text-[var(--accent)] hover:underline">See</Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <ContactDetails data={data} />
      <PayoutDetails onSaved={reload} />
    </div>
  );
}

function VolumeCard({ title, self, group }: { title: string; self: string; group: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">Your own purchases</dt>
          <dd className="font-medium text-[var(--ink)]">{self}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--muted)]">You and your team</dt>
          <dd className="font-medium text-[var(--ink)]">{group}</dd>
        </div>
      </dl>
    </div>
  );
}

function ContactDetails({ data }: { data: MemberSummary }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="font-serif text-lg text-[var(--ink)]">Your details</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Name" value={data.member.name} />
        <Field label="Member ID" value={data.member.code} mono />
        <Field label="Mobile" value={data.member.phone} />
        <Field label="Email" value={data.member.email ?? 'Not added'} />
      </dl>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{label}</dt>
      <dd className={`mt-0.5 text-[var(--ink)] ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function PayoutDetails({ onSaved }: { onSaved: () => void }) {
  const [payout, setPayout] = useState<PayoutSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ upi: '', holder: '', bank: '', account: '', ifsc: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api<PayoutSummary>('/me/payout').then(setPayout).catch(() => setPayout(null));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await api('/me/payout', { method: 'PATCH', body: form });
      setPayout(await api<PayoutSummary>('/me/payout'));
      setEditing(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not save your payout details.');
      }
    } finally {
      setSaving(false);
    }
  };

  const configured = payout && (payout.upi || payout.accountLast4);

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-[var(--ink)]">Payout details</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Where income withdrawals are sent. Must be an account in your own name.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-xl border border-[var(--line-strong)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]"
          >
            {configured ? 'Change' : 'Add'}
          </button>
        )}
      </div>

      {!editing ? (
        configured ? (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {payout!.upi && <Field label="UPI" value={payout!.upi} mono />}
            {payout!.accountLast4 && (
              <>
                <Field label="Account" value={`•••• ${payout!.accountLast4}`} mono />
                {payout!.bank && <Field label="Bank" value={payout!.bank} />}
                {payout!.ifsc && <Field label="IFSC" value={payout!.ifsc} mono />}
                {payout!.holder && <Field label="Account holder" value={payout!.holder} />}
              </>
            )}
          </dl>
        ) : (
          <p className="mt-4 rounded-xl bg-[var(--notice-bg)] px-4 py-3 text-sm text-[var(--body)]">
            No payout details yet. Add them before you request a withdrawal.
          </p>
        )
      ) : (
        <div className="mt-4 space-y-4">
          <Input label="UPI ID" value={form.upi} error={fieldErrors.upi}
            onChange={(v) => setForm((f) => ({ ...f, upi: v }))} hint="e.g. yourname@bank — the quickest route" />

          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Or a bank account</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Account holder" value={form.holder} error={fieldErrors.holder}
              onChange={(v) => setForm((f) => ({ ...f, holder: v }))} />
            <Input label="Bank" value={form.bank} error={fieldErrors.bank}
              onChange={(v) => setForm((f) => ({ ...f, bank: v }))} />
            <Input label="Account number" value={form.account} error={fieldErrors.account}
              onChange={(v) => setForm((f) => ({ ...f, account: v.replace(/\D/g, '').slice(0, 18) }))} />
            <Input label="IFSC" value={form.ifsc} error={fieldErrors.ifsc}
              onChange={(v) => setForm((f) => ({ ...f, ifsc: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) }))} />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--gold-pale)] disabled:bg-[#E8DDE3] disabled:text-[#A79AA1]"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(null); }}
              className="rounded-xl border border-[var(--line-strong)] px-6 py-3 text-sm font-semibold text-[var(--body)] hover:bg-[var(--surface-tint)]"
            >
              Cancel
            </button>
          </div>

          {/* Said before they submit, not after it is rejected. */}
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            Payouts are only made to an account in the member&apos;s own name. An account that already
            belongs to another member will be refused.
          </p>
        </div>
      )}
    </section>
  );
}

function Input({
  label, value, onChange, hint, error,
}: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--ink)]">
        {label}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      {error ? <p className="mt-1 text-xs text-[#C0392B]">{error}</p>
        : hint ? <p className="mt-1 text-xs text-[var(--faint)]">{hint}</p> : null}
    </div>
  );
}

/** Whether to also get SMS / WhatsApp for orders, wallet credits and withdrawals. In-app notifications always show. */
function MessagesToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const flip = async () => {
    const next = !on;
    setBusy(true); setFailed(false); setOn(next);
    try {
      await api('/me/notification-prefs', { method: 'PATCH', body: { external: next } });
    } catch {
      setOn(!next); setFailed(true);
    } finally { setBusy(false); }
  };

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="min-w-0">
        <h2 className="font-serif text-lg text-[var(--ink)]">Messages on your phone</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">SMS and WhatsApp when an order ships, money reaches your wallet or a withdrawal is paid.</p>
        {failed && <p role="alert" className="mt-1 text-xs text-[#C0392B]">Could not save that. Try again.</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="SMS and WhatsApp messages"
        disabled={busy}
        onClick={flip}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-[var(--ink)]' : 'bg-[var(--line-strong)]'} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </section>
  );
}
