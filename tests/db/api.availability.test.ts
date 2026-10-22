import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { POST } from "@/app/api/availability/route";
import { prisma } from "@/server/db";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";
import { jsonRequest, NOW } from "./api.helpers";

let ids: DefaultProductIds;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

const call = (body: unknown) => POST(jsonRequest("/api/availability", body));

describe("POST /api/availability", () => {
  it("reports CUTOFF for a lead-2 cart", async () => {
    await createOpenDate("2026-10-21");
    await createOpenDate("2026-10-22");
    const res = await call({ items: [{ productId: ids.brulee, qty: 1 }], fulfillment: "PICKUP" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dates.map((d: { date: string; state: string }) => [d.date, d.state])).toEqual([
      ["2026-10-21", "CUTOFF"],
      ["2026-10-22", "AVAILABLE"],
    ]);
  });

  it("reports AVAILABLE / FULL / DELIVERY_FULL; cutoff fields only on AVAILABLE", async () => {
    await createOpenDate("2026-10-21");
    await createOpenDate("2026-10-23", { doughLimitG: 70 });
    await createOpenDate("2026-10-24", { deliveryLimit: 0 });
    await createOrder({ date: "2026-10-23", items: [{ productId: ids.redBean, qty: 1 }] });
    const res = await call({ items: [{ productId: ids.redBean, qty: 2 }], fulfillment: "DELIVERY" });
    const dates = (await res.json()).dates as Record<string, unknown>[];
    const by = Object.fromEntries(dates.map((d) => [d.date as string, d]));
    expect(by["2026-10-21"]).toEqual({
      date: "2026-10-21",
      state: "AVAILABLE",
      cutoffAt: "2026-10-21T01:00:00.000Z",
      cutoffLabel: "10/20 周二 20:00 截止",
    });
    expect(by["2026-10-23"]).toEqual({ date: "2026-10-23", state: "FULL" });
    expect(by["2026-10-24"]).toEqual({ date: "2026-10-24", state: "DELIVERY_FULL" });
  });

  it("prices with P7 free delivery and a gap", async () => {
    const low = await (await call({ items: [{ productId: ids.redBean, qty: 4 }], fulfillment: "DELIVERY" })).json();
    expect(low.pricing).toEqual({
      subtotalCents: 899,
      deliveryFeeCents: 500,
      totalCents: 1399,
      freeDeliveryGapCents: 1601,
    });
    const high = await (
      await call({
        items: [
          { productId: ids.redBean, qty: 8 },
          { productId: ids.cheeseHorn, qty: 4 },
        ],
        fulfillment: "DELIVERY",
      })
    ).json();
    expect(high.pricing).toMatchObject({ subtotalCents: 1798 + 1099, deliveryFeeCents: 0, freeDeliveryGapCents: 0 });
  });

  it("reports paused / archived / over-max in cartProblems; archived is not priced", async () => {
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    await db.product.update({ where: { id: ids.cheeseHorn }, data: { status: "ARCHIVED" } });
    const body = await (
      await call({
        items: [
          { productId: ids.rockCheese, qty: 1 },
          { productId: ids.redBean, qty: 9 },
          { productId: ids.cheeseHorn, qty: 1 },
        ],
        fulfillment: "PICKUP",
      })
    ).json();
    expect(body.cartProblems).toEqual(
      expect.arrayContaining([
        { productId: ids.rockCheese, error: "PRODUCT_UNAVAILABLE" },
        { productId: ids.cheeseHorn, error: "PRODUCT_UNAVAILABLE" },
        { productId: ids.redBean, error: "QTY_LIMIT" },
      ]),
    );
    // rock cheese 249 + 9 red bean (2 bundles + 1) = 249 + 1798 + 249; cheese horn excluded
    expect(body.pricing.subtotalCents).toBe(249 + 899 * 2 + 249);
  });

  it("never leaks grams or limits", async () => {
    await createOpenDate("2026-10-22");
    const body = await (await call({ items: [{ productId: ids.redBean, qty: 1 }], fulfillment: "PICKUP" })).json();
    expect(Object.keys(body).sort()).toEqual(["cartProblems", "dates", "orderingEnabled", "pricing"]);
    expect(Object.keys(body.pricing).sort()).toEqual([
      "deliveryFeeCents",
      "freeDeliveryGapCents",
      "subtotalCents",
      "totalCents",
    ]);
    const text = JSON.stringify(body);
    for (const leak of ["doughG", "imit", "used", "violations"]) expect(text).not.toContain(leak);
  });

  it("422 on invalid bodies and wrong content type", async () => {
    for (const bad of [
      {},
      { items: [], fulfillment: "PICKUP" },
      { items: [{ productId: ids.redBean, qty: 0 }], fulfillment: "PICKUP" },
      { items: [{ productId: ids.redBean, qty: 101 }], fulfillment: "PICKUP" },
      { items: [{ productId: ids.redBean, qty: 1.5 }], fulfillment: "PICKUP" },
      { items: [{ productId: "nope", qty: 1 }], fulfillment: "PICKUP" },
      { items: [{ productId: ids.redBean, qty: 1 }], fulfillment: "TELEPORT" },
      "not json{",
    ]) {
      const res = await call(bad);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("VALIDATION");
    }
    const res = await POST(
      new Request("http://x/api/availability", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ items: [{ productId: ids.redBean, qty: 1 }], fulfillment: "PICKUP" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("returns no dates when ordering is off", async () => {
    await createSettings({ orderingEnabled: false });
    await createOpenDate("2026-10-22");
    const body = await (await call({ items: [{ productId: ids.redBean, qty: 1 }], fulfillment: "PICKUP" })).json();
    expect(body.orderingEnabled).toBe(false);
    expect(body.dates).toEqual([]);
  });
});
