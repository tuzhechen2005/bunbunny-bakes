import { describe, expect, it } from "vitest";
import {
  dayDetail,
  monthBounds,
  shiftMonth,
  monthSummary,
  type LedgerManualEntry,
  type LedgerOrder,
} from "@/domain/ledger";

// Prices used below: Cheese = 600 each, bundle of 4 for 2000 (so 2 cost 1200, 4 cost 2000).
// Red bean = 500 each.
const CHEESE = "p-cheese";
const BEAN = "p-bean";

function order(over: Partial<LedgerOrder> & Pick<LedgerOrder, "orderNo">): LedgerOrder {
  return {
    wechatId: "wx",
    pickupDate: "2026-11-07",
    status: "COMPLETED",
    paid: true,
    paidMethod: "WECHAT",
    totalCents: 0,
    deliveryFeeCents: 0,
    items: [],
    ...over,
  };
}

function manual(over: Partial<LedgerManualEntry> & Pick<LedgerManualEntry, "id">): LedgerManualEntry {
  return {
    date: "2026-11-07",
    amountCents: 100,
    note: "x",
    paidMethod: "CASH",
    items: [],
    ...over,
  };
}

const cheese = (qty: number, lineTotalCents: number) => ({
  productId: CHEESE,
  name: "Cheese",
  qty,
  lineTotalCents,
});
const bean = (qty: number, lineTotalCents: number) => ({
  productId: BEAN,
  name: "Bean",
  qty,
  lineTotalCents,
});

