import { describe, expect, it } from "vitest";
import {
  buildCreatePayload,
  buildEditPayload,
  cleanLines,
  describeViolation,
  estimate,
  parseViolations,
  type FormValues,
} from "@/lib/orderForm";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const base: FormValues = {
  items: [{ productId: A, qty: 4 }],
  pickupDate: "2026-10-30",
  fulfillment: "PICKUP",
  wechatId: "wx_amy",
  note: "",
};

describe("cleanLines", () => {
  it("drops zero / invalid qty and merges duplicates", () => {
    expect(
      cleanLines([
        { productId: A, qty: 2 },
        { productId: B, qty: 0 },
        { productId: A, qty: 3 },
        { productId: B, qty: -1 },
        { productId: B, qty: 1.5 },
      ]),
    ).toEqual([{ productId: A, qty: 5 }]);
  });
});

describe("estimate", () => {
  const prices = {
    [A]: { unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899 },
    [B]: { unitPriceCents: 500, bundleSize: 4, bundlePriceCents: null },
  };
  const fees = { deliveryFeeCents: 500, freeDeliveryMinCents: 2500 };

  it("uses bundle pricing and adds the delivery fee under the free-delivery minimum", () => {
    const e = estimate([{ productId: A, qty: 4 }], prices, "DELIVERY", fees);
    expect(e).toEqual({ subtotalCents: 899, deliveryFeeCents: 500, totalCents: 1399 });
  });

  it("no fee for pickup or at/above the minimum; unknown products are skipped", () => {
    expect(estimate([{ productId: B, qty: 5 }], prices, "DELIVERY", fees).deliveryFeeCents).toBe(0);
    expect(estimate([{ productId: A, qty: 4 }], prices, "PICKUP", fees).totalCents).toBe(899);
    expect(estimate([{ productId: "nope", qty: 4 }], prices, "PICKUP", fees).totalCents).toBe(0);
  });
});

describe("buildCreatePayload", () => {
  it("trims, cleans and sends no prices", () => {
    const p = buildCreatePayload({ ...base, wechatId: "  wx_amy ", note: " hi ", items: [...base.items, { productId: B, qty: 0 }] });
    expect(p).toEqual({
      items: [{ productId: A, qty: 4 }],
      pickupDate: "2026-10-30",
      fulfillment: "PICKUP",
      wechatId: "wx_amy",
      note: "hi",
    });
  });

  it("adds override and a trimmed reason only when confirming an over-limit save", () => {
    const p = buildCreatePayload(base, { override: true, reason: " regular customer " });
    expect(p.override).toBe(true);
    expect(p.reason).toBe("regular customer");
  });
});

describe("buildEditPayload", () => {
  const stamp = "2026-10-27T15:00:00.000Z";

  it("returns null when nothing changed", () => {
    expect(buildEditPayload(base, { ...base, items: [{ productId: A, qty: 4 }] }, stamp)).toBeNull();
    expect(buildEditPayload(base, { ...base, wechatId: " wx_amy " }, stamp)).toBeNull();
  });

  it("sends only the changed fields plus expectedUpdatedAt", () => {
    const p = buildEditPayload(
      base,
      { ...base, items: [{ productId: A, qty: 8 }], fulfillment: "DELIVERY", note: "ring bell" },
      stamp,
    );
    expect(p).toEqual({
      items: [{ productId: A, qty: 8 }],
      fulfillment: "DELIVERY",
      note: "ring bell",
      expectedUpdatedAt: stamp,
    });
  });

  it("detects a date change and a cleared note", () => {
    const withNote = { ...base, note: "x" };
    expect(buildEditPayload(withNote, { ...withNote, note: "" }, stamp)).toEqual({
      note: "",
      expectedUpdatedAt: stamp,
    });
    expect(buildEditPayload(base, { ...base, pickupDate: "2026-10-31" }, stamp)).toEqual({
      pickupDate: "2026-10-31",
      expectedUpdatedAt: stamp,
    });
  });

  it("treats the same lines in another order as unchanged, and carries override + reason", () => {
    const two = { ...base, items: [{ productId: A, qty: 1 }, { productId: B, qty: 2 }] };
    expect(buildEditPayload(two, { ...two, items: [...two.items].reverse() }, stamp)).toBeNull();
    const p = buildEditPayload(base, { ...base, wechatId: "other" }, stamp, { override: true, reason: "ok" });
    expect(p).toMatchObject({ wechatId: "other", override: true, reason: "ok" });
  });
});

describe("describeViolation / parseViolations", () => {
  it("renders every violation kind in Chinese", () => {
    const names = { [A]: "奶酥红豆包" };
    expect(describeViolation({ kind: "DOUGH", date: "2026-10-30", limit: 1600, after: 1720, over: 120 }, names)).toBe(
      "10/30 周五 面团：上限 1600 g，保存后 1720 g，超出 120 g",
    );
    expect(
      describeViolation({ kind: "PRODUCT", date: "2026-10-30", productId: A, limit: 24, after: 25, over: 1 }, names),
    ).toContain("奶酥红豆包");
    expect(describeViolation({ kind: "DELIVERY", date: "2026-10-30", limit: 8, after: 9, over: 1 }, names)).toContain(
      "配送",
    );
    expect(describeViolation({ kind: "DELIVERY_DISABLED", date: "2026-10-30" }, names)).toContain("不配送");
  });

  it("parseViolations ignores junk", () => {
    expect(parseViolations(undefined)).toEqual([]);
    expect(parseViolations([null, 3, { kind: "DELIVERY", date: "d", limit: 1, after: 2, over: 1 }])).toHaveLength(1);
  });
});
