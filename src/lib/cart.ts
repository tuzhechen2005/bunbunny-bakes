// Customer cart: `{ productId, flavorId?, qty }[]` persisted in localStorage under `bb_cart_v1`.
// A line is identified by its key: the product id, or `productId::flavorId` for a flavour (F1).
// Every storage access is wrapped in try/catch (WeChat / private modes can throw);
// the module always keeps an in-memory copy, so a failing storage only loses persistence.

import { useSyncExternalStore } from "react";

export const CART_STORAGE_KEY = "bb_cart_v1";

export interface CartItem {
  productId: string;
  qty: number;
  /** Chosen flavour (F1); absent for products without flavours. */
  flavorId?: string | null;
}

const SEP = "::";
/** The line key used by every store method: productId, or productId::flavorId. */
export function lineKey(i: { productId: string; flavorId?: string | null }): string {
  return i.flavorId ? `${i.productId}${SEP}${i.flavorId}` : i.productId;
}
export function parseLineKey(key: string): { productId: string; flavorId: string | null } {
  const at = key.indexOf(SEP);
  return at < 0 ? { productId: key, flavorId: null } : { productId: key.slice(0, at), flavorId: key.slice(at + SEP.length) || null };
}
const lineOf = (key: string, qty: number): CartItem => {
  const { productId, flavorId } = parseLineKey(key);
  return flavorId ? { productId, flavorId, qty } : { productId, qty };
};

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
  /** Replaces the whole cart (the rest of a split order). */
  replace(next: readonly CartItem[]): void;
  /** Total number of pieces. */
  count(): number;
}

const EMPTY: readonly CartItem[] = Object.freeze([]);

function sanitize(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { productId, qty, flavorId } = entry as { productId?: unknown; qty?: unknown; flavorId?: unknown };
    if (typeof productId !== "string" || !productId || productId.includes(SEP)) continue;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    const flavor = typeof flavorId === "string" && flavorId ? flavorId : null;
    const key = lineKey({ productId, flavorId: flavor });
    merged.set(key, (merged.get(key) ?? 0) + qty);
  }
  return [...merged].map(([key, qty]) => lineOf(key, qty));
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
    if (current.length === next.length && current.every((c, i) => lineKey(c) === lineKey(next[i]) && c.qty === next[i].qty)) {
      return;
    }
    items = next.length ? next : EMPTY;
    for (const listener of [...listeners]) listener();
  }

  function qtyOf(key: string): number {
    return load().find((i) => lineKey(i) === key)?.qty ?? 0;
  }

  /** `key` is a line key (see lineKey); a bare product id addresses the unflavoured line. */
  function setQty(key: string, qty: number, max: number): void {
    const limit = Math.max(0, Math.floor(max));
    const clamped = Math.max(0, Math.min(Math.floor(qty), limit));
    const current = load();
    const exists = current.some((i) => lineKey(i) === key);
    let next: CartItem[];
    if (clamped === 0) {
      if (!exists) return;
      next = current.filter((i) => lineKey(i) !== key);
    } else if (exists) {
      if (qtyOf(key) === clamped) return;
      next = current.map((i) => (lineKey(i) === key ? lineOf(key, clamped) : i));
    } else {
      next = [...current, lineOf(key, clamped)];
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
    remove(key) {
      const current = load();
      if (!current.some((i) => lineKey(i) === key)) return;
      commit(current.filter((i) => lineKey(i) !== key));
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
    replace(next) {
      commit(sanitize(next));
    },
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

/** Preferred pickup date (YYYY-MM-DD) handed from the bag / a split order / the assistant to checkout. */
export const PREFERRED_DATE_KEY = "bb_cart_date_v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function setPreferredDate(date: string): void {
  if (!DATE_RE.test(date)) return;
  try {
    window.localStorage.setItem(PREFERRED_DATE_KEY, date);
  } catch {
    // Storage blocked: the hand-off is only a convenience.
  }
}

export function getPreferredDate(): string | null {
  try {
    const raw = window.localStorage.getItem(PREFERRED_DATE_KEY);
    return raw && DATE_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function clearPreferredDate(): void {
  try {
    window.localStorage.removeItem(PREFERRED_DATE_KEY);
  } catch {
    // ignore
  }
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
