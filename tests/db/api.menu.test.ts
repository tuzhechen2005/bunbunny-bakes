import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { GET } from "@/app/api/menu/route";
import { prisma } from "@/server/db";
import { createDefaultProducts, createSettings, db, resetDb } from "./helpers";
import { getRequest } from "./api.helpers";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

const PRODUCT_KEYS = [
  "bundlePriceCents",
  "bundleSize",
  "description",
  "id",
  "imageUrl",
  "leadDays",
  "name",
  "status",
  "unitPriceCents",
];

describe("GET /api/menu", () => {
  it("lists ACTIVE and PAUSED products in sortOrder and hides ARCHIVED", async () => {
    await createSettings({ orderingEnabled: true });
    const ids = await createDefaultProducts();
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    await db.product.update({ where: { id: ids.cheeseHorn }, data: { status: "ARCHIVED" } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderingEnabled).toBe(true);
    expect(body.products.map((p: { id: string }) => p.id)).toEqual([ids.redBean, ids.rockCheese, ids.brulee]);
    expect(body.products[1].status).toBe("PAUSED");
    expect(body.products[0]).toMatchObject({
      name: "奶酥红豆包",
      unitPriceCents: 249,
      bundleSize: 4,
      bundlePriceCents: 899,
      status: "ACTIVE",
      leadDays: 1,
    });
  });

  it("contains no internal fields (exact key sets)", async () => {
    await createSettings({ orderingEnabled: true });
    await createDefaultProducts();
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(
      ["deliveryFeeCents", "freeDeliveryMinCents", "maxQtyPerItem", "orderingEnabled", "pickupNote", "products"],
    );
    for (const p of body.products) expect(Object.keys(p).sort()).toEqual(PRODUCT_KEYS);
    const text = JSON.stringify(body);
    for (const leak of ["doughG", "roundG", "piecesPerRound", "dailyLimit", "batchYield", "capacityMode"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("returns the settings values", async () => {
    await createSettings({ deliveryFeeCents: 600, freeDeliveryMinCents: 3000, maxQtyPerItem: 5, pickupNote: "下午五点后" });
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      orderingEnabled: false,
      deliveryFeeCents: 600,
      freeDeliveryMinCents: 3000,
      maxQtyPerItem: 5,
      pickupNote: "下午五点后",
    });
  });

  it("includes ownerWechatId only when showWechatOnHome is on (D44)", async () => {
    await createSettings({ ownerWechatId: "bunny_owner", showWechatOnHome: false });
    expect(await (await GET()).json()).not.toHaveProperty("ownerWechatId");
    await createSettings({ ownerWechatId: "bunny_owner", showWechatOnHome: true });
    expect((await (await GET()).json()).ownerWechatId).toBe("bunny_owner");
  });
});

describe("menu route wiring", () => {
  it("is a plain GET that ignores the request", async () => {
    await createSettings({});
    const res = await GET();
    expect(res.status).toBe(200);
    void getRequest("/api/menu");
  });
});
