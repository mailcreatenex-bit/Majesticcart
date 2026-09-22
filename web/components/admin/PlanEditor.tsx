'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, parseRupeeInput, showMoney, type MoneyView } from '@/lib/money';
import {
  exposureBp, localIssues, pctToBp, bpToPct, bvToCenti, centiToBv,
  MODE_COPY, SUSTAINABLE_CEILING_BP,
  type PlanConfig, type Rank, type RoyaltyFund, type ExposureLine,
} from '@/lib/plan';
import { AdminShell, Panel, AdminError, TableSkeleton } from './AdminShell';

/**
 * The compensation plan editor.
 *
 * The client's requirement was that nothing be hard-coded — that they be able
 * to change anything later without a developer. This is where that promise is
 * kept, and the design follows from what makes it dangerous:
 *
 *   • **Every change is a new version.** Nothing is edited in place. A payout
 *     already credited can always explain itself against the exact rules that
 *     were live when it was paid, because the order pinned its plan version at
 *     delivery.
 *   • **The exposure total is live**, and it is the number that decides whether
 *     the plan can be published at all. Showing it only on save would mean
 *     making six edits and then being told one of them was too much.
 *   • **Modes carry their consequences next to them**, not in a tooltip. Each
 *     mode exists because the client's own plan document was ambiguous, and the
 *     reading they pick has real legal weight — WALLET_RECHARGE in particular
 *     pays on deposits rather than product sales, which is the pattern the
 *     Direct Selling Rules are written to catch.
 *
 * The exposure arithmetic here is checked against the server's own
 * `payoutExposure` by a test in the backend suite, across every mode
 * combination. A console that disagrees with the validator is worse than one
 * that shows nothing.
 */

interface CurrentPlan {
  version: number;
  activeFrom: string;
  plan: PlanConfig;
  exposure: { lines: ExposureLine[]; totalBp: number | null };
}

interface Version {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdById: string | null;
}

interface RoyaltyPoolRow { fundKey: string; name: string; pool: MoneyView }

export function PlanEditorView() {
  return (
    <AdminShell
      title="Compensation plan"
      subtitle="Every change publishes a new version. Nothing is edited in place."
      permission="plan.manage"
    >
      <Editor />
    </AdminShell>
  );
}

