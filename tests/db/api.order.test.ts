import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { GET } from "@/app/api/o/[token]/route";
import { POST as CANCEL } from "@/app/api/o/[token]/cancel/route";
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
import { getRequest, jsonRequest, NOW, tokenParams, UNKNOWN_TOKEN } from "./api.helpers";

let ids: DefaultProductIds;
const FUTURE_CUTOFF = new Date("2026-10-21T01:00:00Z"); // 10/20 20:00 CDT, after NOW

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await createSettings({ orderingEnabled: true, ownerWechatId: "bunny_owner" });
  ids = await createDefaultProducts();
  await createOpenDate("2026-10-22");
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function make(status: "NEW" | "CONFIRMED" | "BAKING" | "REJECTED" | "CANCELLED" | "READY", cutoffAt = FUTURE_CUTOFF, productId = ids.redBean) {
  const o = await createOrder({ date: "2026-10-22", items: [{ productId, qty: 2 }], status });
  await db.order.update({ where: { id: o.id }, data: { cutoffAt, note: "少糖" } });
  return o;
}
const view = (token: string) => GET(getRequest(`/api/o/${token}`), tokenParams(token));
const cancel = (token: string, headers: Record<string, string> = {}) =>
  CANCEL(jsonRequest(`/api/o/${token}/cancel`, {}, headers), tokenParams(token));

describe("GET /api/o/{token}", () => {
  it("returns exactly the customer fields", async () => {
    const o = await make("NEW");
    const res = await view(o.viewToken);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(
      [
        "canCancel",
        "cancelDeadlineLabel",
        "deliveryFeeCents",
        "fulfillment",
        "items",
        "note",
        "orderNo",
        "ownerWechatId",
        "pickupDate",
        "pickupDateLabel",
        "pickupNote",
        "statusKind",
        "statusText",
        "subtotalCents",
        "totalCents",
      ].sort(),
    );
    expect(Object.keys(j.items[0]).sort()).toEqual(["lineTotalCents", "name", "qty"]);
    expect(j).toMatchObject({
      orderNo: o.orderNo,
      pickupDate: "2026-10-22",
      pickupDateLabel: "10/22 周四",
      statusKind: "PENDING",
      statusText: "已收到，等待确认（请加店主微信 bunny_owner）",
      canCancel: true,
      cancelDeadlineLabel: "10/20 周二 20:00 前可以自己取消",
      note: "少糖",
      ownerWechatId: "bunny_owner",
    });
    expect(j.items[0].name).toBe("奶酥红豆包");
    const text = JSON.stringify(j);
    expect(text).not.toContain(o.wechatId);
    expect(text).not.toContain(o.id);
    for (const leak of ["paid", "Paid", "viewToken", "ipHash", "cutoffAt", "status\""]) expect(text).not.toContain(leak);
  });

  it("lists items by product sortOrder, independent of insertion order", async () => {
    const o = await createOrder({
      date: "2026-10-22",
      items: [
        { productId: ids.brulee, qty: 1 },
        { productId: ids.cheeseHorn, qty: 1 },
        { productId: ids.redBean, qty: 1 },
        { productId: ids.rockCheese, qty: 1 },
      ],
    });
    const j = await (await view(o.viewToken)).json();
    expect(j.items.map((i: { name: string }) => i.name)).toEqual(["奶酥红豆包", "岩烧乳酪包", "奶酪角", "焦糖布蕾"]);
  });

  it("shows REJECTED as cancelled", async () => {
    const o = await make("REJECTED");
    const j = await (await view(o.viewToken)).json();
    expect(j.statusText).toBe("订单已取消");
    expect(j.statusKind).toBe("CANCELLED");
    expect(j.canCancel).toBe(false);
    expect(j.cancelDeadlineLabel).toBeNull();
  });

  it("BAKING text depends on current product modes", async () => {
    await createSettings({ bakingTextBread: "面包制作中", bakingTextOther: "布蕾制作中" });
    const bread = await make("BAKING");
    const dessert = await make("BAKING", FUTURE_CUTOFF, ids.brulee);
    expect((await (await view(bread.viewToken)).json()).statusText).toBe("面包制作中");
    const j = await (await view(dessert.viewToken)).json();
    expect(j.statusText).toBe("布蕾制作中");
    expect(j.statusKind).toBe("BAKING");
  });

  it("unknown and garbage tokens give identical 404s", async () => {
    const a = await view(UNKNOWN_TOKEN);
    const b = await view("garbage");
    const c = await view("x".repeat(500));
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const body = await a.json();
    expect(await b.json()).toEqual(body);
    expect(await c.json()).toEqual(body);
    expect(body.error).toBe("NOT_FOUND");
    expect(a.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/o/{token}/cancel", () => {
  it("cancels, and is idempotent", async () => {
    const o = await make("CONFIRMED");
    const res = await cancel(o.viewToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "CANCELLED" });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELLED");
    const again = await cancel(o.viewToken);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "CANCELLED" });
  });

  it("after the cutoff -> 409 CUTOFF_PASSED with the owner message", async () => {
    const o = await make("NEW", new Date("2026-10-20T01:00:00Z"));
    const res = await cancel(o.viewToken);
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toBe("CUTOFF_PASSED");
    expect(j.message).toBe("已过取消时间，请微信联系店主");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("NEW");
  });

  it("BAKING -> 409 NOT_CANCELLABLE", async () => {
    const o = await make("BAKING");
    const res = await cancel(o.viewToken);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("NOT_CANCELLABLE");
  });

  it("unknown / malformed token -> 404", async () => {
    expect((await cancel(UNKNOWN_TOKEN)).status).toBe(404);
    expect((await cancel("bad")).status).toBe(404);
  });

  it("rejects a non-JSON content type and does not cancel", async () => {
    const o = await make("NEW");
    const res = await CANCEL(
      new Request(`http://x/api/o/${o.viewToken}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
      tokenParams(o.viewToken),
    );
    expect(res.status).toBe(422);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("NEW");
  });
});