describe("dayDetail", () => {
  const orders: LedgerOrder[] = [
    // Alice: 2 cheese = 1200, paid via WeChat
    order({ orderNo: "1107-001", wechatId: "alice", totalCents: 1200, items: [cheese(2, 1200)] }),
    // Bob: 2 cheese (1200) + 1 bean (500) + 500 delivery = 2200, paid via Zelle
    order({
      orderNo: "1107-002",
      wechatId: "bob",
      paidMethod: "ZELLE",
      totalCents: 2200,
      deliveryFeeCents: 500,
      items: [cheese(2, 1200), bean(1, 500)],
    }),
    // Cara: 3 beans = 1500, paid, method never recorded -> UNSPECIFIED (未注明)
    order({ orderNo: "1107-003", wechatId: "cara", paidMethod: null, totalCents: 1500, items: [bean(3, 1500)] }),
    // Dan: 4 cheese = 2000, not paid yet -> receivable only
    order({
      orderNo: "1107-004",
      wechatId: "dan",
      paid: false,
      paidMethod: null,
      status: "CONFIRMED",
      totalCents: 2000,
      items: [cheese(4, 2000)],
    }),
    // Eve: cancelled (even though flagged paid), Fay: rejected -> counted nowhere
    order({ orderNo: "1107-005", status: "CANCELLED", totalCents: 900, items: [bean(1, 500)] }),
    order({ orderNo: "1107-006", status: "REJECTED", paid: false, totalCents: 700, items: [cheese(1, 600)] }),
    // another day: ignored
    order({ orderNo: "1108-001", pickupDate: "2026-11-08", totalCents: 5000, items: [bean(10, 5000)] }),
  ];
  const entries: LedgerManualEntry[] = [
    manual({ id: "m1", amountCents: 1500, paidMethod: "CASH", note: "walk-in", items: [{ productId: BEAN, name: "Bean", qty: 2 }] }),
    manual({ id: "m2", amountCents: 700, paidMethod: "VENMO", note: "tip jar" }),
    manual({ id: "m3", date: "2026-11-09", amountCents: 999 }),
  ];

  const d = dayDetail("2026-11-07", orders, entries);

  it("revenue = paid orders (fee included) + manual entries", () => {
    // 1200 + 2200 + 1500 + 1500 + 700
    expect(d.revenueCents).toBe(7100);
  });

  it("receivable = unpaid valid orders only", () => {
    expect(d.receivableCents).toBe(2000);
  });

  it("delivery fees only from paid orders", () => {
    expect(d.deliveryFeeCents).toBe(500);
  });

  it("quantity from paid orders (2 + 3 + 3) and manual items (2), not unpaid or cancelled", () => {
    expect(d.qty).toBe(10);
  });

  it("splits by method, null method -> UNSPECIFIED, manual included, sums to revenue", () => {
    expect(d.byMethod).toEqual({ WECHAT: 1200, ZELLE: 2200, VENMO: 700, CASH: 1500, OTHER: 0, UNSPECIFIED: 1500 });
    expect(Object.values(d.byMethod).reduce((a, b) => a + b, 0)).toBe(d.revenueCents);
  });

  it("two customers buying 2 cheese each: 2 x 600 each = 2400, never re-priced as a bundle (2000)", () => {
    const cheeseRow = d.products.find((p) => p.productId === CHEESE);
    expect(cheeseRow).toEqual({ productId: CHEESE, name: "Cheese", qty: 4, amountCents: 2400 });
  });

  it("manual item adds quantity but no amount", () => {
    // beans: Bob 1 (500) + Cara 3 (1500) + manual 2 (0)
    expect(d.products.find((p) => p.productId === BEAN)).toEqual({
      productId: BEAN,
      name: "Bean",
      qty: 6,
      amountCents: 2000,
    });
    expect(d.products.map((p) => p.name)).toEqual(["Bean", "Cheese"]);
  });

  it("lists valid orders by order number with their method, unpaid ones without", () => {
    expect(d.orders.map((o) => [o.orderNo, o.paid, o.method])).toEqual([
      ["1107-001", true, "WECHAT"],
      ["1107-002", true, "ZELLE"],
      ["1107-003", true, "UNSPECIFIED"],
      ["1107-004", false, null],
    ]);
    expect(d.manual.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("a deliberate 其他 and a missing method are separate buckets (D94)", () => {
    const e = dayDetail(
      "2026-11-07",
      [
        order({ orderNo: "o", paidMethod: "OTHER", totalCents: 400, items: [bean(1, 400)] }),
        order({ orderNo: "u", paidMethod: null, totalCents: 700, items: [bean(1, 700)] }),
      ],
      [manual({ id: "mo", amountCents: 300, paidMethod: "OTHER" })],
    );
    expect(e.byMethod.OTHER).toBe(700); // order 400 + manual 300
    expect(e.byMethod.UNSPECIFIED).toBe(700);
    expect(e.orders.map((r) => [r.orderNo, r.method])).toEqual([
      ["o", "OTHER"],
      ["u", "UNSPECIFIED"],
    ]);
    expect(Object.values(e.byMethod).reduce((a, b) => a + b, 0)).toBe(e.revenueCents);
  });

  it("a paid order with a delivery fee and no method: fee counted, method UNSPECIFIED", () => {
    // 2 x 500 = 1000 + 500 fee = 1500
    const e = dayDetail("2026-11-07", [
      order({ orderNo: "x", paidMethod: null, totalCents: 1500, deliveryFeeCents: 500, items: [bean(2, 1000)] }),
    ], []);
    expect(e.revenueCents).toBe(1500);
    expect(e.deliveryFeeCents).toBe(500);
    expect(e.byMethod.UNSPECIFIED).toBe(1500);
    expect(e.byMethod.OTHER).toBe(0);
    expect(e.orders[0].method).toBe("UNSPECIFIED");
    expect(e.products[0].amountCents).toBe(1000);
  });

  it("an empty day is all zeros", () => {
    const e = dayDetail("2026-11-20", orders, entries);
    expect(e).toMatchObject({ revenueCents: 0, qty: 0, deliveryFeeCents: 0, receivableCents: 0, orders: [], manual: [], products: [] });
    expect(Object.values(e.byMethod)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("manual items without a product link group by name", () => {
    const e = dayDetail("2026-11-07", [], [
      manual({ id: "a", items: [{ productId: null, name: "Cake", qty: 1 }] }),
      manual({ id: "b", items: [{ productId: null, name: "Cake", qty: 2 }] }),
    ]);
    expect(e.products).toEqual([{ productId: null, name: "Cake", qty: 3, amountCents: 0 }]);
  });
});

describe("monthSummary", () => {
  const orders: LedgerOrder[] = [
    order({ orderNo: "a", pickupDate: "2026-10-31", totalCents: 111, items: [bean(1, 111)] }), // before
    order({ orderNo: "b", pickupDate: "2026-11-01", totalCents: 1000, deliveryFeeCents: 500, items: [bean(2, 500)] }),
    order({ orderNo: "c", pickupDate: "2026-11-01", paid: false, paidMethod: null, status: "NEW", totalCents: 300, items: [bean(1, 300)] }),
    order({ orderNo: "d", pickupDate: "2026-11-15", status: "CANCELLED", totalCents: 800, items: [bean(1, 800)] }),
    order({ orderNo: "e", pickupDate: "2026-11-20", paid: false, paidMethod: null, status: "READY", totalCents: 400, items: [bean(1, 400)] }),
    order({ orderNo: "f", pickupDate: "2026-11-30", paidMethod: "VENMO", totalCents: 600, items: [cheese(1, 600)] }),
    order({ orderNo: "g", pickupDate: "2026-12-01", totalCents: 222, items: [bean(1, 222)] }), // after
  ];
  const entries: LedgerManualEntry[] = [
    manual({ id: "x", date: "2026-11-30", amountCents: 250, paidMethod: "ZELLE", items: [{ productId: BEAN, name: "Bean", qty: 5 }] }),
    manual({ id: "y", date: "2026-12-01", amountCents: 9999 }),
    manual({ id: "z", date: "2026-10-31", amountCents: 9999 }),
  ];
  const m = monthSummary("2026-11", orders, entries);

  it("totals include only the month, both boundary days, and manual entries", () => {
    // revenue: 1000 + 600 + 250
    expect(m.revenueCents).toBe(1850);
    expect(m.receivableCents).toBe(700); // 300 + 400
    expect(m.deliveryFeeCents).toBe(500);
    expect(m.qty).toBe(2 + 1 + 5);
    expect(m.byMethod).toEqual({ WECHAT: 1000, ZELLE: 250, VENMO: 600, CASH: 0, OTHER: 0, UNSPECIFIED: 0 });
  });

  it("lists only days with data, ascending; cancelled-only days are omitted", () => {
    expect(m.days).toEqual([
      { date: "2026-11-01", revenueCents: 1000, qty: 2, receivableCents: 300 },
      { date: "2026-11-20", revenueCents: 0, qty: 0, receivableCents: 400 },
      { date: "2026-11-30", revenueCents: 850, qty: 6, receivableCents: 0 },
    ]);
  });

  it("day rows add up to the month totals", () => {
    expect(m.days.reduce((s, d) => s + d.revenueCents, 0)).toBe(m.revenueCents);
    expect(m.days.reduce((s, d) => s + d.receivableCents, 0)).toBe(m.receivableCents);
    expect(m.days.reduce((s, d) => s + d.qty, 0)).toBe(m.qty);
  });

  it("an empty month is all zeros with no days", () => {
    const e = monthSummary("2027-01", orders, entries);
    expect(e).toMatchObject({ revenueCents: 0, qty: 0, deliveryFeeCents: 0, receivableCents: 0, days: [] });
  });
});

describe("shiftMonth", () => {
  it("crosses year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-11", -1)).toBe("2026-10");
  });
});

describe("monthBounds", () => {
  it("handles 30/31-day months, February, leap years and December", () => {
    expect(monthBounds("2026-11")).toEqual({ first: "2026-11-01", last: "2026-11-30" });
    expect(monthBounds("2026-12")).toEqual({ first: "2026-12-01", last: "2026-12-31" });
    expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
  });

  it("rejects malformed months", () => {
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", ""]) {
      expect(() => monthBounds(bad)).toThrow();
    }
  });
});