function Editor() {
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [pools, setPools] = useState<RoyaltyPoolRow[]>([]);
  const [draft, setDraft] = useState<PlanConfig | null>(null);
  const [note, setNote] = useState('');
  const [acceptUnlimited, setAcceptUnlimited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [c, v] = await Promise.all([
      api<CurrentPlan>('/admin/plan'),
      api<Version[]>('/admin/plan/versions').catch(() => []),
    ]);
    setCurrent(c);
    setVersions(v);
    setDraft(structuredClone(c.plan));
    // Pool balances only exist once there is at least one fund to accumulate
    // into — asking when there are none would just be a request for an empty
    // array every time this page loads.
    if (c.plan.royalty.funds.length > 0) {
      api<RoyaltyPoolRow[]>('/admin/plan/royalty/pools').then(setPools).catch(() => setPools([]));
    } else {
      setPools([]);
    }
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the plan.'));
  }, [load]);

  /** Shallow-merge a top-level section, so callers do not clone by hand. */
  const patch = <K extends keyof PlanConfig>(key: K, value: PlanConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const exposure = useMemo(() => (draft ? exposureBp(draft) : null), [draft]);
  const issues = useMemo(() => (draft ? localIssues(draft) : []), [draft]);

  const overCeiling = exposure?.totalBp != null && exposure.totalBp > SUSTAINABLE_CEILING_BP;
  const unbounded = exposure?.totalBp == null;
  const dirty = !!draft && !!current && JSON.stringify(draft) !== JSON.stringify(current.plan);

  const canPublish =
    dirty && issues.length === 0 && !overCeiling && (!unbounded || acceptUnlimited) && !saving;

  const publish = async () => {
    if (!draft || !canPublish) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ version: number }>('/admin/plan', {
        method: 'POST',
        body: { plan: draft, note: note.trim() || undefined, acceptUnlimited },
      });
      setSaved(r.version);
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not publish the plan.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !draft) return <AdminError message={error} />;
  if (!draft || !current) return <TableSkeleton rows={6} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        {saved !== null && (
          <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            Published as version {saved}. Every member&apos;s rank has been recalculated against the
            new ladder; nothing already credited has changed.
          </p>
        )}

        {/* ----------------------------------------------------- the ladder */}
        <Panel
          title="Ranks"
          action={
            <button
              type="button"
              onClick={() => {
                const last = draft.ranks[draft.ranks.length - 1];
                patch('ranks', [...draft.ranks, {
                  name: '',
                  // Seeded above the last rung, since the ladder has to ascend.
                  minBvCenti: (last?.minBvCenti ?? 0) + 100_000,
                  selfPctBp: last?.selfPctBp ?? 1000,
                  teamPctBp: last?.teamPctBp ?? 500,
                }]);
              }}
              disabled={draft.ranks.length >= 12}
              className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400"
            >
              Add rank
            </button>
          }
        >
          <label className="block text-sm font-medium text-neutral-800">
            Rank is measured on
            <ModeSelect
              value={draft.rankBasis}
              options={MODE_COPY.rankBasis}
              onChange={(v) => patch('rankBasis', v as PlanConfig['rankBasis'])}
            />
          </label>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">From (BV)</th>
                  <th className="pb-2 pr-3">Self %</th>
                  <th className="pb-2 pr-3">Team %</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {draft.ranks.map((rank, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3">
                      <input
                        value={rank.name}
                        onChange={(e) => patch('ranks', replaceAt(draft.ranks, i, { ...rank, name: e.target.value }))}
                        className="w-32 rounded-lg border border-neutral-300 px-2 py-1.5 focus:border-neutral-900 focus:outline-none"
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <NumberInput
                        value={centiToBv(rank.minBvCenti)}
                        onChange={(v) => patch('ranks', replaceAt(draft.ranks, i, { ...rank, minBvCenti: bvToCenti(v) }))}
                        // The first rung must be 0 or a new member matches no
                        // rank at all, so it is not editable.
                        disabled={i === 0}
                        width="w-24"
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <NumberInput
                        value={bpToPct(rank.selfPctBp)}
                        onChange={(v) => patch('ranks', replaceAt(draft.ranks, i, { ...rank, selfPctBp: pctToBp(v) }))}
                        width="w-20"
                        suffix="%"
                      />
                    </td>
                    <td className="py-1 pr-3">
                      <NumberInput
                        value={bpToPct(rank.teamPctBp)}
                        onChange={(v) => patch('ranks', replaceAt(draft.ranks, i, { ...rank, teamPctBp: pctToBp(v) }))}
                        width="w-20"
                        suffix="%"
                      />
                    </td>
                    <td className="py-1">
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() => patch('ranks', draft.ranks.filter((_, j) => j !== i))}
                          className="text-xs font-semibold text-red-700 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            The first rank starts at 0 BV and cannot be changed — every member needs a rank from the
            moment they join, or they have no rate at all.
          </p>
        </Panel>

        {/* --------------------------------------------------- income types */}
        <Panel title="Self purchase income">
          <Toggle
            checked={draft.self.enabled}
            onChange={(v) => patch('self', { enabled: v })}
            label="Members earn on their own purchases"
            hint="Paid at the rate of their rank, on orders they place themselves."
          />
        </Panel>

        <Panel title="Direct income">
          <Toggle
            checked={draft.direct.enabled}
            onChange={(v) => patch('direct', { ...draft.direct, enabled: v })}
            label="Sponsors earn on the people they bring in"
          />

          {draft.direct.enabled && (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-800">
                Rate
                <NumberInput
                  value={bpToPct(draft.direct.pctBp)}
                  onChange={(v) => patch('direct', { ...draft.direct, pctBp: pctToBp(v) })}
                  width="w-24"
                  suffix="%"
                />
              </label>

              <label className="block text-sm font-medium text-neutral-800">
                Paid on
                <ModeSelect
                  value={draft.direct.basis}
                  options={MODE_COPY.directBasis}
                  onChange={(v) => patch('direct', { ...draft.direct, basis: v as PlanConfig['direct']['basis'] })}
                />
              </label>
            </div>
          )}
        </Panel>

        <Panel title="Team income">
          <Toggle
            checked={draft.team.enabled}
            onChange={(v) => patch('team', { ...draft.team, enabled: v })}
            label="Uplines earn on their team's sales"
          />

          {draft.team.enabled && (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-800">
                How it is calculated
                <ModeSelect
                  value={draft.team.mode}
                  options={MODE_COPY.teamMode}
                  onChange={(v) => patch('team', { ...draft.team, mode: v as PlanConfig['team']['mode'] })}
                />
              </label>

              {draft.team.mode === 'FLAT' && (
                <label className="block text-sm font-medium text-neutral-800">
                  Depth (levels)
                  <NumberInput
                    value={String(draft.team.depth)}
                    onChange={(v) => patch('team', { ...draft.team, depth: Math.min(50, Math.max(0, Math.floor(Number(v) || 0))) })}
                    width="w-20"
                  />
                  <span className="mt-1 block text-xs font-normal text-neutral-500">
                    0 means unlimited, which has no payout ceiling and has to be confirmed
                    explicitly before it can be published.
                  </span>
                </label>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Generation bonus">
          <Toggle
            checked={draft.generation.enabled}
            onChange={(v) => patch('generation', { ...draft.generation, enabled: v })}
            label="Senior ranks earn across generations below them"
          />

          {draft.generation.enabled && (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-800">
                Earned from rank
                <select
                  value={draft.generation.minRankIndex}
                  onChange={(e) => patch('generation', { ...draft.generation, minRankIndex: Number(e.target.value) })}
                  className="ml-2 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                >
                  {draft.ranks.map((r, i) => (
                    <option key={i} value={i}>{r.name || `Rank ${i + 1}`} and above</option>
                  ))}
                </select>
              </label>

              <Toggle
                checked={draft.generation.onlyQualified}
                onChange={(v) => patch('generation', { ...draft.generation, onlyQualified: v })}
                label="Only count generations led by a qualified member"
                hint="With this off, an unqualified member is transparent and the bonus passes through them."
              />

              <div>
                <p className="text-sm font-medium text-neutral-800">Rate per generation</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {draft.generation.levelsBp.map((bp, i) => (
                    <label key={i} className="text-xs text-neutral-500">
                      Gen {i + 1}
                      <NumberInput
                        value={bpToPct(bp)}
                        onChange={(v) => patch('generation', {
                          ...draft.generation,
                          levelsBp: replaceAt(draft.generation.levelsBp, i, pctToBp(v)),
                        })}
                        width="w-20"
                        suffix="%"
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => patch('generation', {
                      ...draft.generation,
                      levelsBp: [...draft.generation.levelsBp, 100],
                    })}
                    disabled={draft.generation.levelsBp.length >= 20}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400"
                  >
                    Add generation
                  </button>
                  {draft.generation.levelsBp.length > 0 && (
                    <button
                      type="button"
                      onClick={() => patch('generation', {
                        ...draft.generation,
                        levelsBp: draft.generation.levelsBp.slice(0, -1),
                      })}
                      className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Remove last
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* -------------------------------------------------------- royalty */}
        <Panel
          title="Royalty and lifestyle pools"
          action={
            <button
              type="button"
              onClick={() => patch('royalty', {
                funds: [...draft.royalty.funds, {
                  key: `fund${draft.royalty.funds.length + 1}`,
                  name: '',
                  poolPctBp: 100,
                  qualifyMode: 'RANK_COUNT',
                  minRankIndex: Math.max(0, draft.ranks.length - 1),
                  minCount: 3,
                  targetBvCenti: 0,
                }],
              })}
              disabled={draft.royalty.funds.length >= 12}
              className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-400"
            >
              Add pool
            </button>
          }
        >
          {draft.royalty.funds.length === 0 ? (
            <p className="text-sm text-neutral-500">No pools. Nothing is set aside from company BV.</p>
          ) : (
            <div className="space-y-4">
              {draft.royalty.funds.map((fund, i) => (
                <FundRow
                  key={i}
                  fund={fund}
                  ranks={draft.ranks}
                  onChange={(f) => patch('royalty', { funds: replaceAt(draft.royalty.funds, i, f) })}
                  onRemove={() => patch('royalty', { funds: draft.royalty.funds.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* ----------------------------------------------- joining, payouts */}
        <Panel title="Joining">
          <label className="block text-sm font-medium text-neutral-800">
            Requirement
            <ModeSelect
              value={draft.joining.mode}
              options={MODE_COPY.joinMode}
              onChange={(v) => patch('joining', { ...draft.joining, mode: v as PlanConfig['joining']['mode'] })}
            />
          </label>

          {draft.joining.mode === 'MIN_FIRST_PURCHASE' && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-neutral-800">
                Minimum first purchase
                <NumberInput
                  value={draft.joining.unit === 'BV' ? centiToBv(draft.joining.minFirstPurchase) : String(draft.joining.minFirstPurchase / 100)}
                  onChange={(v) => patch('joining', {
                    ...draft.joining,
                    minFirstPurchase: draft.joining.unit === 'BV' ? bvToCenti(v) : parseRupeeInput(v),
                  })}
                  width="w-28"
                />
              </label>
              <label className="text-sm font-medium text-neutral-800">
                measured in
                <select
                  value={draft.joining.unit}
                  onChange={(e) => patch('joining', { ...draft.joining, unit: e.target.value as 'BV' | 'INR' })}
                  className="ml-2 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                >
                  <option value="BV">BV</option>
                  <option value="INR">₹</option>
                </select>
              </label>
            </div>
          )}

          {/* Said in the editor, because whoever is setting this needs to know
              why it is worded the way it is. */}
          <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
            Registration itself is always free. This is a minimum first <em>product purchase</em>,
            never a registration fee — that distinction is what keeps the plan on the right side of
            the Direct Selling Rules, and it is enforced in code rather than left to wording.
          </p>
        </Panel>

        <Panel title="Repurchase">
          <Toggle
            checked={draft.repurchase.enabled}
            onChange={(v) => patch('repurchase', { ...draft.repurchase, enabled: v })}
            label="Members must buy a minimum each month"
          />
          {draft.repurchase.enabled && (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-800">
                Monthly target
                <NumberInput
                  value={centiToBv(draft.repurchase.monthlyBvCenti)}
                  onChange={(v) => patch('repurchase', { ...draft.repurchase, monthlyBvCenti: bvToCenti(v) })}
                  width="w-28"
                  suffix="BV"
                />
              </label>
              <Toggle
                checked={draft.repurchase.blocksWithdrawal}
                onChange={(v) => patch('repurchase', { ...draft.repurchase, blocksWithdrawal: v })}
                label="Not meeting it blocks withdrawals"
                hint="It never blocks ordering or removes anyone's team — only the ability to withdraw income that month."
              />
            </div>
          )}
        </Panel>

        <Panel title="Withdrawals">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-neutral-800">
              Minimum withdrawal
              <NumberInput
                value={(Number(draft.withdrawal.minPaise) / 100).toString()}
                onChange={(v) => patch('withdrawal', { ...draft.withdrawal, minPaise: String(parseRupeeInput(v)) })}
                width="w-28"
                prefix="₹"
              />
            </label>

            <label className="block text-sm font-medium text-neutral-800">
              Deduction
              <NumberInput
                value={bpToPct(draft.withdrawal.deductionBp)}
                onChange={(v) => patch('withdrawal', { ...draft.withdrawal, deductionBp: pctToBp(v) })}
                width="w-24"
                suffix="%"
              />
              <span className="mt-1 block text-xs font-normal text-neutral-500">
                Taken from the requested amount. The member sees it quoted before they confirm.
              </span>
            </label>

            <label className="block text-sm font-medium text-neutral-800">
              Paid out
              <ModeSelect
                value={draft.withdrawal.cycle}
                options={MODE_COPY.payoutCycle}
                onChange={(v) => patch('withdrawal', { ...draft.withdrawal, cycle: v as PlanConfig['withdrawal']['cycle'] })}
              />
            </label>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------ the sidebar */}
      <aside className="h-fit space-y-4 lg:sticky lg:top-4">
        <ExposurePanel
          exposure={exposure}
          overCeiling={overCeiling}
          unbounded={unbounded}
        />

        {issues.length > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4">
            <h2 className="text-sm font-semibold text-red-800">Fix before publishing</h2>
            <ul className="mt-2 space-y-1.5">
              {issues.map((issue) => (
                <li key={issue.path} className="text-xs leading-relaxed text-red-700">{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Publish</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Live version {current.version}, since {formatDate(current.activeFrom)}.
          </p>

          <label className="mt-3 block text-xs font-medium text-neutral-600">
            What changed, and why
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Diamond team rate to 6% per the client's email"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>

          {unbounded && (
            <label className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <input
                type="checkbox"
                checked={acceptUnlimited}
                onChange={(e) => setAcceptUnlimited(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                I understand this plan has no payout ceiling. Flat team income with unlimited depth
                grows with every generation added below, and nothing in the system will stop it.
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          <button
            type="button"
            onClick={publish}
            disabled={!canPublish}
            className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300"
          >
            {saving ? 'Publishing…' : dirty ? 'Publish new version' : 'No changes'}
          </button>

          {dirty && (
            <button
              type="button"
              onClick={() => { setDraft(structuredClone(current.plan)); setError(null); }}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
            >
              Discard changes
            </button>
          )}
        </div>

        {pools.length > 0 && <RoyaltyPoolsPanel pools={pools} onDistributed={load} />}

        {versions.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-900">History</h2>
            <ul className="mt-2 space-y-2">
              {versions.slice(0, 8).map((v) => (
                <li key={v.id} className="text-xs">
                  <span className="font-semibold text-neutral-700">v{v.version}</span>
                  <span className="ml-2 text-neutral-500">{formatDate(v.createdAt)}</span>
                  {v.note && <span className="mt-0.5 block text-neutral-600">{v.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

/**
 * Pays out an already-published fund's accumulated pool to whoever currently
 * qualifies. There was previously no way to actually do this — a fund could
 * be defined and accrue in `royalty/:fundKey/distribute` on the API with
 * nothing in the console ever calling it.
 *
 * Deliberately reads from `current.plan`, not the unsaved `draft`: this pays
 * out against the fund definition that is actually live, which is the only
 * one `distributeRoyalty` on the server will recognise.
 */
function RoyaltyPoolsPanel({ pools, onDistributed }: { pools: RoyaltyPoolRow[]; onDistributed: () => void }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Royalty pools</h2>
      <p className="mt-1 text-xs text-neutral-500">
        What each published fund has accumulated. Distributing pays it out now, split among whoever
        currently qualifies, and cannot be undone.
      </p>
      <ul className="mt-3 space-y-3">
        {pools.map((p) => <PoolRow key={p.fundKey} pool={p} onDistributed={onDistributed} />)}
      </ul>
    </div>
  );
}

function PoolRow({ pool, onDistributed }: { pool: RoyaltyPoolRow; onDistributed: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ perHead: MoneyView; qualifiers: number } | null>(null);

  const distribute = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ runId: string; perHead: MoneyView; qualifiers: number }>(
        `/admin/plan/royalty/${pool.fundKey}/distribute`,
        { method: 'POST', body: {} },
      );
      setResult({ perHead: r.perHead, qualifiers: r.qualifiers });
      setConfirming(false);
      onDistributed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not distribute this fund.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <li className="rounded-lg bg-[#E9F5EF] p-3 text-xs leading-relaxed text-[#2C6B52]">
        Paid {showMoney(result.perHead)} each to {result.qualifiers} qualifying member{result.qualifiers === 1 ? '' : 's'}.
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">{pool.name}</p>
          <p className="text-xs text-neutral-500">Accumulated: {showMoney(pool.pool)}</p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pool.pool.paise <= 0}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            Distribute now
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <p className="text-xs leading-relaxed text-amber-900">
            Pay out {showMoney(pool.pool)} from {pool.name} to everyone who currently qualifies, split
            evenly? This happens immediately and cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={distribute}
              disabled={busy}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-neutral-400"
            >
              {busy ? 'Paying out…' : 'Confirm and pay out'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
    </li>
  );
}

function ExposurePanel({
  exposure, overCeiling, unbounded,
}: {
  exposure: { lines: ExposureLine[]; totalBp: number | null } | null;
  overCeiling: boolean;
  unbounded: boolean;
}) {
  if (!exposure) return null;

  return (
    <div className={`rounded-xl border p-4 ${overCeiling || unbounded ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-white'}`}>
      <h2 className="text-sm font-semibold text-neutral-900">Payout per 100 BV sold</h2>

      <p className={`mt-1 text-3xl font-semibold tabular-nums ${overCeiling || unbounded ? 'text-red-700' : 'text-neutral-900'}`}>
        {exposure.totalBp == null ? 'No ceiling' : `${(exposure.totalBp / 100).toFixed(2)}%`}
      </p>

      <dl className="mt-3 space-y-1.5 border-t border-neutral-200 pt-3 text-xs">
        {exposure.lines.map((line) => (
          <div key={line.label}>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">{line.label}</dt>
              <dd className="tabular-nums text-neutral-900">
                {line.pctBp == null ? 'unbounded' : `${(line.pctBp / 100).toFixed(2)}%`}
              </dd>
            </div>
            {line.note && <p className="text-neutral-400">{line.note}</p>}
          </div>
        ))}
      </dl>

      {overCeiling && (
        <p className="mt-3 text-xs leading-relaxed text-red-700">
          Above the {SUSTAINABLE_CEILING_BP / 100}% ceiling. A cosmetics catalogue cannot fund much
          past this from product margin, so publishing will be refused. Lower a rate.
        </p>
      )}
      {unbounded && (
        <p className="mt-3 text-xs leading-relaxed text-red-700">
          This plan has no computable ceiling, so its cost cannot be checked against the margin at
          all. Set a team depth, or confirm the risk below.
        </p>
      )}
    </div>
  );
}

function FundRow({
  fund, ranks, onChange, onRemove,
}: {
  fund: RoyaltyFund;
  ranks: Rank[];
  onChange: (f: RoyaltyFund) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-500">
          Name
          <input
            value={fund.name}
            onChange={(e) => onChange({ ...fund, name: e.target.value })}
            placeholder="e.g. Car fund"
            className="mt-1 block w-36 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="text-xs text-neutral-500">
          Pool
          <NumberInput
            value={bpToPct(fund.poolPctBp)}
            onChange={(v) => onChange({ ...fund, poolPctBp: pctToBp(v) })}
            width="w-20"
            suffix="%"
          />
        </label>

        <label className="text-xs text-neutral-500">
          Qualify
          <select
            value={fund.qualifyMode}
            onChange={(e) => onChange({ ...fund, qualifyMode: e.target.value as RoyaltyFund['qualifyMode'] })}
            className="mt-1 block rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            {Object.entries(MODE_COPY.qualifyMode).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>

        {fund.qualifyMode === 'RANK_COUNT' ? (
          <>
            <label className="text-xs text-neutral-500">
              Legs at
              <select
                value={fund.minRankIndex}
                onChange={(e) => onChange({ ...fund, minRankIndex: Number(e.target.value) })}
                className="mt-1 block rounded-lg border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
              >
                {ranks.map((r, i) => <option key={i} value={i}>{r.name || `Rank ${i + 1}`}</option>)}
              </select>
            </label>
            <label className="text-xs text-neutral-500">
              How many
              <NumberInput
                value={String(fund.minCount)}
                onChange={(v) => onChange({ ...fund, minCount: Math.max(1, Math.floor(Number(v) || 1)) })}
                width="w-16"
              />
            </label>
          </>
        ) : (
          <label className="text-xs text-neutral-500">
            BV target
            <NumberInput
              value={centiToBv(fund.targetBvCenti)}
              onChange={(v) => onChange({ ...fund, targetBvCenti: bvToCenti(v) })}
              width="w-24"
            />
          </label>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-xs font-semibold text-red-700 hover:underline"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** A select whose options carry their own explanation, and any warning. */
function ModeSelect({
  value, options, onChange,
}: {
  value: string;
  options: Record<string, { label: string; detail: string; warning?: string }>;
  onChange: (v: string) => void;
}) {
  const chosen = options[value];

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
      >
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>

      {chosen && (
        <p className="mt-1.5 text-xs font-normal leading-relaxed text-neutral-500">{chosen.detail}</p>
      )}
      {/* Rendered inline, not behind a tooltip. Someone changing this setting
          needs to read the consequence without going looking for it. */}
      {chosen?.warning && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-normal leading-relaxed text-amber-900">
          {chosen.warning}
        </p>
      )}
    </>
  );
}

function NumberInput({
  value, onChange, width = 'w-24', prefix, suffix, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <span className={`mt-1 inline-flex items-center rounded-lg border px-2 ${disabled ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-300 bg-white'}`}>
      {prefix && <span className="text-sm text-neutral-500">{prefix}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        inputMode="decimal"
        disabled={disabled}
        className={`${width} bg-transparent px-1 py-1.5 text-sm tabular-nums text-neutral-900 focus:outline-none disabled:text-neutral-400`}
      />
      {suffix && <span className="text-sm text-neutral-500">{suffix}</span>}
    </span>
  );
}

function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
      />
      <span>
        <span className="block text-sm text-neutral-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{hint}</span>}
      </span>
    </label>
  );
}

/** Replace one element without mutating — every patch here is immutable. */
const replaceAt = <T,>(list: T[], index: number, value: T): T[] =>
  list.map((item, i) => (i === index ? value : item));
