import { describe, expect, it } from "vitest";
import type { StorageLike } from "@/lib/cart";
import { PENDING_SAVE_KEY, PENDING_SAVE_MAX, createPendingSaveStore } from "@/lib/pendingSave";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("pendingSave", () => {
  it("remembers a token until it is cleared", () => {
    const storage = memoryStorage();
    const store = createPendingSaveStore(() => storage);
    expect(store.has("t1")).toBe(false);
    store.add("t1");
    store.add("t1");
    store.add("t2");
    expect(JSON.parse(storage.data[PENDING_SAVE_KEY])).toEqual(["t1", "t2"]);
    expect(store.has("t1")).toBe(true);
    // A new store over the same storage (a later visit) still knows.
    expect(createPendingSaveStore(() => storage).has("t2")).toBe(true);
    store.clear("t1");
    expect(store.has("t1")).toBe(false);
    expect(store.has("t2")).toBe(true);
  });

  it("keeps at most 20, dropping the oldest", () => {
    const storage = memoryStorage();
    const store = createPendingSaveStore(() => storage);
    for (let i = 0; i < PENDING_SAVE_MAX + 5; i++) store.add(`t${i}`);
    expect(store.has("t0")).toBe(false);
    expect(store.has("t4")).toBe(false);
    expect(store.has("t5")).toBe(true);
    expect(store.has(`t${PENDING_SAVE_MAX + 4}`)).toBe(true);
  });

  it("treats garbage as empty and survives throwing storage", () => {
    const garbage = createPendingSaveStore(() => memoryStorage({ [PENDING_SAVE_KEY]: "{nope" }));
    expect(garbage.has("t1")).toBe(false);
    const wrongShape = createPendingSaveStore(() => memoryStorage({ [PENDING_SAVE_KEY]: '{"a":1}' }));
    expect(wrongShape.has("a")).toBe(false);

    const throwing = createPendingSaveStore(() => ({
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    }));
    throwing.add("t1");
    expect(throwing.has("t1")).toBe(true); // in memory for this visit
    throwing.clear("t1");
    expect(throwing.has("t1")).toBe(false);
  });
});
