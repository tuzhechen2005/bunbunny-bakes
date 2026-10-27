// CAPACITY_RULES §7 rule 2b (pickup weekdays) and §7.2 (actionable hints). Every example
// of those sections is one test here (H1–H16, W1–W4).

import { describe, expect, it } from "vitest";
import {
  evaluateDay,
  listAvailability,
  planCart,
  type AvailabilityInput,
  type AvailProduct,
  type OpenDay,
} from "@/domain/availability";
import { largestFittingKeep, MAX_HINT_PIECES } from "@/domain/hints";
import { normalizeWeekdays, weekdayViolations } from "@/domain/weekdays";
import type { CartLine, DayLimits, DayOrder, Fulfillment } from "@/domain/types";

const unit = (id: string, extra: Partial<AvailProduct> = {}): AvailProduct => ({
  id,
  status: "ACTIVE",
  capacityMode: "DOUGH_PER_UNIT",
  doughG: 70,
  roundG: null,
  piecesPerRound: null,
  dailyLimit: null,
  leadDays: 1,
  ...extra,
});

const products: Record<string, AvailProduct> = {
  redBean: unit("redBean"),
  cheeseBun: unit("cheeseBun"),
  wedge: unit("wedge", { capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, piecesPerRound: 4 }),
  brulee: unit("brulee", { capacityMode: "INDEPENDENT", doughG: null, dailyLimit: 24, leadDays: 2 }),
  // 泡芙: Wednesdays only (D115).
  puff: unit("puff", { capacityMode: "INDEPENDENT", doughG: null, dailyLimit: 20, pickupWeekdays: [3] }),
  // Wednesday or Saturday.
  puff2: unit("puff2", { pickupWeekdays: [3, 6] }),
  paused: unit("paused", { status: "PAUSED" }),
};

// Thursday 2026-10-22 12:00 CDT. 10/28 = Wed, 10/29 = Thu, 10/30 = Fri, 10/31 = Sat.
const NOW = new Date("2026-10-22T17:00:00Z");
const WED = "2026-10-28";
const THU = "2026-10-29";
const FRI = "2026-10-30";
const SAT = "2026-10-31";

function limits(over: Partial<DayLimits> = {}): DayLimits {
  return { doughLimitG: 1600, deliveryEnabled: true, deliveryLimit: 8, productLimits: {}, ...over };
}

let seq = 0;
function order(items: CartLine[], fulfillment: Fulfillment = "PICKUP"): DayOrder {
  seq += 1;
  return { id: `o${seq}`, status: "CONFIRMED", fulfillment, items };
}

/** A day with `leftG` grams of dough left: 红豆包 ×20 (1400 g) ordered, limit 1400 + leftG. */
function dayLeft(date: string, leftG: number, over: Partial<DayLimits> = {}, extra: DayOrder[] = []): OpenDay {
  return {
    date,
    isOpen: true,
    limits: limits({ doughLimitG: 1400 + leftG, ...over }),
    orders: [order([{ productId: "redBean", qty: 20 }]), ...extra],
  };
}

function input(cart: CartLine[], days: OpenDay[], over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    now: NOW,
    orderingEnabled: true,
    cutoffTime: "20:00",
    maxQtyPerItem: 8,
    products,
    cart,
    fulfillment: "PICKUP",
    days,
    ...over,
  };
}

const L = (productId: string, qty: number): CartLine => ({ productId, qty });

