import { describe, expect, it } from "vitest";
import {
  buildSummary,
  buildDayProduction,
  type SummaryDay,
  type SummaryInput,
  type SummaryOrder,
  type SummaryProduct,
} from "@/domain/summary";
import type { CartLine, DayLimits, Fulfillment, LocalDate, OrderStatus } from "@/domain/types";

// Default products, CAPACITY_RULES §3.1 (plus summary-only fields).
const products: Record<string, SummaryProduct> = {
  redBean: {
    id: "redBean",
    name: "奶酥红豆包",
    sortOrder: 1,
    batchYield: null,
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  cheeseBun: {
    id: "cheeseBun",
    name: "岩烧乳酪包",
    sortOrder: 2,
    batchYield: null,
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  wedge: {
    id: "wedge",
    name: "奶酪角",
    sortOrder: 3,
    batchYield: null,
    capacityMode: "DOUGH_PER_ROUND",
    doughG: null,
    roundG: 340,
    piecesPerRound: 4,
    dailyLimit: null,
    leadDays: 1,
  },
  brulee: {
    id: "brulee",
    name: "焦糖布蕾",
    sortOrder: 4,
    batchYield: 3,
    capacityMode: "INDEPENDENT",
    doughG: null,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: 24,
    leadDays: 2,
  },
};

const X: LocalDate = "2026-10-29";
const X1: LocalDate = "2026-10-30";
const X2: LocalDate = "2026-10-31";

const limits: DayLimits = {
  doughLimitG: 1600,
  deliveryEnabled: true,
  deliveryLimit: 5,
  productLimits: { brulee: 24 },
};

let seq = 0;
function order(
  orderNo: string,
  items: Record<string, number>,
  opts: { status?: OrderStatus; fulfillment?: Fulfillment; wechatId?: string } = {},
): SummaryOrder {
  seq += 1;
  const lines: CartLine[] = Object.entries(items).map(([productId, qty]) => ({ productId, qty }));
  return {
    id: `o${seq}`,
    orderNo,
    wechatId: opts.wechatId ?? `wx-${orderNo}`,
    status: opts.status ?? "CONFIRMED",
    fulfillment: opts.fulfillment ?? "PICKUP",
    items: lines,
  };
}

function day(date: LocalDate, orders: SummaryOrder[], isOpen = true, l: DayLimits = limits): SummaryDay {
  return { date, isOpen, limits: l, orders };
}

function input(days: SummaryDay[], p: Record<string, SummaryProduct> = products): SummaryInput {
  return { today: X, days: Object.fromEntries(days.map((d) => [d.date, d])), products: p };
}

describe("buildDayProduction", () => {
  it("returns empty totals for missing days or only cancelled/rejected orders", () => {
    const empty = { bread: [], independent: [], totalPieces: 0, orderCount: 0, unconfirmedCount: 0 };
    expect(buildDayProduction(undefined, products)).toEqual(empty);
    expect(buildDayProduction(day(X1, [
      order("1", { wedge: 9 }, { status: "CANCELLED" }),
      order("2", { brulee: 9 }, { status: "REJECTED" }),
    ]), products)).toEqual(empty);
  });

  it("shares summary lines and counts ordered pieces, not rounded production yield", () => {
    const d = day(X1, [
      order("1", { wedge: 3, brulee: 2 }, { status: "NEW" }),
      order("2", { wedge: 2, brulee: 2 }, { status: "CONTACTED" }),
    ], false);
    const summary = buildSummary(input([d]));
    expect(buildDayProduction(d, products)).toEqual({
      bread: summary.bread!.lines,
      independent: summary.tonight.lines,
      totalPieces: 9,
      orderCount: 2,
      unconfirmedCount: 1,
    });
  });
});

describe("buildSummary", () => {
  it("CAPACITY_RULES §10 example", () => {
    const s = buildSummary(
      input([
        day(X1, [
          order("1030-001", { redBean: 6, cheeseBun: 6, wedge: 6 }),
          order("1030-002", { brulee: 20 }),
        ]),
      ]),
    );
    expect(s.today).toBe(X);
    expect(s.tomorrow).toBe(X1);
    expect(s.dayAfter).toBe(X2);
    expect(s.bread).toEqual({
      lines: [
        { productId: "redBean", name: "奶酥红豆包", qty: 6, rounds: null },
        { productId: "cheeseBun", name: "岩烧乳酪包", qty: 6, rounds: null },
        { productId: "wedge", name: "奶酪角", qty: 6, rounds: { rounds: 2, leftover: 2 } },
      ],
      doughG: 1520,
      doughLimitG: 1600,
    });
    expect(s.tonight).toEqual({
      date: X1,
      lines: [{ productId: "brulee", name: "焦糖布蕾", qty: 20, batches: 7, leftover: 1 }],
    });
    expect(s.tomorrowNight).toEqual({ date: X2, lines: [] });
    expect(s.isEmpty).toBe(false);
  });

  it("NOTIFICATIONS §4 sample: tomorrow-night brûlée 9 → 3 batches, leftover 0", () => {
    const s = buildSummary(
      input([
        day(X1, [order("1030-001", { redBean: 6 })]),
        day(X2, [order("1031-001", { brulee: 4 }), order("1031-002", { brulee: 5 })]),
      ]),
    );
    expect(s.tomorrowNight).toEqual({
      date: X2,
      lines: [{ productId: "brulee", name: "焦糖布蕾", qty: 9, batches: 3, leftover: 0 }],
    });
  });

  it("X+1 not open, no orders → bread null; X+2 brûlée still listed", () => {
    for (const days of [
      [day(X2, [order("1031-001", { brulee: 9 })])], // X+1 missing
      [day(X1, [], false), day(X2, [order("1031-001", { brulee: 9 })])], // X+1 closed
    ]) {
      const s = buildSummary(input(days));
      expect(s.bread).toBeNull();
      expect(s.tonight).toEqual({ date: X1, lines: [] });
      expect(s.tomorrowNight.lines).toEqual([
        { productId: "brulee", name: "焦糖布蕾", qty: 9, batches: 3, leftover: 0 },
      ]);
      expect(s.deliveries).toEqual({ pickup: 0, delivery: 0 });
      expect(s.isEmpty).toBe(false);
    }
  });

  it("X+1 open but no orders → bread present with empty lines", () => {
    const s = buildSummary(input([day(X1, [])]));
    expect(s.bread).toEqual({ lines: [], doughG: 0, doughLimitG: 1600 });
    expect(s.isEmpty).toBe(true);
  });

  it("X+1 un-ticked (isOpen false) with existing orders → bread still filled", () => {
    const l = { ...limits, doughLimitG: 1200 };
    const s = buildSummary(
      input([day(X1, [order("1030-001", { redBean: 2, wedge: 1 }), order("1030-002", { brulee: 3 })], false, l)]),
    );
    expect(s.bread).toEqual({
      lines: [
        { productId: "redBean", name: "奶酥红豆包", qty: 2, rounds: null },
        { productId: "wedge", name: "奶酪角", qty: 1, rounds: { rounds: 1, leftover: 3 } },
      ],
      doughG: 480,
      doughLimitG: 1200,
    });
    expect(s.tonight.lines).toEqual([
      { productId: "brulee", name: "焦糖布蕾", qty: 3, batches: 1, leftover: 0 },
    ]);
    expect(s.deliveries).toEqual({ pickup: 2, delivery: 0 });
  });

  it("un-ticked X+1 with only cancelled orders → bread null", () => {
    const s = buildSummary(
      input([day(X1, [order("1030-001", { redBean: 2 }, { status: "CANCELLED" })], false)]),
    );
    expect(s.bread).toBeNull();
  });

  it("cancelled / rejected orders are excluded everywhere", () => {
    const s = buildSummary(
      input([
        day(X1, [
          order("1030-001", { redBean: 2, brulee: 3 }, { fulfillment: "DELIVERY" }),
          order("1030-002", { redBean: 5, wedge: 4, brulee: 6 }, { status: "CANCELLED", fulfillment: "DELIVERY" }),
          order("1030-003", { cheeseBun: 5, brulee: 6 }, { status: "REJECTED" }),
          order("1030-004", { redBean: 1 }, { status: "NEW", fulfillment: "PICKUP" }),
        ]),
        day(X2, [
          order("1031-001", { brulee: 2 }, { status: "CONTACTED" }),
          order("1031-002", { brulee: 7 }, { status: "CANCELLED" }),
          order("1031-003", { brulee: 7 }, { status: "REJECTED" }),
          order("1031-004", { brulee: 7 }, { status: "NEW" }),
        ]),
      ]),
    );
    expect(s.bread?.lines).toEqual([{ productId: "redBean", name: "奶酥红豆包", qty: 3, rounds: null }]);
    expect(s.bread?.doughG).toBe(210);
    expect(s.tonight.lines).toEqual([
      { productId: "brulee", name: "焦糖布蕾", qty: 3, batches: 1, leftover: 0 },
    ]);
    expect(s.tomorrowNight.lines).toEqual([
      { productId: "brulee", name: "焦糖布蕾", qty: 9, batches: 3, leftover: 0 },
    ]);
    expect(s.deliveries).toEqual({ pickup: 1, delivery: 1 });
    expect(s.unconfirmed.map((u) => u.orderNo)).toEqual(["1030-004", "1031-001", "1031-004"]);
  });

  it("unconfirmed: NEW/CONTACTED of X+1 and X+2, sorted by pickupDate then orderNo", () => {
    const s = buildSummary(
      input([
        day(X, [order("1029-001", { redBean: 1 }, { status: "NEW" })]), // today: ignored
        day(X1, [
          order("1030-003", { redBean: 1 }, { status: "CONTACTED", wechatId: "c" }),
          order("1030-001", { redBean: 1 }, { status: "CONFIRMED" }),
          order("1030-002", { redBean: 1 }, { status: "NEW", wechatId: "b" }),
        ]),
        day(X2, [
          order("1031-002", { brulee: 1 }, { status: "NEW", wechatId: "e" }),
          order("1031-001", { brulee: 1 }, { status: "CONTACTED", wechatId: "d" }),
          order("1031-003", { brulee: 1 }, { status: "BAKING" }),
        ]),
        day("2026-11-01", [order("1101-001", { redBean: 1 }, { status: "NEW" })]), // X+3: ignored
      ]),
    );
    expect(s.unconfirmed).toEqual([
      { orderNo: "1030-002", wechatId: "b", status: "NEW", pickupDate: X1 },
      { orderNo: "1030-003", wechatId: "c", status: "CONTACTED", pickupDate: X1 },
      { orderNo: "1031-001", wechatId: "d", status: "CONTACTED", pickupDate: X2 },
      { orderNo: "1031-002", wechatId: "e", status: "NEW", pickupDate: X2 },
    ]);
  });

  it("deliveries count X+1 occupying orders by fulfillment", () => {
    const s = buildSummary(
      input([
        day(X1, [
          order("1030-001", { redBean: 1 }, { fulfillment: "PICKUP" }),
          order("1030-002", { redBean: 1 }, { fulfillment: "DELIVERY" }),
          order("1030-003", { redBean: 1 }, { fulfillment: "DELIVERY", status: "COMPLETED" }),
          order("1030-004", { redBean: 1 }, { fulfillment: "PICKUP", status: "READY" }),
          order("1030-005", { redBean: 1 }, { fulfillment: "DELIVERY", status: "CANCELLED" }),
        ]),
        day(X2, [order("1031-001", { redBean: 1 }, { fulfillment: "DELIVERY" })]),
      ]),
    );
    expect(s.deliveries).toEqual({ pickup: 2, delivery: 2 });
  });

  it("lines sorted by sortOrder then name; paused/archived products still listed", () => {
    const p: Record<string, SummaryProduct> = {
      ...products,
      a: { ...products.redBean, id: "a", name: "B面包", sortOrder: 0 },
      b: { ...products.redBean, id: "b", name: "A面包", sortOrder: 0 },
      pudding: { ...products.brulee, id: "pudding", name: "布丁", sortOrder: 0, batchYield: null },
      jelly: { ...products.brulee, id: "jelly", name: "果冻", sortOrder: 9, batchYield: 0 },
    };
    const s = buildSummary(
      input([day(X1, [order("1030-001", { redBean: 1, a: 1, b: 1, brulee: 4, pudding: 5, jelly: 2 })])], p),
    );
    expect(s.bread?.lines.map((l) => l.productId)).toEqual(["b", "a", "redBean"]);
    expect(s.tonight.lines).toEqual([
      { productId: "pudding", name: "布丁", qty: 5, batches: null, leftover: null },
      { productId: "brulee", name: "焦糖布蕾", qty: 4, batches: 2, leftover: 2 },
      { productId: "jelly", name: "果冻", qty: 2, batches: null, leftover: null },
    ]);
  });

  it("DOUGH_PER_ROUND rounds use the day total, not per order", () => {
    const s = buildSummary(
      input([day(X1, [order("1030-001", { wedge: 3 }), order("1030-002", { wedge: 2 })])]),
    );
    expect(s.bread?.lines).toEqual([
      { productId: "wedge", name: "奶酪角", qty: 5, rounds: { rounds: 2, leftover: 3 } },
    ]);
    expect(s.bread?.doughG).toBe(680);
  });

  it("nothing at all → isEmpty true", () => {
    const s = buildSummary(input([]));
    expect(s.bread).toBeNull();
    expect(s.tonight).toEqual({ date: X1, lines: [] });
    expect(s.tomorrowNight).toEqual({ date: X2, lines: [] });
    expect(s.deliveries).toEqual({ pickup: 0, delivery: 0 });
    expect(s.unconfirmed).toEqual([]);
    expect(s.isEmpty).toBe(true);
  });

  it("only an unconfirmed X+2 bread order → isEmpty false", () => {
    const s = buildSummary(input([day(X2, [order("1031-001", { redBean: 2 }, { status: "NEW" })])]));
    expect(s.bread).toBeNull();
    expect(s.tomorrowNight.lines).toEqual([]);
    expect(s.unconfirmed).toHaveLength(1);
    expect(s.isEmpty).toBe(false);
  });

  it("handles month/year boundaries for tomorrow and dayAfter", () => {
    const s = buildSummary({ today: "2026-12-30", days: {}, products });
    expect(s.tomorrow).toBe("2026-12-31");
    expect(s.dayAfter).toBe("2027-01-01");
  });
});
