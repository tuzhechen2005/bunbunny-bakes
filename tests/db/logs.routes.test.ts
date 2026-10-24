// GET /api/admin/logs: auth, search, Chicago date bounds, cursor pagination.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let cookieToken: string | undefined;
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bb_session" && cookieToken !== undefined ? { name, value: cookieToken } : undefined,
  }),
}));

import { GET } from "@/app/api/admin/logs/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { atLabelOf, dateBounds } from "@/server/logs";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.shop";

interface Page {
  items: {
    id: string;
    at: string;
    atLabel: string;
    action: string;
    entityId: string;
    orderNo: string | null;
    actor: string;
    reason: string | null;
    before: unknown;
    after: unknown;
  }[];
  nextCursor: string | null;
}

async function get(query = ""): Promise<{ status: number; json: Page & { error?: string } }> {
  const res = await GET(new Request(`${SITE}/api/admin/logs${query}`));
  return { status: res.status, json: await res.json() };
}

function log(over: { at: string; action?: string; entityType?: string; entityId?: string; id?: string }) {
  return db.auditLog.create({
    data: {
      ...(over.id ? { id: over.id } : {}),
      at: new Date(over.at),
      actor: "ADMIN",
      action: over.action ?? "settings.update",
      entityType: over.entityType ?? "Setting",
      entityId: over.entityId ?? "1",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await createSettings();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  cookieToken = (await createSession(db, user.id, new Date())).token;
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("auth", () => {
  it("answers 401 without a session", async () => {
    cookieToken = undefined;
    expect((await get()).status).toBe(401);
  });
});

describe("labels and ordering", () => {
  it("formats atLabel in Chicago time (CDT and CST)", () => {
    expect(atLabelOf(new Date("2026-10-30T01:05:00Z"))).toBe("10/29 20:05"); // CDT = UTC-5
    expect(atLabelOf(new Date("2026-11-02T02:05:00Z"))).toBe("11/1 20:05"); // CST = UTC-6 after Nov 1
    expect(atLabelOf(new Date("2026-01-05T05:30:00Z"))).toBe("1/4 23:30");
  });

  it("returns newest first with all fields", async () => {
    await log({ at: "2026-10-30T01:05:00Z", action: "settings.update" });
    await log({ at: "2026-10-30T02:00:00Z", action: "admin.login" });
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.items.map((i) => i.action)).toEqual(["admin.login", "settings.update"]);
    expect(json.items[1]).toMatchObject({
      at: "2026-10-30T01:05:00.000Z",
      atLabel: "10/29 20:05",
      actor: "ADMIN",
      entityType: "Setting",
      entityId: "1",
      orderNo: null,
      before: null,
      after: null,
      reason: null,
    });
    expect(json.nextCursor).toBeNull();
  });
});

describe("search", () => {
  it("q = order number finds the order's logs, across years", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    await createOpenDate("2027-10-24");
    await createOpenDate("2026-10-25");
    const a = await createOrder({ date: "2026-10-24", items: [{ productId: p.redBean, qty: 1 }] });
    const b = await createOrder({ date: "2027-10-24", items: [{ productId: p.redBean, qty: 1 }] });
    const c = await createOrder({ date: "2026-10-25", items: [{ productId: p.redBean, qty: 1 }] });
    expect([a.orderNo, b.orderNo, c.orderNo]).toEqual(["1024-001", "1024-001", "1025-001"]);
    await log({ at: "2026-10-20T15:00:00Z", action: "order.create", entityType: "Order", entityId: a.id });
    await log({ at: "2026-10-21T15:00:00Z", action: "order.status", entityType: "Order", entityId: b.id });
    await log({ at: "2026-10-22T15:00:00Z", action: "order.create", entityType: "Order", entityId: c.id });
    await log({ at: "2026-10-23T15:00:00Z", action: "settings.update" });

    const { json } = await get("?q=1024-001");
    expect(json.items.map((i) => i.entityId)).toEqual([b.id, a.id]);
    expect(json.items.every((i) => i.orderNo === "1024-001")).toBe(true);

    expect((await get("?q=1024-009")).json.items).toEqual([]);
  });

  it("q = WeChat ID finds the customer's orders' logs (case-insensitive)", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    await createOpenDate("2026-10-25");
    const a = await createOrder({ date: "2026-10-24", wechatId: "Alice_wx", items: [{ productId: p.redBean, qty: 1 }] });
    const b = await createOrder({ date: "2026-10-25", wechatId: "alice_wx", items: [{ productId: p.redBean, qty: 1 }] });
    const c = await createOrder({ date: "2026-10-25", wechatId: "bob", items: [{ productId: p.redBean, qty: 1 }] });
    await log({ at: "2026-10-20T15:00:00Z", entityType: "Order", entityId: a.id, action: "order.create" });
    await log({ at: "2026-10-21T15:00:00Z", entityType: "Order", entityId: b.id, action: "order.create" });
    await log({ at: "2026-10-22T15:00:00Z", entityType: "Order", entityId: c.id, action: "order.create" });

    const { json } = await get("?q=ALICE_WX");
    expect(json.items.map((i) => i.entityId)).toEqual([b.id, a.id]);
    expect(json.items.map((i) => i.orderNo)).toEqual(["1025-001", "1024-001"]);
  });

  it("q = WeChat ID treats % and _ literally (no LIKE wildcards)", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    const a = await createOrder({ date: "2026-10-24", wechatId: "aliceXwx", items: [{ productId: p.redBean, qty: 1 }] });
    const b = await createOrder({ date: "2026-10-24", wechatId: "alice_wx", items: [{ productId: p.redBean, qty: 1 }] });
    await log({ at: "2026-10-20T15:00:00Z", entityType: "Order", entityId: a.id, action: "order.create" });
    await log({ at: "2026-10-21T15:00:00Z", entityType: "Order", entityId: b.id, action: "order.create" });

    expect((await get("?q=alice_wx")).json.items.map((i) => i.entityId)).toEqual([b.id]);
    expect((await get("?q=%25")).json.items).toEqual([]);
  });

  it("entityId filters one entity, and an empty query string means no filter", async () => {
    await log({ at: "2026-10-20T15:00:00Z", entityId: "abc" });
    await log({ at: "2026-10-21T15:00:00Z", entityId: "1" });
    expect((await get("?entityId=abc")).json.items).toHaveLength(1);
    expect((await get("?q=&entityId=&from=&to=&cursor=")).json.items).toHaveLength(2);
  });

  it("rejects a bad date and a bad cursor with 422", async () => {
    expect((await get("?from=2026-13-01")).status).toBe(422);
    expect((await get("?to=tomorrow")).status).toBe(422);
    expect((await get("?cursor=garbage")).status).toBe(422);
  });
});

