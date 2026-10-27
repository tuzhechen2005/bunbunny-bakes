import { describe, expect, it, vi } from "vitest";
import { uuidV4 } from "@/lib/api";
import {
  CART_STORAGE_KEY,
  PREFERRED_DATE_KEY,
  clearPreferredDate,
  createCartStore,
  getPreferredDate,
  setPreferredDate,
  type StorageLike,
} from "@/lib/cart";

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

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("cart store", () => {
  it("adds and removes lines", () => {
    const store = createCartStore(() => memoryStorage());
    store.increment("a", 8);
    store.increment("a", 8);
    store.increment("b", 8);
    expect(store.getItems()).toEqual([
      { productId: "a", qty: 2 },
      { productId: "b", qty: 1 },
    ]);
    expect(store.count()).toBe(3);
    store.decrement("a");
    store.decrement("b");
    expect(store.getItems()).toEqual([{ productId: "a", qty: 1 }]);
    store.remove("a");
    expect(store.getItems()).toEqual([]);
    store.decrement("missing");
    expect(store.getItems()).toEqual([]);
  });

  it("clamps to the max per item", () => {
    const store = createCartStore(() => memoryStorage());
    for (let i = 0; i < 10; i++) store.increment("a", 8);
    expect(store.getItems()).toEqual([{ productId: "a", qty: 8 }]);
    store.setQty("a", 20, 8);
    expect(store.getItems()).toEqual([{ productId: "a", qty: 8 }]);
    store.setQty("a", -3, 8);
    expect(store.getItems()).toEqual([]);
  });

  it("persists to localStorage under bb_cart_v1 and reloads", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);
    store.setQty("a", 3, 8);
    expect(JSON.parse(storage.data[CART_STORAGE_KEY])).toEqual([{ productId: "a", qty: 3 }]);
    const reloaded = createCartStore(() => storage);
    expect(reloaded.getItems()).toEqual([{ productId: "a", qty: 3 }]);
    reloaded.clear();
    expect(JSON.parse(storage.data[CART_STORAGE_KEY])).toEqual([]);
  });

  it("ignores corrupt or malformed stored data", () => {
    expect(createCartStore(() => memoryStorage({ [CART_STORAGE_KEY]: "{not json" })).getItems()).toEqual([]);
    const store = createCartStore(() =>
      memoryStorage({
        [CART_STORAGE_KEY]: JSON.stringify([
          { productId: "a", qty: 2 },
          { productId: "a", qty: 1 },
          { productId: "b", qty: 0 },
          { productId: "c", qty: 1.5 },
          { qty: 1 },
          "junk",
        ]),
      }),
    );
    expect(store.getItems()).toEqual([{ productId: "a", qty: 3 }]);
  });

  it("falls back to memory when localStorage throws", () => {
    const store = createCartStore(() => throwingStorage);
    store.increment("a", 8);
    store.increment("a", 8);
    expect(store.getItems()).toEqual([{ productId: "a", qty: 2 }]);
    const noAccess = createCartStore(() => {
      throw new Error("localStorage is not available");
    });
    noAccess.setQty("b", 4, 8);
    expect(noAccess.getItems()).toEqual([{ productId: "b", qty: 4 }]);
  });

  it("drops products that vanished from the menu", () => {
    const storage = memoryStorage({
      [CART_STORAGE_KEY]: JSON.stringify([
        { productId: "a", qty: 1 },
        { productId: "gone", qty: 2 },
      ]),
    });
    const store = createCartStore(() => storage);
    store.retainProducts(["a", "b"]);
    expect(store.getItems()).toEqual([{ productId: "a", qty: 1 }]);
    expect(JSON.parse(storage.data[CART_STORAGE_KEY])).toEqual([{ productId: "a", qty: 1 }]);
  });

  it("remembers that lines were dropped, once (the bag sheet shows a notice)", () => {
    const store = createCartStore(() =>
      memoryStorage({ [CART_STORAGE_KEY]: JSON.stringify([{ productId: "a", qty: 1 }, { productId: "gone", qty: 2 }]) }),
    );
    expect(store.consumeRemovedNotice()).toBe(false);
    expect(store.retainProducts(["a"])).toBe(1);
    expect(store.retainProducts(["a"])).toBe(0); // nothing more to drop
    expect(store.consumeRemovedNotice()).toBe(true);
    expect(store.consumeRemovedNotice()).toBe(false); // one-time
  });

  it("refresh() picks up another tab's change and notifies only when something changed", () => {
    const storage = memoryStorage();
    const store = createCartStore(() => storage);
    store.increment("a", 8);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getItems();
    store.refresh();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getItems()).toBe(before); // same snapshot reference

    storage.data[CART_STORAGE_KEY] = JSON.stringify([{ productId: "b", qty: 3 }]);
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getItems()).toEqual([{ productId: "b", qty: 3 }]);

    delete storage.data[CART_STORAGE_KEY]; // the other tab cleared the cart
    store.refresh();
    expect(store.getItems()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("refresh() keeps the in-memory cart when storage is unreadable", () => {
    const store = createCartStore(() => throwingStorage);
    store.increment("a", 8);
    store.refresh();
    expect(store.getItems()).toEqual([{ productId: "a", qty: 1 }]);
  });

  it("notifies subscribers and keeps a stable snapshot between changes", () => {
    const store = createCartStore(() => memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getItems();
    expect(store.getItems()).toBe(before);
    store.increment("a", 8);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getItems()).not.toBe(before);
    store.increment("a", 1); // already at max: no change, no notification
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("uuidV4", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("uses crypto.randomUUID when available", () => {
    expect(uuidV4({ randomUUID: () => "11111111-1111-4111-8111-111111111111" })).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("falls back to getRandomValues with a valid v4 format", () => {
    const fallback = {
      getRandomValues: <A extends Uint8Array>(a: A): A => globalThis.crypto.getRandomValues(a),
    };
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = uuidV4(fallback);
      expect(id).toMatch(V4);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });

  it("sets version and variant bits even for all-0xff bytes", () => {
    const id = uuidV4({ getRandomValues: <A extends Uint8Array>(a: A): A => (a.fill(0xff), a) });
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidV4({ getRandomValues: <A extends Uint8Array>(a: A): A => (a.fill(0), a) })).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("works with no crypto at all", () => {
    expect(uuidV4({})).toMatch(V4);
  });
});

describe("preferred date hand-off", () => {
  function withStorage(data: Record<string, string>) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => void (data[k] = v),
        removeItem: (k: string) => void delete data[k],
      },
    });
  }

  it("sets, reads and clears bb_cart_date_v1", () => {
    const data: Record<string, string> = {};
    withStorage(data);
    expect(getPreferredDate()).toBeNull();
    setPreferredDate("2026-11-04");
    expect(data[PREFERRED_DATE_KEY]).toBe("2026-11-04");
    expect(getPreferredDate()).toBe("2026-11-04");
    clearPreferredDate();
    expect(getPreferredDate()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("ignores malformed dates and survives a blocked storage", () => {
    const data: Record<string, string> = { [PREFERRED_DATE_KEY]: "tomorrow" };
    withStorage(data);
    expect(getPreferredDate()).toBeNull();
    setPreferredDate("11/4");
    expect(data[PREFERRED_DATE_KEY]).toBe("tomorrow");
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("SecurityError");
      },
    });
    expect(() => setPreferredDate("2026-11-04")).not.toThrow();
    expect(getPreferredDate()).toBeNull();
    expect(() => clearPreferredDate()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("replace() swaps the whole cart", () => {
    const store = createCartStore(() => memoryStorage());
    store.increment("a", 8);
    store.replace([{ productId: "b", qty: 2 }]);
    expect(store.getItems()).toEqual([{ productId: "b", qty: 2 }]);
  });
});
