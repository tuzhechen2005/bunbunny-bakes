import { describe, expect, it } from "vitest";
import {
  deliveryFee,
  formatCents,
  lineTotal,
  priceCart,
  type PricedLine,
} from "@/domain/pricing";
import type { FeeSettings, PriceSnapshot } from "@/domain/types";

// Default prices from CAPACITY_RULES.md §2.3.
const BUN: PriceSnapshot = { unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899 };
const CHEESE_BUN: PriceSnapshot = { unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899 };
const CHEESE_HORN: PriceSnapshot = { unitPriceCents: 299, bundleSize: 4, bundlePriceCents: 1099 };
const BRULEE: PriceSnapshot = { unitPriceCents: 229, bundleSize: 4, bundlePriceCents: 899 };

const PRICES: Record<string, PriceSnapshot> = {
  bun: BUN,
  cheeseBun: CHEESE_BUN,
  cheeseHorn: CHEESE_HORN,
  brulee: BRULEE,
};

const FEES: FeeSettings = { deliveryFeeCents: 500, freeDeliveryMinCents: 2500 };

function cart(items: [string, number][]): PricedLine[] {
  return items.map(([productId, qty]) => ({ productId, qty, price: PRICES[productId] }));
}

const ROWS: { name: string; items: [string, number][]; subtotal: number; fee: number; total: number }[] = [
  { name: "P1 bun x3", items: [["bun", 3]], subtotal: 747, fee: 500, total: 1247 },
  { name: "P2 bun x4", items: [["bun", 4]], subtotal: 899, fee: 500, total: 1399 },
  { name: "P3 bun x5", items: [["bun", 5]], subtotal: 1148, fee: 500, total: 1648 },
  { name: "P4 cheese horn x5", items: [["cheeseHorn", 5]], subtotal: 1398, fee: 500, total: 1898 },
  {
    name: "P5 bun x3 + cheese bun x1 (no cross-product bundle)",
    items: [["bun", 3], ["cheeseBun", 1]],
    subtotal: 996,
    fee: 500,
    total: 1496,
  },
  {
    name: "P6 bun x4 + cheese horn x4",
    items: [["bun", 4], ["cheeseHorn", 4]],
    subtotal: 1998,
    fee: 500,
    total: 2498,
  },
  {
    name: "P7 bun x4 + cheese bun x4 + cheese horn x4",
    items: [["bun", 4], ["cheeseBun", 4], ["cheeseHorn", 4]],
    subtotal: 2897,
    fee: 0,
    total: 2897,
  },
  { name: "P8 brulee x8", items: [["brulee", 8]], subtotal: 1798, fee: 500, total: 2298 },
  {
    name: "P9 cheese horn x8 + bun x1",
    items: [["cheeseHorn", 8], ["bun", 1]],
    subtotal: 2447,
    fee: 500,
    total: 2947,
  },
  {
    name: "P10 cheese horn x8 + bun x2",
    items: [["cheeseHorn", 8], ["bun", 2]],
    subtotal: 2696,
    fee: 0,
    total: 2696,
  },
];

describe("priceCart: CAPACITY_RULES §2.3 examples (delivery)", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const r = priceCart(cart(row.items), "DELIVERY", FEES);
      expect(r.subtotalCents).toBe(row.subtotal);
      expect(r.deliveryFeeCents).toBe(row.fee);
      expect(r.totalCents).toBe(row.total);
    });
  }
});

describe("priceCart details", () => {
  it("returns per-line totals in input order", () => {
    const r = priceCart(cart([["bun", 3], ["cheeseBun", 1]]), "DELIVERY", FEES);
    expect(r.lines).toEqual([
      { productId: "bun", qty: 3, lineTotalCents: 747 },
      { productId: "cheeseBun", qty: 1, lineTotalCents: 249 },
    ]);
  });

  it("PICKUP has no delivery fee", () => {
    const r = priceCart(cart([["bun", 3]]), "PICKUP", FEES);
    expect(r.deliveryFeeCents).toBe(0);
    expect(r.totalCents).toBe(747);
  });

  it("freeDeliveryGap for P6 is 2500 - 1998 = 502", () => {
    expect(priceCart(cart([["bun", 4], ["cheeseHorn", 4]]), "DELIVERY", FEES).freeDeliveryGapCents).toBe(502);
  });

  it("freeDeliveryGap for P7 is 0", () => {
    expect(
      priceCart(cart([["bun", 4], ["cheeseBun", 4], ["cheeseHorn", 4]]), "DELIVERY", FEES).freeDeliveryGapCents,
    ).toBe(0);
  });

  it("freeDeliveryGap is computed for PICKUP too", () => {
    expect(priceCart(cart([["bun", 3]]), "PICKUP", FEES).freeDeliveryGapCents).toBe(2500 - 747);
  });

  it("empty cart prices to zero subtotal and charges delivery fee", () => {
    const r = priceCart([], "DELIVERY", FEES);
    expect(r.lines).toEqual([]);
    expect(r.subtotalCents).toBe(0);
    expect(r.deliveryFeeCents).toBe(500);
    expect(r.totalCents).toBe(500);
    expect(r.freeDeliveryGapCents).toBe(2500);
  });

  it("throws when the same productId appears in two lines", () => {
    expect(() => priceCart(cart([["bun", 2], ["bun", 2]]), "DELIVERY", FEES)).toThrow(Error);
  });

  it("throws RangeError for invalid fee settings", () => {
    expect(() => priceCart(cart([["bun", 1]]), "DELIVERY", { deliveryFeeCents: -1, freeDeliveryMinCents: 2500 })).toThrow(
      RangeError,
    );
  });
});

