import { expect, it } from "vitest";
import { checkDay } from "@/domain/capacity";
import { lineTotal } from "@/domain/pricing";
import { flavorPrice } from "@/domain/flavorPricing";
import type { CapacityProduct, DayOrder } from "@/domain/types";

const p: CapacityProduct = { id: "p", capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, piecesPerRound: 4, dailyLimit: null, leadDays: 1, flavors: [{ id: "a", dailyLimit: 3 }, { id: "b", dailyLimit: null }] };
const order: DayOrder = { id: "old", status: "NEW", fulfillment: "PICKUP", items: [{ productId: "p", flavorId: "a", qty: 2 }] };
const check = (qty: number, overrides = {}, existing = [order], excludeOrderId?: string) => checkDay({ date: "2026-11-04", existing, excludeOrderId, candidate: { fulfillment: "PICKUP", items: [{ productId: "p", flavorId: "a", qty }] }, products: { p }, limits: { doughLimitG: 340, deliveryEnabled: true, deliveryLimit: 8, productLimits: {}, flavorLimits: overrides } });

it("FP1/FP2: flavour bundles use product size, null never inherits product bundle", () => {
  const product = { unitPriceCents: 300, bundleSize: 4, bundlePriceCents: 1000 };
  expect(lineTotal(5, flavorPrice(product, { priceCents: 450, bundlePriceCents: 1600 }))).toBe(2050);
  expect(lineTotal(5, flavorPrice(product, { priceCents: 450, bundlePriceCents: null }))).toBe(2250);
});
it("FC1: fits both limits exactly; FC2: flavour fails while round still fits", () => {
  expect(check(1).ok).toBe(true);
  expect(check(2).violations).toEqual([{ kind: "PRODUCT", date: "2026-11-04", productId: "p", flavorId: "a", limit: 3, after: 4, over: 1 }]);
});
it("FC3: override wins including zero; FC4: product round limit still applies", () => {
  expect(check(1, { a: 0 }).ok).toBe(false);
  expect(check(2, { a: 4 }).ok).toBe(true);
  expect(check(3, { a: 9 }).violations.map(v => v.kind)).toEqual(["DOUGH"]);
});
it("FC5: edit replaces old content; FC6: cancelled/rejected do not count", () => {
  expect(check(3, {}, [order], "old").ok).toBe(true);
  for (const status of ["CANCELLED", "REJECTED"] as const) expect(check(3, {}, [{ ...order, status }]).ok).toBe(true);
});

it("FP3: bundles never mix flavours", async () => {
  const { priceCart } = await import("@/domain/pricing");
  const price = flavorPrice({ unitPriceCents: 300, bundleSize: 4, bundlePriceCents: 1000 }, { priceCents: 450, bundlePriceCents: 1600 });
  expect(priceCart([{ productId: "p", flavorId: "a", qty: 3, price }, { productId: "p", flavorId: "b", qty: 1, price }], "PICKUP", { deliveryFeeCents: 500, freeDeliveryMinCents: 2500 }).subtotalCents).toBe(1800);
});
it("FC7: null flavour limit is unlimited but product override still applies", () => {
  const product = { ...p, capacityMode: "INDEPENDENT" as const, dailyLimit: 8 };
  const run = (productLimit: number) => checkDay({ date: "2026-11-04", existing: [order], products: { p: product }, candidate: { fulfillment: "PICKUP", items: [{ productId: "p", flavorId: "b", qty: 3 }] }, limits: { doughLimitG: 340, deliveryEnabled: true, deliveryLimit: 8, productLimits: { p: productLimit } } });
  expect(run(5).ok).toBe(true);
  expect(run(4).violations).toEqual([{ kind: "PRODUCT", date: "2026-11-04", productId: "p", limit: 4, after: 5, over: 1 }]);
});
it("FH1: reduction keeps the largest cart within flavour and shared product limits", async () => {
  const { largestFittingKeep } = await import("@/domain/hints");
  const keep = largestFittingKeep([{ productId: "p", flavorId: "a", qty: 3 }, { productId: "p", flavorId: "b", qty: 3 }], { p }, { date: "2026-11-04", isOpen: true, orders: [order], limits: { doughLimitG: 340, deliveryEnabled: true, deliveryLimit: 8, productLimits: {} } });
  expect(keep).toEqual([1, 1]);
});