describe("pickup weekdays (rule 2b)", () => {
  it("W1 normalises: sorted, distinct, all seven = every day ([])", () => {
    expect(normalizeWeekdays([6, 3, 3])).toEqual([3, 6]);
    expect(normalizeWeekdays([0, 1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(normalizeWeekdays([])).toEqual([]);
    expect(() => normalizeWeekdays([7])).toThrow();
    expect(() => normalizeWeekdays([1.5])).toThrow();
  });

  it("W2 泡芙 (Wed only) in the cart: Thu → WEEKDAY, Wed → AVAILABLE; no restriction = every day", () => {
    const cart = [L("redBean", 1), L("puff", 1)];
    expect(evaluateDay(input(cart, []), dayLeft(THU, 1600)).state).toBe("WEEKDAY");
    expect(evaluateDay(input(cart, []), dayLeft(WED, 1600)).state).toBe("AVAILABLE");
    expect(evaluateDay(input([L("redBean", 1)], []), dayLeft(THU, 1600)).state).toBe("AVAILABLE");
    expect(evaluateDay(input([L("puff2", 1)], []), dayLeft(SAT, 1600)).state).toBe("AVAILABLE");
    expect(weekdayViolations(THU, cart, products)).toEqual([
      { kind: "WEEKDAY", date: THU, productId: "puff", weekdays: [3] },
    ]);
  });

  it("W3 precedence CUTOFF > WEEKDAY > FULL", () => {
    const cart = [L("redBean", 3), L("puff", 1)];
    // Thu full (1600 g used) and 泡芙 not allowed → WEEKDAY.
    expect(evaluateDay(input(cart, []), dayLeft(THU, 60)).state).toBe("WEEKDAY");
    // Past the Thu cutoff (10/28 20:00 CDT = 10/29 01:00Z) → CUTOFF.
    const late = new Date("2026-10-29T01:00:00Z");
    expect(evaluateDay(input(cart, [], { now: late }), dayLeft(THU, 60)).state).toBe("CUTOFF");
  });

  it("W4 an empty cart is never WEEKDAY", () => {
    expect(evaluateDay(input([], []), dayLeft(THU, 1600)).state).toBe("AVAILABLE");
  });
});

describe("hints (§7.2)", () => {
  // Owner's example: Wed has 70 g left, Thu has 140 g left; cart = three 70 g breads.
  const owner = () => [dayLeft(WED, 70), dayLeft(THU, 140)];

  it("H1 Thu (140 g left), 红豆包 ×3 → REDUCE remove 1; SPLIT 2 Thu + 1 Wed", () => {
    const plan = planCart(input([L("redBean", 3)], owner()), THU);
    expect(plan).toEqual({
      state: "FULL",
      hints: [
        { kind: "REDUCE", remove: [L("redBean", 1)] },
        { kind: "SPLIT", reason: "CAPACITY", here: [L("redBean", 2)], rest: [L("redBean", 1)], restDate: WED },
      ],
    });
  });

  it("H2 Wed (70 g left), 红豆包 ×3 → REDUCE remove 2; SPLIT 1 Wed + 2 Thu", () => {
    const plan = planCart(input([L("redBean", 3)], owner()), WED);
    expect(plan?.hints).toEqual([
      { kind: "REDUCE", remove: [L("redBean", 2)] },
      { kind: "SPLIT", reason: "CAPACITY", here: [L("redBean", 1)], rest: [L("redBean", 2)], restDate: THU },
    ]);
  });

  it("H3 tie rule: 红豆包 ×2 + 岩烧 ×1 on Thu → the latest line (岩烧) is removed", () => {
    const plan = planCart(input([L("redBean", 2), L("cheeseBun", 1)], owner()), THU);
    expect(plan?.hints[0]).toEqual({ kind: "REDUCE", remove: [L("cheeseBun", 1)] });
    expect(plan?.hints[1]).toEqual({
      kind: "SPLIT",
      reason: "CAPACITY",
      here: [L("redBean", 2)],
      rest: [L("cheeseBun", 1)],
      restDate: WED,
    });
  });

  it("H4 tie rule with the order reversed: 岩烧 ×1 + 红豆包 ×2 → one 红豆包 is removed", () => {
    const plan = planCart(input([L("cheeseBun", 1), L("redBean", 2)], owner()), THU);
    expect(plan?.hints[0]).toEqual({ kind: "REDUCE", remove: [L("redBean", 1)] });
  });

  it("H5 round-up: 1600 g used incl. 奶酪角 ×3; cart 奶酪角 ×2 + 红豆包 ×1 → keep 1 奶酪角 (the leftover wedge)", () => {
    const d: OpenDay = {
      date: THU,
      isOpen: true,
      limits: limits(),
      orders: [order([L("redBean", 18)]), order([L("wedge", 3)])],
    };
    const plan = planCart(input([L("wedge", 2), L("redBean", 1)], [d]), THU);
    expect(plan).toEqual({ state: "FULL", hints: [{ kind: "REDUCE", remove: [L("wedge", 1), L("redBean", 1)] }] });
  });

  it("H6 round-up beats the tie rule: 340 g left, 红豆包 ×1 + 奶酪角 ×4 → remove the 红豆包 (1 piece, not 4)", () => {
    const plan = planCart(input([L("redBean", 1), L("wedge", 4)], [dayLeft(THU, 340)]), THU);
    expect(plan?.hints).toEqual([{ kind: "REDUCE", remove: [L("redBean", 1)] }]);
  });

  it("H7 equal pieces either way: 340 g left, 红豆包 ×4 + 奶酪角 ×4 → keep the earlier line, remove 奶酪角 ×4", () => {
    const plan = planCart(input([L("redBean", 4), L("wedge", 4)], [dayLeft(THU, 340)]), THU);
    expect(plan?.hints).toEqual([{ kind: "REDUCE", remove: [L("wedge", 4)] }]);
  });

  it("H8 nothing fits: 140 g left, cart 奶酪角 ×1 (needs a new round) → no hints (REDUCE would empty the cart)", () => {
    const plan = planCart(input([L("wedge", 1)], [dayLeft(THU, 140)]), THU);
    expect(plan).toEqual({ state: "FULL", hints: [] });
  });

  it("H9 brûlée limit: 22 of 24 taken, cart 布蕾 ×3 + 红豆包 ×1 → REDUCE remove 布蕾 ×1", () => {
    const d = dayLeft(THU, 1600, {}, [order([L("brulee", 22)])]);
    const plan = planCart(input([L("brulee", 3), L("redBean", 1)], [d]), THU);
    expect(plan?.hints).toEqual([{ kind: "REDUCE", remove: [L("brulee", 1)] }]);
  });

  it("H10 SPLIT needs a restDate: only Thu open → REDUCE only", () => {
    const plan = planCart(input([L("redBean", 3)], [dayLeft(THU, 140)]), THU);
    expect(plan?.hints).toEqual([{ kind: "REDUCE", remove: [L("redBean", 1)] }]);
  });

  it("H11 restDate = nearest by distance, earlier wins ties (Wed and Fri both 1 day from Thu)", () => {
    const plan = planCart(input([L("redBean", 3)], [dayLeft(FRI, 1600), dayLeft(THU, 140), dayLeft(WED, 1600)]), THU);
    expect(plan?.hints[1]).toMatchObject({ kind: "SPLIT", restDate: WED });
    // Wed has no room for the rest → Fri.
    const plan2 = planCart(input([L("redBean", 3)], [dayLeft(FRI, 1600), dayLeft(THU, 140), dayLeft(WED, 0)]), THU);
    expect(plan2?.hints[1]).toMatchObject({ kind: "SPLIT", restDate: FRI });
  });

  it("H12 restDate respects the rest's own cutoff (布蕾 needs 2 days)", () => {
    // Now = Tue 10/27 12:00 CDT. Wed 10/28: brûlée cutoff 10/26 20:00 passed; Fri 10/30 still open.
    const now = new Date("2026-10-27T17:00:00Z");
    const thu = dayLeft(THU, 1600, {}, [order([L("brulee", 24)])]);
    // Thu: brûlée cutoff 10/27 20:00 → still before cutoff, but brûlée is full.
    const plan = planCart(input([L("redBean", 1), L("brulee", 2)], [dayLeft(WED, 1600), thu, dayLeft(FRI, 1600)], { now }), THU);
    expect(plan?.hints).toEqual([
      { kind: "REDUCE", remove: [L("brulee", 2)] },
      { kind: "SPLIT", reason: "CAPACITY", here: [L("redBean", 1)], rest: [L("brulee", 2)], restDate: FRI },
    ]);
  });

  it("H13 SPLIT WEEKDAY: 红豆包 ×2 + 泡芙 ×1 on Thu → here = 红豆包, rest = 泡芙, restDate Wed", () => {
    const plan = planCart(input([L("redBean", 2), L("puff", 1)], [dayLeft(WED, 1600), dayLeft(THU, 1600)]), THU);
    expect(plan).toEqual({
      state: "WEEKDAY",
      hints: [{ kind: "SPLIT", reason: "WEEKDAY", here: [L("redBean", 2)], rest: [L("puff", 1)], restDate: WED }],
    });
  });

  it("H14 SPLIT WEEKDAY with no Wednesday open → restDate null", () => {
    const plan = planCart(input([L("redBean", 2), L("puff", 1)], [dayLeft(THU, 1600), dayLeft(FRI, 1600)]), THU);
    expect(plan?.hints).toEqual([
      { kind: "SPLIT", reason: "WEEKDAY", here: [L("redBean", 2)], rest: [L("puff", 1)], restDate: null },
    ]);
  });

  it("H15 weekday + capacity: Thu has 70 g left, 红豆包 ×2 + 泡芙 → the allowed part does not fit → no hint", () => {
    const plan = planCart(input([L("redBean", 2), L("puff", 1)], [dayLeft(WED, 1600), dayLeft(THU, 70)]), THU);
    expect(plan).toEqual({ state: "WEEKDAY", hints: [] });
    // Only 泡芙 in the cart → nothing to order on Thu → no hint.
    expect(planCart(input([L("puff", 1)], [dayLeft(WED, 1600), dayLeft(THU, 1600)]), THU)).toEqual({
      state: "WEEKDAY",
      hints: [],
    });
  });

  it("H16 no hints: empty cart, cart problems, AVAILABLE dates, delivery full on a FULL day", () => {
    expect(planCart(input([], owner()), THU)).toEqual({ state: "AVAILABLE", hints: [] });
    expect(planCart(input([L("redBean", 3), L("paused", 1)], owner()), THU)?.hints).toEqual([]);
    expect(planCart(input([L("redBean", 9)], owner()), THU)?.hints).toEqual([]);
    expect(planCart(input([L("redBean", 1)], owner()), THU)).toEqual({ state: "AVAILABLE", hints: [] });
    const deliveryFull = dayLeft(THU, 140, { deliveryLimit: 1 }, [order([L("cheeseBun", 1)], "DELIVERY")]);
    // 70 g left after the delivery order; ×3 does not fit and no sub-cart can be delivered.
    const plan = planCart(input([L("redBean", 3)], [deliveryFull], { fulfillment: "DELIVERY" }), THU);
    expect(plan).toEqual({ state: "FULL", hints: [] });
  });
});

describe("planCart / listAvailability", () => {
  it("planCart returns null for a date that is not offered", () => {
    const days = [dayLeft(THU, 1600), { ...dayLeft(FRI, 1600), isOpen: false }];
    expect(planCart(input([L("redBean", 1)], days), FRI)).toBeNull();
    expect(planCart(input([L("redBean", 1)], days), "2026-10-22")).toBeNull();
    expect(planCart(input([L("redBean", 1)], days, { orderingEnabled: false }), THU)).toBeNull();
  });

  it("listAvailability carries the same hints, only on FULL / WEEKDAY dates that have some", () => {
    const inp = input([L("redBean", 3)], [dayLeft(WED, 70), dayLeft(THU, 140), dayLeft(FRI, 1600)]);
    const res = listAvailability(inp);
    expect(res.dates.map((d) => [d.date, d.state, d.hints?.length ?? 0])).toEqual([
      [WED, "FULL", 2],
      [THU, "FULL", 2],
      [FRI, "AVAILABLE", 0],
    ]);
    for (const d of res.dates) {
      expect(d.hints ?? []).toEqual(planCart(inp, d.date)?.hints);
      if (d.state === "AVAILABLE") expect("hints" in d).toBe(false);
    }
  });

  it("merges repeated lines (first-seen order) before searching", () => {
    const plan = planCart(input([L("redBean", 1), L("cheeseBun", 1), L("redBean", 1)], owner2()), THU);
    expect(plan?.hints[0]).toEqual({ kind: "REDUCE", remove: [L("cheeseBun", 1)] });
    function owner2() {
      return [dayLeft(THU, 140)];
    }
  });

  it("hints carry only cart quantities (no grams, limits or used amounts)", () => {
    const plan = planCart(input([L("redBean", 3)], [dayLeft(WED, 70), dayLeft(THU, 140)]), THU);
    const keys = new Set<string>();
    JSON.stringify(plan, (k, v) => {
      keys.add(k);
      return v;
    });
    for (const k of keys) {
      expect(["", "state", "hints", "kind", "remove", "productId", "qty", "reason", "here", "rest", "restDate"]).toContain(
        k.match(/^\d+$/) ? "" : k,
      );
    }
  });
});

describe("search bounds", () => {
  it("largestFittingKeep handles 50 lines × 99 pieces of mixed products quickly and exactly", () => {
    const many: Record<string, AvailProduct> = {};
    const cart: CartLine[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `p${i}`;
      many[id] =
        i % 2 === 0
          ? unit(id, { doughG: 10 + i })
          : unit(id, { capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 300, piecesPerRound: 4 });
      cart.push(L(id, 99));
    }
    const d: OpenDay = { date: THU, isOpen: true, limits: limits({ doughLimitG: 5000 }), orders: [] };
    const t0 = performance.now();
    const keep = largestFittingKeep(cart, many, d);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(keep).toHaveLength(50);
    // Result fits: recompute dough.
    let dough = 0;
    keep.forEach((s, i) => {
      dough += i % 2 === 0 ? s * (10 + i) : Math.ceil(s / 4) * 300;
    });
    expect(dough).toBeLessThanOrEqual(5000);
  });

  it(`carts above ${MAX_HINT_PIECES} pieces get no hints`, () => {
    const big: Record<string, AvailProduct> = { ...products };
    const cart: CartLine[] = [];
    for (let i = 0; i < 4; i++) {
      big[`b${i}`] = unit(`b${i}`);
      cart.push(L(`b${i}`, 80));
    }
    const plan = planCart(input(cart, [dayLeft(THU, 1600)], { products: big, maxQtyPerItem: 99 }), THU);
    expect(plan).toEqual({ state: "FULL", hints: [] });
  });
});
