// Customer cart: `{ productId, qty }[]` persisted in localStorage under `bb_cart_v1`.
// Every storage access is wrapped in try/catch (WeChat / private modes can throw);
// the module always keeps an in-memory copy, so a failing storage only loses persistence.

import { useSyncExternalStore } from "react";

export const CART_STORAGE_KEY = "bb_cart_v1";

export interface CartItem {
  productId: string;
  qty: number;
}

/** The subset of the Web Storage API the cart uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CartStore {
  /** Stable reference until the cart changes (safe for useSyncExternalStore). */
  getItems(): readonly CartItem[];
  subscribe(listener: () => void): () => void;
  /** Sets a line's qty, clamped to [0, max]; 0 removes the line. */
  setQty(productId: string, qty: number, max: number): void;
  /** +1, never above max. */
  increment(productId: string, max: number): void;
  /** -1; removes the line at 0. */
  decrement(productId: string): void;
  remove(productId: string): void;
  clear(): void;
  /** Drops lines whose product is not in `productIds` (vanished from the menu). Returns how many lines went. */
  retainProducts(productIds: Iterable<string>): number;
  /** True once after `retainProducts` dropped lines: the bag sheet tells the customer, one time. */
  consumeRemovedNotice(): boolean;
  /** Re-reads the storage (another tab changed the cart) and notifies when the cart differs. */
  refresh(): void;
  /** Total number of pieces. */
  count(): number;
}

const EMPTY: readonly CartItem[] = Object.freeze([]);

function sanitize(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { productId, qty } = entry as { productId?: unknown; qty?: unknown };
    if (typeof productId !== "string" || !productId) continue;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    merged.set(productId, (merged.get(productId) ?? 0) + qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

/**
 * `getStorage` is called lazily on every access and may itself throw
 * (e.g. touching `window.localStorage` when it's blocked).
 */
export function createCartStore(getStorage: () => StorageLike | null | undefined): CartStore {
  let items: readonly CartItem[] | null = null;
  const listeners = new Set<() => void>();
  let removedNotice = false;

  function load(): readonly CartItem[] {
    if (items) return items;
    let parsed: CartItem[] = [];
    try {
      const raw = getStorage()?.getItem(CART_STORAGE_KEY);
      if (raw) parsed = sanitize(JSON.parse(raw));
    } catch {
      // Unreadable storage or corrupt JSON: start empty, in memory.
    }
    items = parsed.length ? parsed : EMPTY;
    return items;
  }

  function commit(next: CartItem[]): void {
    items = next.length ? next : EMPTY;
    try {
      getStorage()?.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full / blocked: keep the in-memory copy only.
    }
    for (const listener of [...listeners]) listener();
  }

  /** Another tab wrote the cart: adopt it. Unreadable storage keeps the in-memory copy. */
  function refresh(): void {
    let next: CartItem[];
    try {
      const storage = getStorage();
      if (!storage) return;
      const raw = storage.getItem(CART_STORAGE_KEY);
      next = raw ? sanitize(JSON.parse(raw)) : [];
    } catch {
      return;
    }
    const current = load();
    if (current.length === next.length && current.every((c, i) => c.productId === next[i].productId && c.qty === next[i].qty)) {
      return;
    }
    items = next.length ? next : EMPTY;
    for (const listener of [...listeners]) listener();
  }

  function qtyOf(productId: string): number {
    return load().find((i) => i.productId === productId)?.qty ?? 0;
  }

  function setQty(productId: string, qty: number, max: number): void {
    const limit = Math.max(0, Math.floor(max));
    const clamped = Math.max(0, Math.min(Math.floor(qty), limit));
    const current = load();
    const exists = current.some((i) => i.productId === productId);
    let next: CartItem[];
    if (clamped === 0) {
      if (!exists) return;
      next = current.filter((i) => i.productId !== productId);
    } else if (exists) {
      if (qtyOf(productId) === clamped) return;
      next = current.map((i) => (i.productId === productId ? { productId, qty: clamped } : i));
    } else {
      next = [...current, { productId, qty: clamped }];
    }
    commit(next);
  }

  return {
    getItems: load,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setQty,
    increment(productId, max) {
      const current = qtyOf(productId);
      if (current >= max) return;
      setQty(productId, current + 1, max);
    },
    decrement(productId) {
      const current = qtyOf(productId);
      if (current <= 0) return;
      // Decrementing never needs the max; use the current qty as the ceiling.
      setQty(productId, current - 1, current);
    },
    remove(productId) {
      const current = load();
      if (!current.some((i) => i.productId === productId)) return;
      commit(current.filter((i) => i.productId !== productId));
    },
    clear() {
      if (load().length === 0) return;
      commit([]);
    },
    retainProducts(productIds) {
      const keep = new Set(productIds);
      const current = load();
      const next = current.filter((i) => keep.has(i.productId));
      const dropped = current.length - next.length;
      if (dropped > 0) {
        removedNotice = true;
        commit(next);
      }
      return dropped;
    },
    consumeRemovedNotice() {
      const had = removedNotice;
      removedNotice = false;
      return had;
    },
    refresh,
    count() {
      return load().reduce((sum, i) => sum + i.qty, 0);
    },
  };
}

/** The app-wide cart, backed by window.localStorage when available. */
export const cart: CartStore = createCartStore(() =>
  typeof window === "undefined" ? null : window.localStorage,
);

// Another tab (or window) changed the cart: follow it. `key === null` is localStorage.clear().
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === CART_STORAGE_KEY) cart.refresh();
  });
}

function getServerSnapshot(): readonly CartItem[] {
  return EMPTY;
}

/** Subscribes a component to the cart. Empty during SSR and hydration. */
export function useCart(): readonly CartItem[] {
  return useSyncExternalStore(cart.subscribe, cart.getItems, getServerSnapshot);
}

function noopSubscribe(): () => void {
  return () => {};
}

/** false during SSR and hydration, true once the cart has been read on the client. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
