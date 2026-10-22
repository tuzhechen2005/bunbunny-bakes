import { describe, expect, it } from "vitest";
import {
  cartProblems,
  evaluateDay,
  listAvailability,
  suggestNextDate,
  type AvailabilityInput,
  type AvailProduct,
  type OpenDay,
} from "@/domain/availability";
import type { CartLine, DayLimits, DayOrder, Fulfillment } from "@/domain/types";

// Default products, CAPACITY_RULES §3.1, plus a paused and an archived one.
const products: Record<string, AvailProduct> = {
  redBean: {
    id: "redBean",
    status: "ACTIVE",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  cheeseBun: {
    id: "cheeseBun",
    status: "ACTIVE",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  wedge: {
    id: "wedge",
    status: "ACTIVE",
    capacityMode: "DOUGH_PER_ROUND",
    doughG: null,
    roundG: 340,
    piecesPerRound: 4,
    dailyLimit: null,
    leadDays: 1,
  },
  brulee: {
    id: "brulee",
    status: "ACTIVE",
    capacityMode: "INDEPENDENT",
    doughG: null,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: 24,
    leadDays: 2,
  },
  paused: {
    id: "paused",
    status: "PAUSED",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  archived: {
    id: "archived",
    status: "ARCHIVED",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
};

// Thursday 2026-10-22 12:00 CDT. today = 2026-10-22.
const NOW = new Date("2026-10-22T17:00:00Z");

function limits(over: Partial<DayLimits> = {}): DayLimits {
  return { doughLimitG: 1600, deliveryEnabled: true, deliveryLimit: 8, productLimits: {}, ...over };
}

function day(date: string, orders: DayOrder[] = [], over: Partial<DayLimits> = {}, isOpen = true): OpenDay {
  return { date, isOpen, limits: limits(over), orders };
}

let seq = 0;
function order(items: CartLine[], fulfillment: Fulfillment = "PICKUP"): DayOrder {
  seq += 1;
  return { id: `o${seq}`, status: "CONFIRMED", fulfillment, items };
}

/** 1600 g: red bean ×18 (1260 g) + cheese wedge ×3 (one round, 340 g). CAPACITY_RULES §3.4. */
function fullDoughOrders(): DayOrder[] {
  return [order([{ productId: "redBean", qty: 18 }]), order([{ productId: "wedge", qty: 3 }])];
}

function input(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    now: NOW,
    orderingEnabled: true,
    cutoffTime: "20:00",
    maxQtyPerItem: 8,
    products,
    cart: [{ productId: "redBean", qty: 1 }],
    fulfillment: "PICKUP",
    days: [],
    ...over,
  };
}

describe("evaluateDay precedence (CAPACITY_RULES §7)", () => {
  // 10/23 bread cutoff = 10/22 20:00 CDT = 2026-10-23T01:00Z.
  const atCutoff = new Date("2026-10-23T01:00:00Z");

  it("past cutoff and full → CUTOFF", () => {
    const d = day("2026-10-23", fullDoughOrders());
    expect(evaluateDay(input({ now: atCutoff }), d).state).toBe("CUTOFF");
  });

  it("one second before cutoff on a full day → FULL", () => {
    const d = day("2026-10-23", fullDoughOrders());
    expect(evaluateDay(input({ now: new Date(atCutoff.getTime() - 1000) }), d).state).toBe("FULL");
  });

  it("full dough + full delivery → FULL", () => {
    const d = day("2026-10-30", [...fullDoughOrders(), order([{ productId: "cheeseBun", qty: 1 }], "DELIVERY")], {
      doughLimitG: 1670,
      deliveryLimit: 1,
    });
    // 1600 + 70 (cheeseBun) = 1670 is full; red bean ×1 pushes to 1740.
    const ev = evaluateDay(input({ fulfillment: "DELIVERY" }), d);
    expect(ev.state).toBe("FULL");
    expect(ev.violations.map((v) => v.kind).sort()).toEqual(["DELIVERY", "DOUGH"]);
  });

  it("delivery full only → DELIVERY_FULL; same day with PICKUP → AVAILABLE", () => {
    const d = day("2026-10-30", [order([{ productId: "cheeseBun", qty: 1 }], "DELIVERY")], {
      deliveryLimit: 1,
    });
    expect(evaluateDay(input({ fulfillment: "DELIVERY" }), d).state).toBe("DELIVERY_FULL");
    expect(evaluateDay(input({ fulfillment: "PICKUP" }), d).state).toBe("AVAILABLE");
  });

  it("delivery disabled on the day → DELIVERY_FULL for DELIVERY, AVAILABLE for PICKUP", () => {
    const d = day("2026-10-30", [], { deliveryEnabled: false });
    expect(evaluateDay(input({ fulfillment: "DELIVERY" }), d).state).toBe("DELIVERY_FULL");
    expect(evaluateDay(input({ fulfillment: "PICKUP" }), d).state).toBe("AVAILABLE");
  });

  it("brûlée over its daily limit → FULL", () => {
    const d = day("2026-10-30", [order([{ productId: "brulee", qty: 22 }])]);
    expect(evaluateDay(input({ cart: [{ productId: "brulee", qty: 3 }] }), d).state).toBe("FULL");
    expect(evaluateDay(input({ cart: [{ productId: "brulee", qty: 2 }] }), d).state).toBe("AVAILABLE");
  });

  it("cheese wedge leftover (CAPACITY_RULES D5) → AVAILABLE on a full-dough day", () => {
    const d = day("2026-10-30", fullDoughOrders());
    expect(evaluateDay(input({ cart: [{ productId: "wedge", qty: 1 }] }), d).state).toBe("AVAILABLE");
    // D6 / D7 on the same day are FULL.
    expect(evaluateDay(input({ cart: [{ productId: "wedge", qty: 2 }] }), d).state).toBe("FULL");
    expect(evaluateDay(input({ cart: [{ productId: "redBean", qty: 1 }] }), d).state).toBe("FULL");
  });

  it("ignores cart lines with unknown productIds for date checks", () => {
    const d = day("2026-10-30");
    const ev = evaluateDay(input({ cart: [{ productId: "ghost", qty: 1 }, { productId: "redBean", qty: 1 }] }), d);
    expect(ev.state).toBe("AVAILABLE");
  });

  it("empty cart uses leadDays 1", () => {
    const ev = evaluateDay(input({ cart: [] }), day("2026-10-30"));
    expect(ev.state).toBe("AVAILABLE");
    expect(ev.cutoffAt.toISOString()).toBe("2026-10-30T01:00:00.000Z");
  });

  it("cancelled orders do not occupy capacity", () => {
    const cancelled: DayOrder = { ...order([{ productId: "redBean", qty: 23 }]), status: "CANCELLED" };
    expect(evaluateDay(input(), day("2026-10-30", [cancelled])).state).toBe("AVAILABLE");
  });
});

describe("cutoff (CAPACITY_RULES §6)", () => {
  it("brûlée in cart moves cutoff a day earlier (mixed cart → earlier cutoff)", () => {
    // Wednesday 10/28 22:00 CDT: past the brûlée cutoff for 10/30 but before the bread one.
    const now = new Date("2026-10-29T03:00:00Z");
    const d = day("2026-10-30");

    const bread = evaluateDay(input({ now, cart: [{ productId: "redBean", qty: 1 }] }), d);
    expect(bread.state).toBe("AVAILABLE");
    expect(bread.cutoffAt.toISOString()).toBe("2026-10-30T01:00:00.000Z");

    const mixed = evaluateDay(
      input({ now, cart: [{ productId: "redBean", qty: 1 }, { productId: "brulee", qty: 1 }] }),
      d,
    );
    expect(mixed.state).toBe("CUTOFF");
    expect(mixed.cutoffAt.toISOString()).toBe("2026-10-29T01:00:00.000Z");
  });

  it("listAvailability reports cutoffAt and cutoffLabel", () => {
    const res = listAvailability(input({ days: [day("2026-10-30")] }));
    expect(res.dates).toEqual([
      {
        date: "2026-10-30",
        state: "AVAILABLE",
        cutoffAt: new Date("2026-10-30T01:00:00Z"),
        cutoffLabel: "10/29 周四 20:00 截止",
      },
    ]);
  });
});

describe("visibility (rule 1)", () => {
  it("lists only open days with today < date ≤ today + 60, sorted ascending", () => {
    const days = [
      day("2026-12-22"), // today + 61
      day("2026-12-21"), // today + 60
      day("2026-10-22"), // today
      day("2026-10-21"), // past
      day("2026-10-25", [], {}, false), // closed
      day("2026-10-23"), // today + 1
    ];
    const res = listAvailability(input({ days }));
    expect(res.dates.map((d) => d.date)).toEqual(["2026-10-23", "2026-12-21"]);
  });

  it("today is the Chicago day, not the UTC day", () => {
    // 2026-10-23T03:00Z is 10/22 22:00 CDT → 10/23 is tomorrow, still listed (as CUTOFF).
    const res = listAvailability(input({ now: new Date("2026-10-23T03:00:00Z"), days: [day("2026-10-23")] }));
    expect(res.dates).toHaveLength(1);
    expect(res.dates[0].state).toBe("CUTOFF");
  });
});

describe("orderingEnabled (rule 0)", () => {
  it("orderingEnabled false → no dates, cartProblems still reported, no suggestion", () => {
    const inp = input({
      orderingEnabled: false,
      cart: [{ productId: "paused", qty: 1 }],
      days: [day("2026-10-23"), day("2026-10-24")],
    });
    expect(listAvailability(inp)).toEqual({
      orderingEnabled: false,
      cartProblems: [{ productId: "paused", error: "PRODUCT_UNAVAILABLE" }],
      dates: [],
    });
    expect(suggestNextDate(inp, "2026-10-22")).toBeNull();
  });
});

describe("cartProblems (rules 3–4)", () => {
  it("paused product → PRODUCT_UNAVAILABLE", () => {
    expect(cartProblems([{ productId: "paused", qty: 1 }], products, 8)).toEqual([
      { productId: "paused", error: "PRODUCT_UNAVAILABLE" },
    ]);
  });

  it("archived product → PRODUCT_UNAVAILABLE", () => {
    expect(cartProblems([{ productId: "archived", qty: 1 }], products, 8)).toEqual([
      { productId: "archived", error: "PRODUCT_UNAVAILABLE" },
    ]);
  });

  it("unknown id → PRODUCT_UNAVAILABLE", () => {
    expect(cartProblems([{ productId: "ghost", qty: 1 }], products, 8)).toEqual([
      { productId: "ghost", error: "PRODUCT_UNAVAILABLE" },
    ]);
  });

  it("qty 9 with max 8 → QTY_LIMIT; qty 8 is fine", () => {
    expect(cartProblems([{ productId: "redBean", qty: 9 }], products, 8)).toEqual([
      { productId: "redBean", error: "QTY_LIMIT" },
    ]);
    expect(cartProblems([{ productId: "redBean", qty: 8 }], products, 8)).toEqual([]);
  });

  it("two lines of the same product summing over max → one QTY_LIMIT", () => {
    expect(
      cartProblems(
        [
          { productId: "redBean", qty: 5 },
          { productId: "cheeseBun", qty: 2 },
          { productId: "redBean", qty: 4 },
        ],
        products,
        8,
      ),
    ).toEqual([{ productId: "redBean", error: "QTY_LIMIT" }]);
  });

  it("one entry per (productId, error), even with repeated lines", () => {
    expect(
      cartProblems(
        [
          { productId: "paused", qty: 1 },
          { productId: "paused", qty: 1 },
        ],
        products,
        8,
      ),
    ).toEqual([{ productId: "paused", error: "PRODUCT_UNAVAILABLE" }]);
  });

  it("cart problems do not change date states", () => {
    const res = listAvailability(
      input({ cart: [{ productId: "redBean", qty: 9 }], days: [day("2026-10-30")] }),
    );
    expect(res.cartProblems).toEqual([{ productId: "redBean", error: "QTY_LIMIT" }]);
    expect(res.dates[0].state).toBe("AVAILABLE");
  });

  it("listAvailability reports cartProblems", () => {
    const res = listAvailability(input({ cart: [{ productId: "ghost", qty: 1 }], days: [] }));
    expect(res).toEqual({
      orderingEnabled: true,
      cartProblems: [{ productId: "ghost", error: "PRODUCT_UNAVAILABLE" }],
      dates: [],
    });
  });
});

describe("PRD §9 #1: full day and suggestNextDate (CAPACITY_RULES §7.1)", () => {
  const cart: CartLine[] = [
    { productId: "redBean", qty: 1 },
    { productId: "brulee", qty: 3 },
  ];

  it("a day at 1600 g with red bean ×1 in cart → FULL", () => {
    expect(evaluateDay(input({ cart }), day("2026-10-24", fullDoughOrders())).state).toBe("FULL");
  });

  it("suggests the next day that fits the whole cart, skipping one that only fits part", () => {
    const days = [
      day("2026-10-27"), // fits, but later
      day("2026-10-24", fullDoughOrders()), // chosen, FULL
      day("2026-10-25", [], { productLimits: { brulee: 2 } }), // dough fits, brûlée does not
      day("2026-10-26"), // fits
    ];
    const inp = input({ cart, days });
    expect(listAvailability(inp).dates.map((d) => d.state)).toEqual(["FULL", "FULL", "AVAILABLE", "AVAILABLE"]);
    expect(suggestNextDate(inp, "2026-10-24")).toBe("2026-10-26");
  });

  it("skips CUTOFF, closed, and (for DELIVERY) DELIVERY_FULL days", () => {
    // Thursday 10/22 21:00 CDT: 10/24 is past the brûlée cutoff (10/22 20:00).
    const now = new Date("2026-10-23T02:00:00Z");
    const days = [
      day("2026-10-23", fullDoughOrders()),
      day("2026-10-24"), // CUTOFF
      day("2026-10-25", [], {}, false), // closed
      day("2026-10-26", [], { deliveryEnabled: false }), // DELIVERY_FULL
      day("2026-10-27"),
    ];
    expect(suggestNextDate(input({ now, cart, fulfillment: "DELIVERY", days }), "2026-10-23")).toBe("2026-10-27");
    expect(suggestNextDate(input({ now, cart, fulfillment: "PICKUP", days }), "2026-10-23")).toBe("2026-10-26");
  });

  it("only looks strictly after fromDate", () => {
    const days = [day("2026-10-24"), day("2026-10-25")];
    expect(suggestNextDate(input({ cart, days }), "2026-10-24")).toBe("2026-10-25");
  });

  it("never suggests a day beyond today + 60", () => {
    const days = [day("2026-10-24", fullDoughOrders()), day("2026-12-22")];
    expect(suggestNextDate(input({ cart, days }), "2026-10-24")).toBeNull();
  });

  it("null when no day fits the whole cart", () => {
    const days = [
      day("2026-10-24", fullDoughOrders()),
      day("2026-10-25", [], { productLimits: { brulee: 2 } }),
      day("2026-10-26", fullDoughOrders()),
    ];
    expect(suggestNextDate(input({ cart, days }), "2026-10-24")).toBeNull();
  });

  it("does not modify the cart or the days", () => {
    const days = [day("2026-10-24", fullDoughOrders()), day("2026-10-25")];
    const inp = input({ cart: cart.map((l) => ({ ...l })), days });
    const snapshot = JSON.stringify(inp);
    suggestNextDate(inp, "2026-10-24");
    listAvailability(inp);
    expect(JSON.stringify(inp)).toBe(snapshot);
  });
});
