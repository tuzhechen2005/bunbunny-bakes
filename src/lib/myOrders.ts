// "My orders" on this phone (D84): every order link the customer opens is remembered in
// localStorage under `bb_orders_v1` as `{ token, orderNo, savedAt }`. Never uploaded.
// Every storage access is wrapped in try/catch (WeChat / private modes can throw).

import type { StorageLike } from "./cart";

export const MY_ORDERS_KEY = "bb_orders_v1";
export const MY_ORDERS_MAX = 20;

export interface MyOrderEntry {
  token: string;
  orderNo: string;
  /** ms since epoch of the last successful open. */
  savedAt: number;
}

/** Adds (or moves to the front) an entry: deduped by token, newest first, at most 20. */
export function addEntry(list: readonly MyOrderEntry[], entry: MyOrderEntry): MyOrderEntry[] {
  return [entry, ...list.filter((x) => x.token !== entry.token)].slice(0, MY_ORDERS_MAX);
}

export function removeEntry(list: readonly MyOrderEntry[], token: string): MyOrderEntry[] {
  return list.filter((x) => x.token !== token);
}

/** Parses the stored JSON; anything malformed is dropped. */
export function parseEntries(raw: string | null): MyOrderEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: MyOrderEntry[] = [];
  for (const v of data) {
    if (!v || typeof v !== "object") continue;
    const { token, orderNo, savedAt } = v as Record<string, unknown>;
    if (typeof token !== "string" || !token || typeof orderNo !== "string") continue;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ token, orderNo, savedAt });
    if (out.length >= MY_ORDERS_MAX) break;
  }
  return out;
}

export interface MyOrdersStore {
  list(): MyOrderEntry[];
  record(token: string, orderNo: string, now: number): void;
  remove(token: string): void;
}

/** `getStorage` is called lazily on every access and may itself throw. */
export function createMyOrdersStore(getStorage: () => StorageLike | null | undefined): MyOrdersStore {
  /** Used when storage is unreadable, so the page still works for this visit. */
  let memory: MyOrderEntry[] = [];

  function read(): MyOrderEntry[] {
    try {
      const storage = getStorage();
      if (!storage) return memory;
      return (memory = parseEntries(storage.getItem(MY_ORDERS_KEY)));
    } catch {
      return memory;
    }
  }
  function write(list: MyOrderEntry[]) {
    memory = list;
    try {
      getStorage()?.setItem(MY_ORDERS_KEY, JSON.stringify(list));
    } catch {
      /* the list just isn't remembered */
    }
  }

  return {
    list: read,
    record: (token, orderNo, now) => write(addEntry(read(), { token, orderNo, savedAt: now })),
    remove: (token) => write(removeEntry(read(), token)),
  };
}

function browserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** The app-wide store, backed by window.localStorage. */
export const myOrders = createMyOrdersStore(browserStorage);
