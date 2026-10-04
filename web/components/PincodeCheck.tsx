'use client';

import { useEffect, useState } from 'react';

/**
 * "Deliver to my pincode" on the product page. Asks the store's delivery company when one is
 * set up (see Integrations in the admin console). When none is, it still answers, but only
 * says what it can stand behind: that the store ships across India and, if the admin has
 * written one, the usual delivery time. The last pincode is remembered on this device.
 */
const KEY = 'mc-pincode';

type Result =
  | { kind: 'yes'; pincode: string; eta: string | null }
  | { kind: 'no'; pincode: string }
  | { kind: 'unknown'; pincode: string; eta: string | null }
  | { kind: 'error'; message: string };

export function PincodeCheck() {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    try { setPin(localStorage.getItem(KEY) ?? ''); } catch { /* storage blocked */ }
  }, []);

  const check = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pin) || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/delivery/check?pincode=${pin}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) { setResult({ kind: 'error', message: typeof body?.message === 'string' ? body.message : 'Could not check that pincode.' }); return; }
      try { localStorage.setItem(KEY, pin); } catch { /* storage blocked */ }
      setResult(body.serviceable === true ? { kind: 'yes', pincode: pin, eta: body.eta } : body.serviceable === false ? { kind: 'no', pincode: pin } : { kind: 'unknown', pincode: pin, eta: body.eta });
    } catch {
      setResult({ kind: 'error', message: 'Could not reach the server. Check your connection.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Delivery" className="mt-5 rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Delivery</h2>
      <form onSubmit={check} className="mt-2 flex gap-2">
        <input
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setResult(null); }}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="Enter your pincode"
          aria-label="Pincode"
          className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
        />
        <button type="submit" disabled={busy || pin.length !== 6} className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-[var(--gold-pale)] disabled:opacity-50">
          {busy ? 'Checking…' : 'Check'}
        </button>
      </form>
      {result && (
        <p role="status" className={`mt-2 text-sm ${result.kind === 'no' || result.kind === 'error' ? 'text-[#C0392B]' : 'text-[var(--body)]'}`}>
          {result.kind === 'yes' && <>We deliver to <strong>{result.pincode}</strong>.{result.eta ? ` Usually ${result.eta}.` : ''}</>}
          {result.kind === 'no' && <>Sorry, we cannot deliver to <strong>{result.pincode}</strong> yet.</>}
          {result.kind === 'unknown' && <>We ship across India.{result.eta ? ` Usually ${result.eta}.` : ' Your delivery time is confirmed when the order ships.'}</>}
          {result.kind === 'error' && result.message}
        </p>
      )}
    </section>
  );
}
