import { describe, expect, it } from "vitest";
import {
  MY_ORDERS_KEY,
  MY_ORDERS_MAX,
  addEntry,
  createMyOrdersStore,
  parseEntries,
  removeEntry,
  type MyOrderEntry,
} from "@/lib/myOrders";
import type { StorageLike } from "@/lib/cart";

const e = (n: number, savedAt = n): MyOrderEntry => ({ token: `t${n}`, orderNo: `B-${n}`, savedAt });

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

describe("myOrders pure helpers", () => {
  it("uses the documented key", () => {
    expect(MY_ORDERS_KEY).toBe("bb_orders_v1");
    expect(MY_ORDERS_MAX).toBe(20);
  });

  it("adds newest first", () => {
    expect(addEntry([e(1)], e(2)).map((x) => x.token)).toEqual(["t2", "t1"]);
  });

  it("dedupes by token: the re-visit moves to the front with the new time", () => {
    const list = addEntry([e(2), e(1)], { token: "t1", orderNo: "B-1", savedAt: 99 });
    expect(list).toEqual([{ token: "t1", orderNo: "B-1", savedAt: 99 }, e(2)]);
  });

  it("keeps at most 20, dropping the oldest", () => {
    let list: MyOrderEntry[] = [];
    for (let i = 1; i <= 25; i++) list = addEntry(list, e(i));
    expect(list).toHaveLength(20);
    expect(list[0].token).toBe("t25");
    expect(list[19].token).toBe("t6");
  });

  it("removes by token and ignores unknown tokens", () => {
    expect(removeEntry([e(2), e(1)], "t2")).toEqual([e(1)]);
    expect(removeEntry([e(1)], "nope")).toEqual([e(1)]);
  });

  it("parses defensively: bad JSON, wrong shapes, duplicates, over-long lists", () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries("not json")).toEqual([]);
    expect(parseEntries('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([
      e(1),
      { token: "", orderNo: "x", savedAt: 1 },
      { token: "t2", orderNo: 5, savedAt: 1 },
      { token: "t3", orderNo: "B-3", savedAt: "x" },
      null,
      "str",
      e(1),
      { token: "t4", orderNo: "B-4", savedAt: 4, extra: "dropped" },
    ]);
    expect(parseEntries(raw)).toEqual([e(1), e(4)]);
    const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => e(i + 1)));
    expect(parseEntries(many)).toHaveLength(20);
  });
});

describe("myOrders store", () => {
  it("records, persists under bb_orders_v1 and reads back", () => {
    const storage = memoryStorage();
    const store = createMyOrdersStore(() => storage);
    store.record("tokA", "B-1", 100);
    store.record("tokB", "B-2", 200);
    store.record("tokA", "B-1", 300);
    expect(store.list().map((x) => x.token)).toEqual(["tokA", "tokB"]);
    expect(JSON.parse(storage.data[MY_ORDERS_KEY])).toHaveLength(2);
    const again = createMyOrdersStore(() => storage);
    expect(again.list()[0]).toEqual({ token: "tokA", orderNo: "B-1", savedAt: 300 });
    again.remove("tokA");
    expect(JSON.parse(storage.data[MY_ORDERS_KEY]).map((x: MyOrderEntry) => x.token)).toEqual(["tokB"]);
  });

  it("never throws when storage is unavailable, and keeps working in memory", () => {
    const store = createMyOrdersStore(() => {
      throw new Error("SecurityError");
    });
    expect(store.list()).toEqual([]);
    expect(() => store.record("a", "B-1", 1)).not.toThrow();
    expect(store.list().map((x) => x.token)).toEqual(["a"]);
    const failingWrite = createMyOrdersStore(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    }));
    expect(() => failingWrite.record("a", "B-1", 1)).not.toThrow();
    expect(() => failingWrite.remove("a")).not.toThrow();
  });

  it("re-reads storage on every list() so another tab's changes show up", () => {
    const storage = memoryStorage();
    const a = createMyOrdersStore(() => storage);
    const b = createMyOrdersStore(() => storage);
    a.record("x", "B-1", 1);
    expect(b.list().map((v) => v.token)).toEqual(["x"]);
  });
});
