'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { MemberShell, type MemberSummary } from './MemberShell';

/**
 * Autoship: a standing monthly order, so the monthly purchase target is met
 * without remembering to shop.
 *
 * The screen states plainly what it does: on the chosen day the order is placed
 * from the shopping wallet through ordinary checkout. If the wallet is short
 * nothing is charged and the member is told. The estimate shown is at shelf
 * prices; the order is priced when it is placed.
 */

interface Money { paise: string; amount: string; display: string }
interface CatalogProduct { id: string; name: string; price: Money; businessVolume: { centi: number; display: string } }
interface PlanItem { productId: string; quantity: number; name: string; available: boolean; price: Money }
interface Plan {
  active: boolean;
  dayOfMonth: number;
  items: PlanItem[];
  estimatedTotal: Money;
  estimatedBv: { centi: number; display: string };
  lastOrderNo: string | null;
  lastResult: string | null;
  lastAttemptAt: string | null;
  nextPeriod: string | null;
}
interface Line { productId: string; quantity: number }

export function AutoshipView() {
  return (
    <MemberShell title="Autoship">
      {(data, reload) => <Autoship data={data} reload={reload} />}
    </MemberShell>
  );
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;

function Autoship({ data }: { data: MemberSummary; reload: () => void }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [day, setDay] = useState(1);
  const [pick, setPick] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [p, c] = await Promise.all([
        api<{ plan: Plan | null }>('/autoship'),
        api<{ items: CatalogProduct[] }>('/catalog/products'),
      ]);
      setProducts(c.items);
      setPlan(p.plan);
      if (p.plan) {
        setLines(p.plan.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
        setDay(p.plan.dayOfMonth);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load autoship.');
      setPlan(null);
    }
  };
  useEffect(() => { void load(); }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const draftBv = lines.reduce((s, l) => s + (byId.get(l.productId)?.businessVolume.centi ?? 0) * l.quantity, 0);
  const draftTotal = lines.reduce((s, l) => s + Number(byId.get(l.productId)?.price.amount ?? 0) * l.quantity, 0);
  const target = data.repurchase?.targetBv ?? null;

  const run = async (fn: () => Promise<{ plan: Plan | null } | { ok: true }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if ('plan' in r) { setPlan(r.plan); setEditing(false); } else { setPlan(null); setLines([]); setEditing(false); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => api<{ plan: Plan | null }>('/autoship', { method: 'PUT', body: { dayOfMonth: day, lines } }));

  const setQty = (id: string, q: number) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, quantity: Math.max(1, Math.min(20, q)) } : l)));
  const add = () => {
    if (!pick) return;
    setLines((ls) => (ls.some((l) => l.productId === pick) ? ls : [...ls, { productId: pick, quantity: 1 }]));
    setPick('');
  };

  if (plan === undefined) return <div className="h-48 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />;

  const showEditor = editing || !plan;

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm leading-relaxed text-[var(--body)]">
        Pick what you buy every month and the day you want it. On that day the order is placed from your
        shopping wallet, exactly like an order you place yourself - so it counts toward your monthly target
        {target ? ` of ${target.display}` : ''}. If your wallet is short, nothing is charged and we let you know.
      </p>

      {error && <p role="alert" className="rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">{error}</p>}

      {plan && !showEditor && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg text-[var(--ink)]">Your monthly order</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${plan.active ? 'bg-[#E8F5EC] text-[#1F7A3D]' : 'bg-[var(--surface-tint)] text-[var(--muted)]'}`}>
              {plan.active ? `On - ${ordinal(plan.dayOfMonth)} of every month` : 'Paused'}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
            {plan.items.map((i) => (
              <li key={i.productId} className="flex items-center justify-between gap-3 py-2">
                <span className={i.available ? 'text-[var(--ink)]' : 'text-[var(--faint)] line-through'}>{i.name} × {i.quantity}</span>
                <span className="text-[var(--body)]">{i.available ? i.price.display : 'unavailable'}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">About {plan.estimatedTotal.display} · {plan.estimatedBv.display}</span>
            {plan.nextPeriod && <span className="text-[var(--muted)]">Next order: {new Date(plan.nextPeriod).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</span>}
          </div>
          {target && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {plan.estimatedBv.centi >= target.centi
                ? 'This order alone meets your monthly target.'
                : `This order gives ${plan.estimatedBv.display} of your ${target.display} monthly target.`}
            </p>
          )}
          {plan.lastResult && (
            <p className="mt-3 rounded-lg bg-[var(--surface-tint)] px-3 py-2 text-xs text-[var(--body)]">
              Last run: {plan.lastResult}{plan.lastOrderNo ? ` (${plan.lastOrderNo})` : ''}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">Change</button>
            <button type="button" disabled={busy} onClick={() => run(() => api(plan.active ? '/autoship/pause' : '/autoship/resume', { method: 'POST', body: {} }))} className="rounded-xl border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)] disabled:opacity-50">
              {plan.active ? 'Pause' : 'Resume'}
            </button>
            <button type="button" disabled={busy} onClick={() => { if (confirm('Remove your autoship order?')) void run(() => api('/autoship', { method: 'DELETE' })); }} className="rounded-xl px-4 py-2 text-sm font-semibold text-red-700 hover:underline disabled:opacity-50">Remove</button>
          </div>
        </section>
      )}

      {showEditor && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="font-serif text-lg text-[var(--ink)]">{plan ? 'Change your monthly order' : 'Set up your monthly order'}</h2>

          <div className="mt-4 flex gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Product to add" className="min-w-0 flex-1 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)]">
              <option value="">Choose a product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {p.price.display}</option>)}
            </select>
            <button type="button" onClick={add} disabled={!pick} className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--gold-pale)] disabled:opacity-40">Add</button>
          </div>

          {lines.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {lines.map((l) => {
                const p = byId.get(l.productId);
                return (
                  <li key={l.productId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-[var(--ink)]">{p?.name ?? 'Product'}</span>
                    <span className="flex items-center gap-1">
                      <button type="button" aria-label="Fewer" onClick={() => setQty(l.productId, l.quantity - 1)} className="h-7 w-7 rounded-lg border border-[var(--line-strong)] text-[var(--ink)]">−</button>
                      <span className="w-6 text-center">{l.quantity}</span>
                      <button type="button" aria-label="More" onClick={() => setQty(l.productId, l.quantity + 1)} className="h-7 w-7 rounded-lg border border-[var(--line-strong)] text-[var(--ink)]">+</button>
                    </span>
                    <button type="button" aria-label={`Remove ${p?.name ?? 'product'}`} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} className="text-xs font-semibold text-red-700">×</button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4">
            <label htmlFor="ap-day" className="text-xs uppercase tracking-wider text-[var(--faint)]">Order on the</label>
            <select id="ap-day" value={day} onChange={(e) => setDay(Number(e.target.value))} className="mt-1 block rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)]">
              {DAYS.map((d) => <option key={d} value={d}>{ordinal(d)} of every month</option>)}
            </select>
          </div>

          {lines.length > 0 && (
            <p className="mt-4 text-sm text-[var(--body)]">
              About <strong className="text-[var(--ink)]">₹{draftTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
              {' '}· <strong className="text-[var(--ink)]">{(draftBv / 100).toLocaleString('en-IN')} BV</strong>
              {target && (draftBv >= target.centi ? ' - meets your monthly target.' : ` of your ${target.display} monthly target.`)}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <button type="button" onClick={save} disabled={busy || lines.length === 0} className="rounded-xl gold-foil px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save autoship'}
            </button>
            {plan && <button type="button" onClick={() => { setEditing(false); void load(); }} className="rounded-xl border border-[var(--line-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">Cancel</button>}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--faint)]">
            Delivered to your saved address. Prices include GST; the order is priced on the day. Add money to your shopping wallet before the day so the order can be paid.
          </p>
        </section>
      )}
    </div>
  );
}
