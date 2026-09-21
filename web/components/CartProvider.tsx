'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  readCart, writeCart, addLine, setQuantity, removeLine, clearCart, totals,
  CART_STORAGE_KEY, EMPTY_CART, type Cart, type CartLine, type CartTotals,
} from '@/lib/cart';

/**
 * The bag, shared across the app.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *
 *   1. **The first render is always the empty cart**, on the server and on the
 *      client. Reading localStorage during render would make the two disagree
 *      and React would throw a hydration error on every page load for anyone
 *      with something in their bag. The stored cart arrives in an effect.
 *   2. **The `storage` event keeps tabs in sync.** A member who adds something
 *      in one tab and checks out in another must not lose it. The event only
 *      fires in *other* tabs, so there is no loop to guard against.
 */

interface CartContextValue {
  cart: Cart;
  totals: CartTotals;
  /** False until the stored cart has loaded. Guards the empty-bag message. */
  ready: boolean;
  add: (line: Omit<CartLine, 'addedAt' | 'quantity'> & { quantity?: number }) => void;
  setQty: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCart(readCart(window.localStorage));
    setReady(true);

    // Fires only in other tabs, so this cannot loop with the writes below.
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_STORAGE_KEY) setCart(readCart(window.localStorage));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Every mutation goes through here, so nothing can change state without persisting. */
  const commit = useCallback((next: Cart) => {
    setCart(next);
    writeCart(window.localStorage, next);
  }, []);

  const value = useMemo<CartContextValue>(() => ({
    cart,
    totals: totals(cart),
    ready,
    add: (line) => commit(addLine(cart, line)),
    setQty: (productId, quantity) => commit(setQuantity(cart, productId, quantity)),
    remove: (productId) => commit(removeLine(cart, productId)),
    clear: () => commit(clearCart()),
  }), [cart, ready, commit]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

/**
 * The count for the header badge.
 *
 * Renders nothing until the stored cart has loaded, rather than flashing a zero
 * and then the real number on every page load.
 */
export function CartCount() {
  const { totals: t, ready } = useCart();
  if (!ready || t.itemCount === 0) return null;

  return (
    <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold text-white">
      {t.itemCount}
    </span>
  );
}