describe("product names for readable rows", () => {
  it("returns names of products named by id in limits, violations, reorders and as the entity", async () => {
    const p = await createDefaultProducts();
    await db.auditLog.create({
      data: {
        at: new Date("2026-10-20T15:00:00Z"),
        actor: "ADMIN",
        action: "date.update",
        entityType: "OpenDate",
        entityId: "2026-10-30",
        before: { productLimits: {} },
        after: { productLimits: { [p.brulee]: 12 } },
      },
    });
    await db.auditLog.create({
      data: {
        at: new Date("2026-10-21T15:00:00Z"),
        actor: "ADMIN",
        action: "product.update",
        entityType: "Product",
        entityId: p.cheeseHorn,
      },
    });
    await db.auditLog.create({
      data: {
        at: new Date("2026-10-22T15:00:00Z"),
        actor: "ADMIN",
        action: "order.override",
        entityType: "Order",
        entityId: "not-a-uuid",
        after: { violations: [{ kind: "PRODUCT", date: "2026-10-30", productId: p.redBean, after: 9, limit: 8, over: 1 }] },
      },
    });
    await db.auditLog.create({
      data: {
        at: new Date("2026-10-23T15:00:00Z"),
        actor: "ADMIN",
        action: "product.reorder",
        entityType: "Product",
        entityId: "all",
        before: [{ id: p.rockCheese, sortOrder: 1 }],
        after: [{ id: p.rockCheese, sortOrder: 1 }],
      },
    });
    const { json } = await get();
    const names = (json as unknown as { productNames: Record<string, string> }).productNames;
    expect(Object.keys(names).sort()).toEqual([p.brulee, p.cheeseHorn, p.redBean, p.rockCheese].sort());
    expect(names[p.brulee]).toBe("焦糖布蕾");
    expect(names[p.cheeseHorn]).toBe("奶酪角");
  });
});

