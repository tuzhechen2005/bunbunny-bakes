import { describe, expect, it } from "vitest";
import {
  checkDay,
  doughUsed,
  usage,
  type Candidate,
  type ProductMap,
} from "@/domain/capacity";
import type { CartLine, DayLimits, DayOrder, Fulfillment, OrderStatus } from "@/domain/types";

// Default products, CAPACITY_RULES §3.1.
const products: ProductMap = {
  redBean: {
    id: "redBean",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  cheeseBun: {
    id: "cheeseBun",
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    leadDays: 1,
  },
  wedge: {
    id: "wedge",
    capacityMode: "DOUGH_PER_ROUND",
    doughG: null,
    roundG: 340,
    piecesPerRound: 4,
    dailyLimit: null,
    leadDays: 1,
  },
  brulee: {
    id: "brulee",
    capacityMode: "INDEPENDENT",
    doughG: null,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: 24,
    leadDays: 2,
  },
};

const DATE = "2026-10-30";

function limits(over: Partial<DayLimits> = {}): DayLimits {
  return {
    doughLimitG: 1600,
    deliveryEnabled: true,
    deliveryLimit: 8,
    productLimits: {},
    ...over,
  };
}

let seq = 0;
function order(
  items: CartLine[],
  opts: { status?: OrderStatus; fulfillment?: Fulfillment; id?: string } = {},
): DayOrder {
  seq += 1;
  return {
    id: opts.id ?? `o${seq}`,
    status: opts.status ?? "NEW",
    fulfillment: opts.fulfillment ?? "PICKUP",
    items,
  };
}

function line(productId: string, qty: number): CartLine {
  return { productId, qty };
}

function pickup(...items: CartLine[]): Candidate {
  return { items, fulfillment: "PICKUP" };
}

function check(
  existing: DayOrder[],
  candidate: Candidate,
  extra: { limits?: DayLimits; excludeOrderId?: string; products?: ProductMap } = {},
) {
  return checkDay({
    date: DATE,
    existing,
    candidate,
    excludeOrderId: extra.excludeOrderId,
    products: extra.products ?? products,
    limits: extra.limits ?? limits(),
  });
}

// §3.4 base day: red bean 8, cheese bun 8, wedge 4 = 560 + 560 + 340 = 1460 g.
function baseDayD1(): DayOrder[] {
  return [
    order([line("redBean", 8)]),
    order([line("cheeseBun", 8)]),
    order([line("wedge", 4)]),
  ];
}

// §3.4 remainder day: red bean 18 (1260 g) + wedge 3 (1 round, 340 g) = 1600 g.
function baseDayD5(): DayOrder[] {
  return [order([line("redBean", 18)]), order([line("wedge", 3)], { id: "wedge3" })];
}

describe("usage / doughUsed", () => {
  it("base day D1-D4 uses 1460 g", () => {
    expect(doughUsed(baseDayD1(), products)).toBe(1460);
  });

  it("base day D5-D7 uses 1600 g", () => {
    expect(doughUsed(baseDayD5(), products)).toBe(1600);
  });

  it("includes every INDEPENDENT product key with 0 when unused", () => {
    expect(usage(baseDayD1(), products)).toEqual({
      doughG: 1460,
      products: { brulee: 0 },
      deliveries: 0,
    });
  });

  it("counts deliveries and independent totals", () => {
    const u = usage(
      [
        order([line("brulee", 5)], { fulfillment: "DELIVERY" }),
        order([line("brulee", 3)], { fulfillment: "DELIVERY" }),
        order([line("brulee", 1)]),
      ],
      products,
    );
    expect(u).toEqual({ doughG: 0, products: { brulee: 9 }, deliveries: 2 });
  });

  it("sums repeated lines of the same product within one order", () => {
    expect(doughUsed([order([line("wedge", 2), line("wedge", 2)])], products)).toBe(340);
  });

  it("empty day is zero", () => {
    expect(usage([], products)).toEqual({ doughG: 0, products: { brulee: 0 }, deliveries: 0 });
  });
});

describe("dough examples (CAPACITY_RULES §3.4)", () => {
  it("D1: red bean x2 -> 1600 g, ok at exactly the limit", () => {
    const r = check(baseDayD1(), pickup(line("redBean", 2)));
    expect(r.before.doughG).toBe(1460);
    expect(r.after.doughG).toBe(1600);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("D2: red bean x3 -> 1670 g, full", () => {
    const r = check(baseDayD1(), pickup(line("redBean", 3)));
    expect(r.after.doughG).toBe(1670);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 1600, after: 1670, over: 70 },
    ]);
  });

  it("D3: wedge x1 -> 5 wedges = 2 rounds -> 1800 g, full", () => {
    const r = check(baseDayD1(), pickup(line("wedge", 1)));
    expect(r.after.doughG).toBe(1800);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 1600, after: 1800, over: 200 },
    ]);
  });

  it("D4: brulee x10 -> dough stays 1460, no DOUGH violation, brulee 10 <= 24 ok", () => {
    const r = check(baseDayD1(), pickup(line("brulee", 10)));
    expect(r.after.doughG).toBe(1460);
    expect(r.after.products.brulee).toBe(10);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("D4b: brulee-only candidate is not blocked even when dough is already over the limit", () => {
    const r = check(baseDayD1(), pickup(line("brulee", 1)), {
      limits: limits({ doughLimitG: 1000 }),
    });
    expect(r.ok).toBe(true);
  });

  it("D5: wedge x1 on a 1600 g day -> 4 wedges still 1 round -> 1600 g, ok", () => {
    const r = check(baseDayD5(), pickup(line("wedge", 1)));
    expect(r.before.doughG).toBe(1600);
    expect(r.after.doughG).toBe(1600);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("D6: wedge x2 -> 5 wedges = 2 rounds -> 1940 g, full", () => {
    const r = check(baseDayD5(), pickup(line("wedge", 2)));
    expect(r.after.doughG).toBe(1940);
    expect(r.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 1600, after: 1940, over: 340 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("D7: red bean x1 -> 1670 g, full", () => {
    const r = check(baseDayD5(), pickup(line("redBean", 1)));
    expect(r.after.doughG).toBe(1670);
    expect(r.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 1600, after: 1670, over: 70 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("Cancel: after D5, cancelling the wedge x3 order leaves dough at 1600 g", () => {
    const day = [...baseDayD5(), order([line("wedge", 1)])];
    expect(doughUsed(day, products)).toBe(1600);
    const cancelled = day.map((o) =>
      o.id === "wedge3" ? { ...o, status: "CANCELLED" as const } : o,
    );
    expect(doughUsed(cancelled, products)).toBe(1600);
  });
});

describe("per-day rounding", () => {
  it("Ceil: two separate orders of 2 wedges each -> 1 round (340 g), not 2", () => {
    const day = [order([line("wedge", 2)]), order([line("wedge", 2)])];
    expect(doughUsed(day, products)).toBe(340);
    const r = check([order([line("wedge", 2)])], pickup(line("wedge", 2)));
    expect(r.before.doughG).toBe(340);
    expect(r.after.doughG).toBe(340);
  });

  it("Rounds: two different round-products are rounded independently", () => {
    const withLoaf: ProductMap = {
      ...products,
      loaf: {
        id: "loaf",
        capacityMode: "DOUGH_PER_ROUND",
        doughG: null,
        roundG: 500,
        piecesPerRound: 6,
        dailyLimit: null,
        leadDays: 1,
      },
    };
    // wedge 3 -> 1 round (340); loaf 1 -> 1 round (500). Combined 4 pieces must not be pooled.
    const day = [order([line("wedge", 3), line("loaf", 1)])];
    expect(doughUsed(day, withLoaf)).toBe(840);
    // wedge 5 -> 2 rounds (680); loaf 7 -> 2 rounds (1000).
    const day2 = [order([line("wedge", 2), line("loaf", 3)]), order([line("wedge", 3), line("loaf", 4)])];
    expect(doughUsed(day2, withLoaf)).toBe(1680);
  });
});

describe("independent products (CAPACITY_RULES §4)", () => {
  const brulee22 = () => [order([line("brulee", 20)]), order([line("brulee", 2)])];

  it("B1: 22 existing + 2 -> 24, ok", () => {
    const r = check(brulee22(), pickup(line("brulee", 2)));
    expect(r.before.products.brulee).toBe(22);
    expect(r.after.products.brulee).toBe(24);
    expect(r.ok).toBe(true);
  });

  it("B2: 22 existing + 3 -> 25, full", () => {
    const r = check(brulee22(), pickup(line("brulee", 3)));
    expect(r.violations).toEqual([
      { kind: "PRODUCT", date: DATE, productId: "brulee", limit: 24, after: 25, over: 1 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("B3: 0 existing, day limit overridden to 0, +1 -> full", () => {
    const r = check([], pickup(line("brulee", 1)), {
      limits: limits({ productLimits: { brulee: 0 } }),
    });
    expect(r.violations).toEqual([
      { kind: "PRODUCT", date: DATE, productId: "brulee", limit: 0, after: 1, over: 1 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("productLimits override takes precedence over dailyLimit when higher", () => {
    const r = check(brulee22(), pickup(line("brulee", 3)), {
      limits: limits({ productLimits: { brulee: 30 } }),
    });
    expect(r.ok).toBe(true);
  });

  it("throws when an INDEPENDENT product has neither an override nor dailyLimit", () => {
    const noLimit: ProductMap = { ...products, brulee: { ...products.brulee, dailyLimit: null } };
    expect(() => check([], pickup(line("brulee", 1)), { products: noLimit })).toThrow();
  });
});

describe("delivery (CAPACITY_RULES §5)", () => {
  const deliveries = (n: number) =>
    Array.from({ length: n }, () => order([line("redBean", 1)], { fulfillment: "DELIVERY" }));
  const deliver = (...items: CartLine[]): Candidate => ({ items, fulfillment: "DELIVERY" });

  it("Delivery: 7 of 8 used + DELIVERY -> ok", () => {
    const r = check(deliveries(7), deliver(line("redBean", 1)));
    expect(r.after.deliveries).toBe(8);
    expect(r.ok).toBe(true);
  });

  it("Delivery: 8 of 8 used + DELIVERY -> DELIVERY violation", () => {
    const r = check(deliveries(8), deliver(line("redBean", 1)));
    expect(r.violations).toEqual([
      { kind: "DELIVERY", date: DATE, limit: 8, after: 9, over: 1 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("Delivery: deliveryEnabled false -> DELIVERY_DISABLED", () => {
    const r = check([], deliver(line("redBean", 1)), {
      limits: limits({ deliveryEnabled: false }),
    });
    expect(r.violations).toEqual([{ kind: "DELIVERY_DISABLED", date: DATE }]);
    expect(r.ok).toBe(false);
  });

  it("Delivery: full delivery + PICKUP -> ok", () => {
    const r = check(deliveries(8), pickup(line("redBean", 1)));
    expect(r.ok).toBe(true);
    expect(r.after.deliveries).toBe(8);
  });

  it("Delivery: delivery disabled + PICKUP -> ok", () => {
    const r = check([], pickup(line("redBean", 1)), {
      limits: limits({ deliveryEnabled: false }),
    });
    expect(r.ok).toBe(true);
  });
});

describe("edit with excludeOrderId (CAPACITY_RULES §3.3, §8)", () => {
  it("Edit: shrinking an order on a full day is ok with exclude, not ok without", () => {
    const day = [order([line("redBean", 18)], { id: "big" }), order([line("wedge", 3)])];
    const shrunk = pickup(line("redBean", 17));

    const withExclude = check(day, shrunk, { excludeOrderId: "big" });
    expect(withExclude.before.doughG).toBe(340);
    expect(withExclude.after.doughG).toBe(1530);
    expect(withExclude.ok).toBe(true);

    const withoutExclude = check(day, shrunk);
    expect(withoutExclude.after.doughG).toBe(2790);
    expect(withoutExclude.ok).toBe(false);
  });

  it("Edit: excluded delivery order does not count toward deliveries", () => {
    const day = Array.from({ length: 8 }, (_, i) =>
      order([line("redBean", 1)], { fulfillment: "DELIVERY", id: `d${i}` }),
    );
    const r = check(day, { items: [line("redBean", 2)], fulfillment: "DELIVERY" }, {
      excludeOrderId: "d0",
    });
    expect(r.before.deliveries).toBe(7);
    expect(r.after.deliveries).toBe(8);
    expect(r.ok).toBe(true);
  });

  it("Edit: editing a wedge order recomputes rounds over the day total", () => {
    // day: wedge 3 (editing, id e) + wedge 1 other -> 1 round. Edit to wedge 4 -> total 5 -> 2 rounds.
    const day = [order([line("wedge", 3)], { id: "e" }), order([line("wedge", 1)])];
    const r = check(day, pickup(line("wedge", 4)), { excludeOrderId: "e" });
    expect(r.before.doughG).toBe(340);
    expect(r.after.doughG).toBe(680);
  });
});

describe("multiple violations", () => {
  it("Multi: dough and delivery violations are returned together, in order", () => {
    const day = [
      ...baseDayD1(),
      ...Array.from({ length: 8 }, () =>
        order([line("brulee", 1)], { fulfillment: "DELIVERY" }),
      ),
    ];
    const r = check(day, { items: [line("redBean", 3)], fulfillment: "DELIVERY" });
    expect(r.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 1600, after: 1670, over: 70 },
      { kind: "DELIVERY", date: DATE, limit: 8, after: 9, over: 1 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("Multi: dough, product, and delivery-disabled in order", () => {
    const r = check(baseDayD1(), {
      items: [line("brulee", 25), line("redBean", 3)],
      fulfillment: "DELIVERY",
    }, { limits: limits({ deliveryEnabled: false }) });
    expect(r.violations.map((v) => v.kind)).toEqual(["DOUGH", "PRODUCT", "DELIVERY_DISABLED"]);
  });
});

describe("statuses (CAPACITY_RULES §1)", () => {
  const nonOccupying: OrderStatus[] = ["CANCELLED", "REJECTED"];
  const occupying: OrderStatus[] = ["NEW", "CONTACTED", "CONFIRMED", "BAKING", "READY", "COMPLETED"];

  for (const status of nonOccupying) {
    it(`Status: ${status} is ignored`, () => {
      const day = [
        order([line("redBean", 10), line("brulee", 5)], { status, fulfillment: "DELIVERY" }),
      ];
      expect(usage(day, products)).toEqual({ doughG: 0, products: { brulee: 0 }, deliveries: 0 });
      const r = check(day, pickup(line("redBean", 22)));
      expect(r.ok).toBe(true);
    });
  }

  for (const status of occupying) {
    it(`Status: ${status} is counted`, () => {
      const day = [
        order([line("redBean", 10), line("brulee", 5)], { status, fulfillment: "DELIVERY" }),
      ];
      expect(usage(day, products)).toEqual({ doughG: 700, products: { brulee: 5 }, deliveries: 1 });
    });
  }
});

describe("validation", () => {
  it("throws on unknown productId in the candidate", () => {
    expect(() => check([], pickup(line("nope", 1)))).toThrow();
  });

  it("throws on unknown productId in a counted existing order", () => {
    expect(() => usage([order([line("nope", 1)])], products)).toThrow();
  });

  it("throws on non-positive or non-integer qty", () => {
    for (const qty of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => check([], pickup(line("redBean", qty)))).toThrow();
      expect(() => usage([order([line("redBean", qty)])], products)).toThrow();
    }
  });

  it("throws when DOUGH_PER_UNIT product lacks doughG", () => {
    const bad: ProductMap = { ...products, redBean: { ...products.redBean, doughG: null } };
    expect(() => doughUsed([order([line("redBean", 1)])], bad)).toThrow();
  });

  it("throws when DOUGH_PER_ROUND product lacks roundG or piecesPerRound", () => {
    const noRound: ProductMap = { ...products, wedge: { ...products.wedge, roundG: null } };
    const noPieces: ProductMap = { ...products, wedge: { ...products.wedge, piecesPerRound: null } };
    const zeroPieces: ProductMap = { ...products, wedge: { ...products.wedge, piecesPerRound: 0 } };
    expect(() => doughUsed([order([line("wedge", 1)])], noRound)).toThrow();
    expect(() => doughUsed([order([line("wedge", 1)])], noPieces)).toThrow();
    expect(() => doughUsed([order([line("wedge", 1)])], zeroPieces)).toThrow();
  });

  it("does not mutate inputs", () => {
    const day = baseDayD1();
    const snapshot = JSON.stringify(day);
    check(day, pickup(line("redBean", 2)), { excludeOrderId: day[0].id });
    expect(JSON.stringify(day)).toBe(snapshot);
  });
});
