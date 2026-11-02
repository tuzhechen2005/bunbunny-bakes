import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
import { GET } from "@/app/api/shop/route";
import { POST } from "@/app/api/shop/buy/route";
import { prisma } from "@/server/db";
import { SHOP_BUY_LIMIT, SHOP_READ_LIMIT } from "@/server/shop";
import { gameIpHash } from "@/server/gameRoute";
import { db, resetDb } from "./helpers";
import { getRequest, jsonRequest } from "./api.helpers";

const headers = { "x-forwarded-for": "192.0.2.1" };
const get = (id = " WX ") => GET(getRequest(`/api/shop?wechatId=${encodeURIComponent(id)}`, headers));
const buy = (body: unknown = { wechatId: " WX ", item: "bomb", qty: 1 }) => POST(jsonRequest("/api/shop/buy", body, headers));
beforeEach(async () => { process.env.IP_HASH_SECRET = "shop-test"; await resetDb(); });
afterAll(async () => { await db.$disconnect(); await prisma.$disconnect(); });

it("opens both routes without ownership proof, scopes data and logs purchases atomically", async () => {
  for (const id of ["wx", "other-private-player"]) {
    await db.coinLedger.create({ data: { wechatIdNorm: id, delta: 200, reason: "ORDER", refId: id } });
  }
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const view = await response.json();
  expect(view.balance).toBe(200);
  expect(view.recentOrderAwards).toHaveLength(1);
  expect(JSON.stringify(view)).not.toMatch(/wechatId|refId|other-private-player/);
  const bought = await buy();
  expect(bought.status).toBe(200);
  expect(await bought.json()).toMatchObject({ balance: 140, inventory: { bomb: 1, bell: 0, slide: 0 } });
  expect(await db.auditLog.findFirst()).toMatchObject({ actor: "CUSTOMER", action: "shop.purchase", after: { wechatIdNorm: "wx", item: "bomb", qty: 1, cost: 60 } });
  expect((await (await get("other-private-player")).json()).balance).toBe(200);
});

it.each([null, {}, { wechatId: " " }, { wechatId: "wx", item: "bomb", qty: -1 }, { wechatId: "wx", item: "bomb", qty: 1.5 }, { wechatId: "wx", item: "bomb", qty: 101 }, { wechatId: "wx", item: "unknown", qty: 1 }])("rejects malformed purchases: %j", async body => {
  expect((await buy(body)).status).toBe(422);
  expect(await db.coinLedger.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});

it("rejects insufficient funds without inventory, ledger or audit writes", async () => {
  expect((await buy()).status).toBe(422);
  expect(await db.inventory.count()).toBe(0);
  expect(await db.coinLedger.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect((await get("")).status).toBe(422);
});

it.each(["read_ip", "read_wechat", "buy_ip", "buy_wechat"])("enforces the %s hourly limit", async bucket => {
  const ip = gameIpHash(getRequest("/api/shop", headers));
  const key = `shop_${bucket}:${bucket.endsWith("ip") ? ip : "wx"}`;
  const limit = bucket.startsWith("read") ? SHOP_READ_LIMIT : SHOP_BUY_LIMIT;
  await db.rateLimitHit.createMany({ data: Array.from({ length: limit }, () => ({ key, at: new Date() })) });
  const response = bucket.startsWith("read") ? await get() : await buy();
  expect(response.status).toBe(429);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await db.coinLedger.count()).toBe(0);
});

it("fails closed without the hashing secret", async () => {
  delete process.env.IP_HASH_SECRET;
  expect((await get()).status).toBe(500);
  expect((await buy()).status).toBe(500);
});
