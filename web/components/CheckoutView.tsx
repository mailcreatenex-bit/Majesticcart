'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from './CartProvider';
import { api, ApiError, newRequestId } from '@/lib/api';
import { checkoutBlock, checkoutLines, rechargeSuggestion, type CheckoutBlock } from '@/lib/cart';
import { formatRupees, showMoney, type MoneyView } from '@/lib/money';
import { INDIAN_STATES } from '@/lib/states';

/**
 * Checkout.
 *
 * The rule the whole platform is built on lives here: **there is no way to pay
 * directly.** No card field, no netbanking, no cash on delivery, no payment
 * gateway of any kind. An order is paid from the shopping wallet or it is not
 * placed.
 *
 * That makes the interesting state not "pay" but "not enough" — and the job of
 * this screen is to make that a two-tap detour rather than a dead end. A member
 * who is ₹240 short gets a recharge link with ₹240 already filled in, and comes
 * back to a bag that is still exactly as they left it.
 *
 * The other thing this screen must not do is place two orders. On Indian mobile
 * data a slow POST looks like a failed one, and the member taps again. Hence
 * one idempotency key per attempt, generated once and reused across retries.
 */

interface Dashboard {
  member: { name: string; phone: string };
  wallets: { shopping: MoneyView; income: MoneyView };
}

interface Address {
  name: string; phone: string; line: string;
  city: string; state: string; pincode: string;
}

/**
 * What the server quotes.
 *
 * Indian prices are quoted GST-inclusive, so `total` is the sum of the shelf
 * prices and `gst` is a component of it — not a line added underneath. The
 * summary below has to present it that way or the arithmetic reads as wrong.
 */
interface Quote {
  total: MoneyView;
  taxable: MoneyView;
  gst: MoneyView;
  mrpTotal: MoneyView;
  discount: MoneyView;
  businessVolume: { centi: number; display: string };
  tax: { intraState: boolean; placeOfSupply: string; heads: string[] };
  wallet: { shopping: MoneyView; affordable: boolean; shortfall: MoneyView };
  coupon: { code: string; description: string | null; discount: MoneyView } | null;
  couponError: string | null;
}

const EMPTY_ADDRESS: Address = { name: '', phone: '', line: '', city: '', state: '', pincode: '' };

