// Product edits and capacity: price snapshots stay, capacity changes flag over-limit dates,
// and (M5 acceptance) a new "per round" product occupies dough correctly with no code change.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doughUsed } from "@/domain/capacity";
import { prisma } from "@/server/db";
import { loadDayContext, loadProductMap, loadSettings } from "@/server/day";
import { createCustomerOrder } from "@/server/orders";
import { createProduct, updateProduct } from "@/server/products";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const NOW = new Date("2026-10-27T15:00:00Z"); // Tue 10:00 CDT
const DATE = "2026-10-30";

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("price changes (D45)", () => {
  it("leave existing OrderItem snapshots and order totals untouched", async () => {
    await createOpenDate(DATE);
    const order = await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 4 }] });
    const before = await db.orderItem.findMany({ where: { orderId: order.id } });

    const { product, overLimitDates } = await updateProduct(
      db,
      P.redBean,
      { unitPriceCents: 399, bundlePriceCents: 1299, bundleSize: 3 },
      NOW,
    );
    expect(product.unitPriceCents).toBe(399);
    expect(overLimitDates).toEqual([]);

    expect(await db.orderItem.findMany({ where: { orderId: order.id } })).toEqual(before);
    const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.totalCents).toBe(order.totalCents);
  });
});

describe("capacity changes", () => {
  it("returns the open dates that become over limit under the new settings", async () => {
    // 22 red beans = 1540 g of 1600 g: fine at 70 g, over at 75 g.
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    await createOpenDate("2026-10-28", { isOpen: false });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 22 }] });
    await createOrder({ date: "2026-10-31", items: [{ productId: P.redBean, qty: 5 }] });
    await createOrder({ date: "2026-10-28", items: [{ productId: P.redBean, qty: 22 }] });

    const { overLimitDates } = await updateProduct(db, P.redBean, { doughG: 75 }, NOW);
    expect(overLimitDates).toEqual([{ date: DATE, kinds: ["DOUGH"] }]);
    // The edit is applied anyway (the owner may exceed limits, CLAUDE.md rule 6).
    expect((await db.product.findUniqueOrThrow({ where: { id: P.redBean } })).doughG).toBe(75);
  });

  it("ignores cancelled orders and dates before today", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-26");
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 22 }], status: "CANCELLED" });
    await createOrder({ date: "2026-10-26", items: [{ productId: P.redBean, qty: 22 }] });
    const { overLimitDates } = await updateProduct(db, P.redBean, { doughG: 75 }, NOW);
    expect(overLimitDates).toEqual([]);
  });

  it("flags PRODUCT when an INDEPENDENT limit is lowered below the booked quantity", async () => {
    await createOpenDate(DATE);
    await createOrder({ date: DATE, items: [{ productId: P.brulee, qty: 20 }] });
    const { overLimitDates } = await updateProduct(db, P.brulee, { dailyLimit: 12 }, NOW);
    expect(overLimitDates).toEqual([{ date: DATE, kinds: ["PRODUCT"] }]);
  });

  it("does not blame the edit for a day that was already over (owner override)", async () => {
    await createOpenDate(DATE, { doughLimitG: 1000 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 20 }] }); // 1400 g > 1000 already
    const { overLimitDates } = await updateProduct(db, P.redBean, { doughG: 75 }, NOW);
    expect(overLimitDates).toEqual([]);
  });

  it("switching a product to per-round re-prices its dough use over the day total", async () => {
    await createOpenDate(DATE, { doughLimitG: 1000 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 14 }] }); // 980 g
    const { overLimitDates } = await updateProduct(
      db,
      P.redBean,
      { capacityMode: "DOUGH_PER_ROUND", roundG: 500, piecesPerRound: 5 },
      NOW,
    );
    // ceil(14 / 5) * 500 = 1500 g > 1000 g
    expect(overLimitDates).toEqual([{ date: DATE, kinds: ["DOUGH"] }]);
  });
});

describe("M5 acceptance: a new per-round product needs no code change", () => {
  it("occupies dough as ceil(total / pieces) x roundG across orders on one day", async () => {
    const created = await createProduct(
      db,
      {
        name: "新大圆包",
        unitPriceCents: 320,
        capacityMode: "DOUGH_PER_ROUND",
        roundG: 360,
        piecesPerRound: 6,
        leadDays: 1,
      },
      NOW,
    );
    await createOpenDate(DATE);

    const place = (qty: number, wechatId: string) =>
      createCustomerOrder(
        db,
        { items: [{ productId: created.id, qty }], pickupDate: DATE, fulfillment: "PICKUP", wechatId },
        NOW,
      );
    const dough = async () => {
      const products = await db.$transaction(async (tx) => loadProductMap(tx));
      const ctx = await db.$transaction(async (tx) => loadDayContext(tx, DATE, await loadSettings(tx), products));
      return doughUsed(ctx.orders, products);
    };

    await place(3, "wx_a");
    expect(await dough()).toBe(360); // ceil(3/6) = 1 round
    await place(3, "wx_b");
    expect(await dough()).toBe(360); // 6 pieces in total: ONE round, not 2 x 360 (summed per order)
    await place(1, "wx_c");
    expect(await dough()).toBe(720); // 7 pieces -> 2 rounds
  });
});