describe("Chicago date bounds", () => {
  it("converts from/to to UTC with the right offset on either side of DST", () => {
    // Fall back on 2026-11-01: 11/1 00:00 is CDT (UTC-5), 11/2 00:00 is CST (UTC-6).
    expect(dateBounds("2026-11-01", "2026-11-01")).toEqual({
      gte: new Date("2026-11-01T05:00:00Z"),
      lt: new Date("2026-11-02T06:00:00Z"),
    });
    // Spring forward on 2027-03-14: that day is 23 hours long.
    expect(dateBounds("2027-03-14", "2027-03-14")).toEqual({
      gte: new Date("2027-03-14T06:00:00Z"),
      lt: new Date("2027-03-15T05:00:00Z"),
    });
    expect(dateBounds()).toEqual({});
  });

  it("includes the whole Chicago day, excludes the instants just outside", async () => {
    // 11/1 Chicago day = 2026-11-01T05:00Z .. 2026-11-02T06:00Z (25 hours)
    await log({ at: "2026-11-01T04:59:59.999Z", action: "admin.login" }); // 10/31 23:59:59.999
    await log({ at: "2026-11-01T05:00:00.000Z", action: "settings.update" }); // 11/1 00:00
    await log({ at: "2026-11-02T05:59:59.999Z", action: "date.update" }); // 11/1 23:59:59.999 CST
    await log({ at: "2026-11-02T06:00:00.000Z", action: "product.update" }); // 11/2 00:00
    const { json } = await get("?from=2026-11-01&to=2026-11-01");
    expect(json.items.map((i) => i.action)).toEqual(["date.update", "settings.update"]);
    // Only `from` / only `to`.
    expect((await get("?from=2026-11-02")).json.items.map((i) => i.action)).toEqual(["product.update"]);
    expect((await get("?to=2026-10-31")).json.items.map((i) => i.action)).toEqual(["admin.login"]);
  });
});

describe("cursor pagination", () => {
  it("pages 50 at a time, newest first, without gaps or repeats, even with equal timestamps", async () => {
    // 120 rows; blocks of 7 share one timestamp so the id tiebreak is what keeps pages stable.
    const base = Date.UTC(2026, 9, 1, 12, 0, 0);
    await db.auditLog.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        at: new Date(base + Math.floor(i / 7) * 1000),
        actor: "ADMIN" as const,
        action: "settings.update",
        entityType: "Setting",
        entityId: String(i),
      })),
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const { json } = await get(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
      sizes.push(json.items.length);
      seen.push(...json.items.map((i) => i.id));
      cursor = json.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    const all = await db.auditLog.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }] });
    expect(seen).toEqual(all.map((r) => r.id));
  });

  it("has no next cursor when exactly one full page exists", async () => {
    await db.auditLog.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        at: new Date(Date.UTC(2026, 9, 1, 12, 0, i)),
        actor: "ADMIN" as const,
        action: "x",
        entityType: "Setting",
        entityId: String(i),
      })),
    });
    const { json } = await get();
    expect(json.items).toHaveLength(50);
    expect(json.nextCursor).toBeNull();
  });
});