export function CheckoutView() {
  const router = useRouter();
  const { cart, totals, ready, clear } = useCart();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Two states on purpose: `couponInput` is what the member is typing,
  // `couponCode` is what was last submitted with "Apply" and is what
  // actually goes into the quote request. Re-quoting on every keystroke
  // would fire a request per letter and flash the coupon field's error
  // state before the member has finished typing the code.
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState('');

  /**
   * One requestId per checkout attempt.
   *
   * It travels in the **body**, not a header: the API reads `requestId` off the
   * checkout payload and derives its ledger idempotency key from it. A header
   * would look like protection and do nothing, since nothing on this API reads
   * one.
   *
   * Generated once and kept until an order actually succeeds, so a retry after
   * a timeout is recognised as the same order rather than placed as a second
   * one.
   */
  const attemptKey = useRef<string>('');
  if (!attemptKey.current) attemptKey.current = newRequestId();

  /* ------------------------------------------------------------- load */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [me, saved] = await Promise.all([
          api<Dashboard>('/me'),
          // A saved address is a convenience, not a requirement. Its absence is
          // an empty form, never an error.
          api<{ address: Address | null }>('/me/address').catch(() => ({ address: null })),
        ]);
        if (cancelled) return;
        setDashboard(me);
        if (saved.address) setAddress(saved.address);
        else setAddress((a) => ({ ...a, name: me.member.name, phone: me.member.phone }));
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your wallet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /* ------------------------------------------------------------ quote */

  /**
   * Re-quote whenever the bag or the delivery state changes.
   *
   * The state is what decides CGST+SGST versus IGST, so it genuinely changes
   * the total — this is not a cosmetic refresh. Debounced, because it fires on
   * every keystroke in the address form otherwise.
   */
  const requestQuote = useCallback(async (signal: AbortSignal) => {
    if (cart.lines.length === 0 || !address.state) { setQuote(null); return; }
    try {
      const q = await api<Quote>('/orders/quote', {
        method: 'POST',
        body: {
          lines: checkoutLines(cart),
          state: address.state,
          pincode: address.pincode || undefined,
          couponCode: couponCode || undefined,
        },
        signal,
      });
      setQuote(q);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // A failed quote must not block the page: the member can still see their
      // bag, and the order button stays disabled because `quote` is null.
      setQuote(null);
    }
  }, [cart, address.state, address.pincode, couponCode]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void requestQuote(controller.signal), 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestQuote]);

  /* ------------------------------------------------------------ gating */

  const shoppingPaise = dashboard?.wallets.shopping.paise ?? 0;
  const hasAddress = useMemo(
    () => Boolean(address.name && address.phone && address.line && address.city && address.state && address.pincode),
    [address],
  );

  /**
   * The client's own check, for disabling the button without waiting.
   *
   * The server has already answered the same question in `quote.wallet`, and
   * that is the answer that counts — it read the wallet inside the request
   * rather than from a dashboard fetched when the page loaded. So when a quote
   * is in hand, its balance is used rather than the stale one.
   */
  const block: CheckoutBlock = checkoutBlock({
    cart,
    shoppingBalancePaise: quote?.wallet.shopping.paise ?? shoppingPaise,
    payablePaise: quote?.total.paise,
    hasAddress,
  });

  /* ------------------------------------------------------------- place */

  const placeOrder = async () => {
    if (block || placing) return;
    setPlacing(true);
    setError(null);
    setFieldErrors({});

    try {
      const order = await api<{ id: string; orderNo: string }>('/orders', {
        method: 'POST',
        // requestId, not a header. The same value across retries, so a re-tap
        // after a timeout cannot produce a second order.
        body: {
          lines: checkoutLines(cart),
          shipping: address,
          requestId: attemptKey.current,
          couponCode: quote?.coupon ? couponCode : undefined,
        },
      });

      // Cleared only after the server has confirmed. Clearing optimistically
      // and then failing would lose the bag and leave nothing to retry with.
      clear();
      router.push(`/orders/${order.id}?placed=1`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not place the order. Please try again.');
      }
      setPlacing(false);
    }
  };

  /* -------------------------------------------------------------- view */

  if (!ready || loading) return <CheckoutSkeleton />;

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl text-[var(--ink)]">Nothing to check out</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Your bag is empty.</p>
        <Link href="/shop" className="mt-8 inline-block rounded-xl bg-[var(--ink)] px-7 py-3.5 font-semibold text-[var(--gold-pale)]">
          Shop the range
        </Link>
      </div>
    );
  }

  const payable = quote?.total.paise ?? totals.subtotalPaise;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-serif text-3xl text-[var(--ink)]">Checkout</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        {/* ----------------------------------------------------- address */}
        <section>
          <h2 className="font-serif text-xl text-[var(--ink)]">Delivery address</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <AddressField label="Full name" value={address.name} error={fieldErrors['shipping.name']}
              onChange={(v) => setAddress((a) => ({ ...a, name: v }))} autoComplete="name" />
            <AddressField label="Mobile number" value={address.phone} error={fieldErrors['shipping.phone']}
              onChange={(v) => setAddress((a) => ({ ...a, phone: v.replace(/\D/g, '').slice(0, 10) }))}
              inputMode="numeric" autoComplete="tel-national" hint="10 digits, for delivery updates" />

            <div className="sm:col-span-2">
              <AddressField label="Address" value={address.line} error={fieldErrors['shipping.line']}
                onChange={(v) => setAddress((a) => ({ ...a, line: v }))} autoComplete="street-address"
                hint="House or flat number, street, area, landmark" />
            </div>

            <AddressField label="City" value={address.city} error={fieldErrors['shipping.city']}
              onChange={(v) => setAddress((a) => ({ ...a, city: v }))} autoComplete="address-level2" />

            <div>
              <label className="block text-sm font-medium text-[var(--ink)]">
                State
                {/* The state decides CGST+SGST versus IGST, so it is a select
                    rather than free text: "WB", "W.B." and "West Bengal" must
                    not become three different tax treatments. */}
                <select
                  value={address.state}
                  onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
                  autoComplete="address-level1"
                  className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="">Choose a state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </label>
              {fieldErrors['shipping.state'] && (
                <p className="mt-1 text-xs text-[#C0392B]">{fieldErrors['shipping.state']}</p>
              )}
            </div>

            <AddressField label="PIN code" value={address.pincode} error={fieldErrors['shipping.pincode']}
              onChange={(v) => setAddress((a) => ({ ...a, pincode: v.replace(/\D/g, '').slice(0, 6) }))}
              inputMode="numeric" autoComplete="postal-code" />
          </div>
        </section>

        {/* ----------------------------------------------------- payment */}
        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg text-[var(--ink)]">Order summary</h2>

            <ul className="mt-3 space-y-2 border-b border-[var(--line)] pb-3">
              {cart.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-[var(--body)]">
                    {l.snapshot.name} × {l.quantity}
                  </span>
                  <span className="shrink-0 text-[var(--ink)]">
                    {formatRupees(l.snapshot.pricePaise * l.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Coupon apply/remove. A separate box from the totals below: this
                is an input the member acts on, not a read-only line. */}
            <div className="mt-3 border-b border-[var(--line)] pb-3">
              {quote?.coupon ? (
                <div className="flex items-center justify-between rounded-lg bg-[var(--page)] px-3 py-2 text-sm">
                  <span className="text-[var(--body)]">
                    <span className="font-mono font-semibold text-[var(--ink)]">{quote.coupon.code}</span> applied
                  </span>
                  <button
                    type="button"
                    onClick={() => { setCouponCode(''); setCouponInput(''); }}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Coupon code"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm uppercase text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setCouponCode(couponInput.trim())}
                    disabled={!couponInput.trim()}
                    className="shrink-0 rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:text-[var(--faint)]"
                  >
                    Apply
                  </button>
                </div>
              )}
              {quote?.couponError && (
                <p className="mt-1.5 text-xs text-[#C0392B]">{quote.couponError}</p>
              )}
            </div>

            <dl className="mt-3 space-y-2 text-sm">
              {quote && quote.discount.paise > 0 && (
                <>
                  <Row label="Item total at MRP" value={showMoney(quote.mrpTotal)} />
                  <Row label="Discount" value={`−${showMoney(quote.discount)}`} />
                </>
              )}
              {quote?.coupon && quote.coupon.discount.paise > 0 && (
                <Row label={`Coupon (${quote.coupon.code})`} value={`−${showMoney(quote.coupon.discount)}`} />
              )}
              <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base font-semibold text-[var(--ink)]">
                <dt>Total</dt>
                <dd>{quote ? showMoney(quote.total) : formatRupees(totals.subtotalPaise)}</dd>
              </div>
              {/* Indented under the total, because the GST is inside it. Shown
                  as a line of its own it reads as an extra charge. */}
              {quote && (
                <div className="flex justify-between pl-3 text-xs">
                  <dt className="text-[var(--muted)]">
                    of which {quote.tax.heads.join(' + ')}
                  </dt>
                  <dd className="text-[var(--muted)]">{showMoney(quote.gst)}</dd>
                </div>
              )}
            </dl>

            {quote ? (
              <p className="mt-3 text-xs text-[var(--faint)]">
                Prices include GST. Place of supply: {quote.tax.placeOfSupply}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Choose a state to confirm the total.
              </p>
            )}
          </div>

          {/* ------------------------------------------------- the wallet */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-serif text-lg text-[var(--ink)]">Payment</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Orders are paid from your shopping wallet. There is no card payment on this site.
            </p>

            <div className="mt-4 flex items-baseline justify-between rounded-xl bg-[var(--page)] px-4 py-3">
              <span className="text-sm text-[var(--body)]">Shopping wallet</span>
              <span className="font-semibold text-[var(--ink)]">
                {dashboard ? showMoney(dashboard.wallets.shopping) : '—'}
              </span>
            </div>

            {/* The income wallet is shown so the member is not left wondering
                where their commission went. It cannot buy — that separation is
                what keeps a shopping recharge from being withdrawable, which is
                what would make it a deposit. */}
            {dashboard && dashboard.wallets.income.paise > 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Income wallet: {showMoney(dashboard.wallets.income)} — withdrawable to your bank,
                not spendable here.
              </p>
            )}

            {block?.kind === 'insufficient' && (
              <div className="mt-4 rounded-xl border border-[var(--notice-border)] bg-[var(--notice-bg)] p-4">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  {formatRupees(block.shortfallPaise)} short
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--body)]">
                  Add at least {formatRupees(rechargeSuggestion(block.shortfallPaise))} to your
                  shopping wallet. Your bag will still be here when you come back.
                </p>
                {/* Amount pre-filled: the member should not have to work out
                    the number they were just shown. */}
                <Link
                  href={`/recharge?amount=${rechargeSuggestion(block.shortfallPaise) / 100}&next=/checkout`}
                  className="mt-3 block rounded-xl bg-[var(--ink)] px-5 py-3 text-center font-semibold text-[var(--gold-pale)]"
                >
                  Add money to wallet
                </Link>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-[#FDECEA] px-4 py-3 text-sm text-[#C0392B]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={placeOrder}
              disabled={!!block || placing || !quote}
              className="mt-4 w-full rounded-xl gold-foil px-6 py-3.5 font-semibold text-white shadow-lg shadow-amber-900/20 disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#E8DDE3] disabled:text-[#A79AA1] disabled:shadow-none"
            >
              {placing ? 'Placing your order…' : `Pay ${formatRupees(payable)} from wallet`}
            </button>

            {block?.kind === 'address' && (
              <p className="mt-2 text-center text-xs text-[var(--muted)]">
                Fill in the delivery address to continue.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={muted ? 'text-[var(--faint)]' : 'text-[var(--ink)]'}>{value}</dd>
    </div>
  );
}

function AddressField({
  label, value, onChange, hint, error, inputMode, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  inputMode?: 'numeric' | 'text';
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--ink)]">
        {label}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          className="mt-1.5 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      {error ? (
        <p className="mt-1 text-xs text-[#C0392B]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--faint)]">{hint}</p>
      ) : null}
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="h-9 w-40 animate-pulse rounded-lg bg-[var(--surface-tint)]" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--surface-tint)]" />)}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-[var(--surface-tint)]" />
      </div>
    </div>
  );
}
