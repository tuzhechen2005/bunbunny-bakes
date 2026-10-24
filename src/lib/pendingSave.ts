// Orders whose "save the link" modal has not been confirmed yet (D83, D89): `bb_pending_save_v1`
// in localStorage holds the view tokens. A token is added when the order is created (or first
// shown fresh) and removed by 我已保存; the order page shows the modal on every visit until then.
// Never uploaded. Every storage access is wrapped in try/catch (WeChat / private modes can throw).

import type { StorageLike } from "./cart";

export const PENDING_SAVE_KEY = "bb_pending_save_v1";
export const PENDING_SAVE_MAX = 20;

export interface PendingSaveStore {
  has(token: string): boolean;
  add(token: string): void;
  clear(token: string): void;
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((t): t is string => typeof t === "string" && t.length > 0))].slice(-PENDING_SAVE_MAX);
  } catch {
    return [];
  }
}

/** `getStorage` is called lazily on every access and may itself throw. */
export function createPendingSaveStore(getStorage: () => StorageLike | null | undefined): PendingSaveStore {
  /** Used when storage is unreadable, so the modal still follows the rules for this visit. */
  let memory: string[] = [];

  function read(): string[] {
    try {
      const storage = getStorage();
      if (!storage) return memory;
      return (memory = parse(storage.getItem(PENDING_SAVE_KEY)));
    } catch {
      return memory;
    }
  }
  function write(list: string[]) {
    memory = list;
    try {
      getStorage()?.setItem(PENDING_SAVE_KEY, JSON.stringify(list));
    } catch {
      /* it just isn't remembered across visits */
    }
  }

  return {
    has: (token) => read().includes(token),
    add(token) {
      const list = read();
      if (!list.includes(token)) write([...list, token].slice(-PENDING_SAVE_MAX));
    },
    clear(token) {
      const list = read();
      if (list.includes(token)) write(list.filter((t) => t !== token));
    },
  };
}

/** The app-wide store, backed by window.localStorage. */
export const pendingSave: PendingSaveStore = createPendingSaveStore(() =>
  typeof window === "undefined" ? null : window.localStorage,
);
