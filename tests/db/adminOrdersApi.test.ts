// /api/admin/orders/** route handlers called directly.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET as listGET, POST as createPOST } from "@/app/api/admin/orders/route";
import { GET as detailGET, PATCH as detailPATCH } from "@/app/api/admin/orders/[id]/route";
import { POST as statusPOST } from "@/app/api/admin/orders/[id]/status/route";
import { POST as correctPOST } from "@/app/api/admin/orders/[id]/correct-status/route";
import { POST as paymentPOST } from "@/app/api/admin/orders/[id]/payment/route";
import { addDays, localDateOf } from "@/domain/dates";
import { createSession, hashPassword } from "@/server/auth";
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

const SITE = "https://bunbunnybakes.shop";
const TODAY = localDateOf(new Date());
const D1 = addDays(TODAY, 1);
const D2 = addDays(TODAY, 2);
const D3 = addDays(TODAY, 3);
let P: DefaultProductIds;
let prevSite: string | undefined;

beforeAll(() => {
  prevSite = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});
afterAll(async () => {
  if (prevSite === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = prevSite;
  await db.$disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  cookieToken = (await createSession(db, user.id, new Date())).token;
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  for (const d of [TODAY, D1, D2, D3]) await createOpenDate(d);
});

const url = (path: string) => SITE + path;
const get = (path: string) => new Request(url(path));
const write = (method: string, path: string, body: unknown, origin: string | null = SITE) =>
  new Request(url(path), {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function list(query = "") {
  const res = await listGET(get("/api/admin/orders" + query));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    orders: {
      id: string;
      orderNo: string;
      itemsSummary: string;
      nextStatuses: { to: string }[];
    }[];
    nextCursor: string | null;
  };
}

describe("GET /api/admin/orders", () => {
  it("date=all includes all history and pages by pickup date DESC, seq DESC", async () => {
    const past = "2019-01-01";
    await createOpenDate(past);
    const expected: string[] = [];
    for (const [date, count] of [[past, 4], [D1, 52], [D2, 48]] as const) {
      for (let i = 0; i < count; i++) {
        const o = await createOrder({ date, items: [{ productId: P.redBean, qty: 1 }] });
        expected.unshift(o.id);
      }
    }
    const actual: string[] = [];
    let cursor: string | null = null;
    for (const count of [50, 50, 4]) {
      const page = await list(`?date=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(page.orders).toHaveLength(count);
      actual.push(...page.orders.map((o) => o.id));
      cursor = page.nextCursor;
      if (count === 50) expect(cursor).toBeTruthy();
    }
    expect(cursor).toBeNull();
    expect(actual).toEqual(expected);
    expect((await list(`?date=all&status=COMPLETED`)).orders).toEqual([]);
    expect((await list(`?date=all&productId=${P.redBean}&paid=false&q=wx_`)).orders.map((o) => o.id)).toEqual(expected.slice(0, 50));
  });

  it("defaults to today and later, sorted by date then seq, skipping the past", async () => {
    const past = addDays(TODAY, -1);
    await createOpenDate(past);
    await createOrder({ date: past, items: [{ productId: P.redBean, qty: 1 }], wechatId: "old" });
    const b = await createOrder({ date: D2, items: [{ productId: P.redBean, qty: 1 }], wechatId: "b" });
    const a1 = await createOrder({
      date: D1,
      items: [
        { productId: P.redBean, qty: 4 },
        { productId: P.cheeseHorn, qty: 4 },
      ],
      wechatId: "a1",
    });
    const a2 = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "a2" });
    const r = await list();
    expect(r.orders.map((o) => o.id)).toEqual([a1.id, a2.id, b.id]);
    expect(r.orders[0].itemsSummary).toBe("奶酥红豆包×4、奶酪角×4");
    expect(r.orders[0].nextStatuses.map((n) => n.to)).toContain("CONTACTED");
  });

  it("filters by date, from/to, status (repeatable), fulfillment, paid, productId", async () => {
    const x = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], status: "NEW" });
    const y = await createOrder({
      date: D2,
      items: [{ productId: P.cheeseHorn, qty: 1 }],
      status: "CONTACTED",
      fulfillment: "DELIVERY",
    });
    const z = await createOrder({ date: D3, items: [{ productId: P.redBean, qty: 1 }], status: "COMPLETED" });
    await db.order.update({ where: { id: z.id }, data: { paid: true } });
    const ids = async (q: string) => (await list(q)).orders.map((o) => o.id);
    expect(await ids(`?date=${D2}`)).toEqual([y.id]);
    expect(await ids(`?from=${D2}&to=${D3}`)).toEqual([y.id, z.id]);
    expect(await ids(`?to=${D1}`)).toEqual([x.id]);
    expect(await ids(`?status=NEW&status=CONTACTED`)).toEqual([x.id, y.id]);
    expect(await ids(`?status=COMPLETED`)).toEqual([z.id]);
    expect(await ids(`?fulfillment=DELIVERY`)).toEqual([y.id]);
    expect(await ids(`?paid=true`)).toEqual([z.id]);
    expect(await ids(`?paid=false`)).toEqual([x.id, y.id]);
    expect(await ids(`?productId=${P.cheeseHorn}`)).toEqual([y.id]);
  });

  it("searches order no. and WeChat ID, case-insensitively", async () => {
    const a = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "Alice_Wx" });
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "bob" });
    expect((await list("?q=alice")).orders.map((o) => o.id)).toEqual([a.id]);
    expect((await list(`?q=${encodeURIComponent(a.orderNo)}`)).orders.map((o) => o.id)).toEqual([a.id]);
    expect((await list("?q=zzz")).orders).toEqual([]);
  });

  it("treats % and _ in the search as plain characters, not LIKE wildcards", async () => {
    const plain = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "alice" });
    const under = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "a_ice" });
    const pct = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }], wechatId: "100%wx" });
    const ids = async (q: string) => (await list(`?q=${encodeURIComponent(q)}`)).orders.map((o) => o.id);
    // A bare wildcard matches only the rows that really contain it.
    expect(await ids("%")).toEqual([pct.id]);
    expect(await ids("_")).toEqual([under.id]);
    expect(await ids("a_ice")).toEqual([under.id]);
    expect(await ids("a%e")).toEqual([]);
    expect(await ids("100%")).toEqual([pct.id]);
    // The backslash escape character itself is literal too.
    expect(await ids("\\")).toEqual([]);
    expect(await ids("alice")).toEqual([plain.id]);
  });

  it("pages 50 at a time with a cursor", async () => {
    for (let i = 0; i < 52; i++) {
      await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 1 }] });
    }
    const first = await list();
    expect(first.orders).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await list("?cursor=" + encodeURIComponent(first.nextCursor!));
    expect(second.orders).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.orders, ...second.orders].map((o) => o.id)).size).toBe(52);
  });

  it("rejects bad filters with VALIDATION", async () => {
    expect((await listGET(get("/api/admin/orders?status=NOPE"))).status).toBe(422);
  });
});

describe("GET /api/admin/orders/{id}", () => {
  it("returns the full order, viewUrl, nextStatuses and logs newest first", async () => {
    const o = await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 2 }] });
    const stamp = o.updatedAt.toISOString();
    const s = await statusPOST(write("POST", "/x", { to: "CONTACTED", expectedUpdatedAt: stamp }), ctx(o.id));
    expect(s.status).toBe(200);
    const res = await detailGET(get("/x"), ctx(o.id));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({
      id: o.id,
      orderNo: o.orderNo,
      status: "CONTACTED",
      source: "WEB",
      viewUrl: `${SITE}/o/${o.viewToken}`,
      items: [{ name: "奶酥红豆包", qty: 2 }],
    });
    expect(d.cutoffAt).toBeTruthy();
    expect(d.nextStatuses.map((n: { to: string }) => n.to)).toEqual([
      "CONFIRMED",
      "BAKING",
      "READY",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ]);
    expect(d.nextStatuses.at(-1)).toEqual({ to: "CANCELLED", reasonRequired: true });
    expect(d.logs[0]).toMatchObject({
      action: "order.status",
      actor: "ADMIN",
      before: { status: "NEW" },
      after: { status: "CONTACTED" },
    });
  });

  it("404s for unknown and malformed ids", async () => {
    expect((await detailGET(get("/x"), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    expect((await detailGET(get("/x"), ctx("nope"))).status).toBe(404);
  });
});

describe("order writes", () => {
  async function fresh(status: "NEW" | "CANCELLED" = "NEW", qty = 2) {
    const o = await createOrder({ date: D1, items: [{ productId: P.redBean, qty }], status });
    return { id: o.id, stamp: o.updatedAt.toISOString() };
  }

  it("status: happy path, STALE 409, reason missing 422", async () => {
    const o = await fresh();
    const bad = await statusPOST(write("POST", "/x", { to: "CANCELLED", expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(bad.status).toBe(422);
    const ok = await statusPOST(
      write("POST", "/x", { to: "CANCELLED", reason: "sold out", expectedUpdatedAt: o.stamp }),
      ctx(o.id),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "CANCELLED" });
    const stale = await statusPOST(write("POST", "/x", { to: "CONTACTED", expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "STALE" });
  });

  it("correct-status: happy path, reason missing 422, OVER_LIMIT with violations then override", async () => {
    await createOrder({
      date: D1,
      items: [
        { productId: P.redBean, qty: 20 },
        { productId: P.rockCheese, qty: 2 },
      ],
    });
    const o = await fresh("CANCELLED", 2);
    const noReason = await correctPOST(write("POST", "/x", { to: "NEW", expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(noReason.status).toBe(422);
    const over = await correctPOST(
      write("POST", "/x", { to: "NEW", reason: "oops", expectedUpdatedAt: o.stamp }),
      ctx(o.id),
    );
    expect(over.status).toBe(409);
    const body = await over.json();
    expect(body.error).toBe("OVER_LIMIT");
    expect(body.violations.length).toBeGreaterThan(0);
    const forced = await correctPOST(
      write("POST", "/x", { to: "NEW", reason: "oops", override: true, expectedUpdatedAt: o.stamp }),
      ctx(o.id),
    );
    expect(forced.status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: o.id, action: "order.override" } })).toBe(1);
  });

  it("correct-status: backwards happy path", async () => {
    const p = await fresh("NEW");
    const ok = await correctPOST(
      write("POST", "/x", { to: "CANCELLED", reason: "fix", expectedUpdatedAt: p.stamp }),
      ctx(p.id),
    );
    expect(ok.status).toBe(200);
  });

  it("payment: happy path and STALE", async () => {
    const o = await fresh();
    const ok = await paymentPOST(
      write("POST", "/x", { paid: true, method: "ZELLE", expectedUpdatedAt: o.stamp }),
      ctx(o.id),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ paid: true, paidMethod: "ZELLE" });
    const stale = await paymentPOST(write("POST", "/x", { paid: false, expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(stale.status).toBe(409);
  });

  it("PATCH: happy path, STALE, nothing to change 422, OVER_LIMIT", async () => {
    const o = await fresh();
    const ok = await detailPATCH(write("PATCH", "/x", { wechatId: "new_wx", expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(ok.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).wechatId).toBe("new_wx");
    const stale = await detailPATCH(write("PATCH", "/x", { wechatId: "again", expectedUpdatedAt: o.stamp }), ctx(o.id));
    expect(stale.status).toBe(409);
    const cur = (await db.order.findUniqueOrThrow({ where: { id: o.id } })).updatedAt.toISOString();
    const nothing = await detailPATCH(write("PATCH", "/x", { expectedUpdatedAt: cur }), ctx(o.id));
    expect(nothing.status).toBe(422);
    const over = await detailPATCH(
      write("PATCH", "/x", { items: [{ productId: P.redBean, qty: 100 }], expectedUpdatedAt: cur }),
      ctx(o.id),
    );
    expect(over.status).toBe(409);
    expect((await over.json()).error).toBe("OVER_LIMIT");
  });

  it("PATCH: a different orderId in the body cannot redirect the edit", async () => {
    const a = await fresh();
    const b = await fresh();
    const res = await detailPATCH(
      write("PATCH", "/x", { orderId: b.id, wechatId: "only_a", expectedUpdatedAt: a.stamp }),
      ctx(a.id),
    );
    expect(res.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: a.id } })).wechatId).toBe("only_a");
    expect((await db.order.findUniqueOrThrow({ where: { id: b.id } })).wechatId).not.toBe("only_a");
  });

  it("POST create: 201 with id, orderNo, viewUrl; OVER_LIMIT; VALIDATION", async () => {
    const res = await createPOST(
      write("POST", "/x", {
        items: [{ productId: P.redBean, qty: 2 }],
        pickupDate: D1,
        fulfillment: "PICKUP",
        wechatId: "phone",
      }),
    );
    expect(res.status).toBe(201);
    const b = await res.json();
    const row = await db.order.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(b.orderNo).toBe(row.orderNo);
    expect(b.viewUrl).toBe(`${SITE}/o/${row.viewToken}`);
    const over = await createPOST(
      write("POST", "/x", {
        items: [{ productId: P.redBean, qty: 99 }],
        pickupDate: D1,
        fulfillment: "PICKUP",
        wechatId: "p2",
      }),
    );
    expect(over.status).toBe(409);
    expect((await over.json()).violations).toBeDefined();
    expect((await createPOST(write("POST", "/x", { pickupDate: D1 }))).status).toBe(422);
  });
});

describe("auth", () => {
  const id = "00000000-0000-4000-8000-000000000000";
  const calls: [string, () => Promise<Response>][] = [
    ["list", () => listGET(get("/x"))],
    ["detail", () => detailGET(get("/x"), ctx(id))],
    ["create", () => createPOST(write("POST", "/x", {}))],
    ["patch", () => detailPATCH(write("PATCH", "/x", {}), ctx(id))],
    ["status", () => statusPOST(write("POST", "/x", {}), ctx(id))],
    ["correct", () => correctPOST(write("POST", "/x", {}), ctx(id))],
    ["payment", () => paymentPOST(write("POST", "/x", {}), ctx(id))],
  ];
  it.each(calls)("%s rejects a request without a cookie (401)", async (_n, call) => {
    cookieToken = undefined;
    expect((await call()).status).toBe(401);
  });

  const writes: [string, (origin: string | null) => Promise<Response>][] = [
    ["create", (o) => createPOST(write("POST", "/x", {}, o))],
    ["patch", (o) => detailPATCH(write("PATCH", "/x", {}, o), ctx(id))],
    ["status", (o) => statusPOST(write("POST", "/x", {}, o), ctx(id))],
    ["correct", (o) => correctPOST(write("POST", "/x", {}, o), ctx(id))],
    ["payment", (o) => paymentPOST(write("POST", "/x", {}, o), ctx(id))],
  ];
  it.each(writes)("%s rejects a bad Origin (403)", async (_n, call) => {
    expect((await call("https://evil.example")).status).toBe(403);
    expect((await call(null)).status).toBe(403);
  });
});