describe("deliveryFee boundaries", () => {
  it("2499 subtotal on DELIVERY → 500", () => {
    expect(deliveryFee(2499, "DELIVERY", FEES)).toBe(500);
  });
  it("2500 subtotal on DELIVERY → 0", () => {
    expect(deliveryFee(2500, "DELIVERY", FEES)).toBe(0);
  });
  it("PICKUP → always 0", () => {
    expect(deliveryFee(0, "PICKUP", FEES)).toBe(0);
    expect(deliveryFee(2499, "PICKUP", FEES)).toBe(0);
    expect(deliveryFee(2500, "PICKUP", FEES)).toBe(0);
  });
});

describe("lineTotal", () => {
  it("bundlePriceCents null → qty × unitPrice", () => {
    expect(lineTotal(5, { unitPriceCents: 300, bundleSize: 4, bundlePriceCents: null })).toBe(1500);
  });

  it("bundleSize 3", () => {
    const p: PriceSnapshot = { unitPriceCents: 300, bundleSize: 3, bundlePriceCents: 800 };
    expect(lineTotal(2, p)).toBe(600);
    expect(lineTotal(3, p)).toBe(800);
    expect(lineTotal(7, p)).toBe(800 * 2 + 300);
  });

  it("bundleSize 1 prices every unit at bundle price", () => {
    expect(lineTotal(3, { unitPriceCents: 300, bundleSize: 1, bundlePriceCents: 250 })).toBe(750);
  });
});

describe("formatCents", () => {
  it("1398 → $13.98", () => expect(formatCents(1398)).toBe("$13.98"));
  it("0 → $0.00", () => expect(formatCents(0)).toBe("$0.00"));
  it("500 → $5.00", () => expect(formatCents(500)).toBe("$5.00"));
  it("7 → $0.07", () => expect(formatCents(7)).toBe("$0.07"));
  it("123456 → $1234.56 (no thousands separator)", () => expect(formatCents(123456)).toBe("$1234.56"));
});

describe("RangeError cases", () => {
  const ok: PriceSnapshot = { unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899 };

  it("qty 0", () => expect(() => lineTotal(0, ok)).toThrow(RangeError));
  it("qty negative", () => expect(() => lineTotal(-1, ok)).toThrow(RangeError));
  it("qty non-integer", () => expect(() => lineTotal(1.5, ok)).toThrow(RangeError));
  it("qty NaN", () => expect(() => lineTotal(Number.NaN, ok)).toThrow(RangeError));
  it("unitPrice negative", () => expect(() => lineTotal(1, { ...ok, unitPriceCents: -1 })).toThrow(RangeError));
  it("unitPrice non-integer", () => expect(() => lineTotal(1, { ...ok, unitPriceCents: 2.5 })).toThrow(RangeError));
  it("bundlePrice negative", () => expect(() => lineTotal(1, { ...ok, bundlePriceCents: -1 })).toThrow(RangeError));
  it("bundlePrice non-integer", () => expect(() => lineTotal(1, { ...ok, bundlePriceCents: 8.5 })).toThrow(RangeError));
  it("bundleSize 0", () => expect(() => lineTotal(1, { ...ok, bundleSize: 0 })).toThrow(RangeError));
  it("bundleSize non-integer", () => expect(() => lineTotal(1, { ...ok, bundleSize: 2.5 })).toThrow(RangeError));
  it("bundleSize invalid even when bundlePrice is null", () =>
    expect(() => lineTotal(1, { ...ok, bundleSize: 0, bundlePriceCents: null })).toThrow(RangeError));
  it("deliveryFee: negative subtotal", () => expect(() => deliveryFee(-1, "DELIVERY", FEES)).toThrow(RangeError));
  it("deliveryFee: non-integer fee", () =>
    expect(() => deliveryFee(100, "DELIVERY", { deliveryFeeCents: 4.5, freeDeliveryMinCents: 2500 })).toThrow(RangeError));
  it("deliveryFee: negative free-delivery minimum", () =>
    expect(() => deliveryFee(100, "PICKUP", { deliveryFeeCents: 500, freeDeliveryMinCents: -1 })).toThrow(RangeError));
  it("formatCents: negative", () => expect(() => formatCents(-1)).toThrow(RangeError));
  it("formatCents: non-integer", () => expect(() => formatCents(1.5)).toThrow(RangeError));
});
