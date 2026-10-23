// /api/admin/ledger/**: auth + origin, month and day numbers from real rows, manual entry
// create / edit / delete with AuditLog.

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

import { GET as monthGET } from "@/app/api/admin/ledger/route";
import { GET as dayGET } from "@/app/api/admin/ledger/day/route";
import { POST as manualPOST } from "@/app/api/admin/ledger/manual/route";
import {
  DELETE as manualDELETE,
  PATCH as manualPATCH,
} from "@/app/api/admin/ledger/manual/[id]/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
let previousSiteUrl: string | undefined;

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : headers) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const month = (m: string) => monthGET(req("GET", `/api/admin/ledger?month=${m}`));
const day = (d: string) => dayGET(req("GET", `/api/admin/ledger/day?date=${d}`));
const post = (body: unknown, headers?: Record<string, string>) =>
  manualPOST(req("POST", "/api/admin/ledger/manual", body, headers));
const patch = (id: string, body: unknown, headers?: Record<string, string>) =>
  manualPATCH(req("PATCH", `/api/admin/ledger/manual/${id}`, body, headers), {
    params: Promise.resolve({ id }),
  });
const del = (id: string, headers?: Record<string, string>) =>
  manualDELETE(req("DELETE", `/api/admin/ledger/manual/${id}`, undefined, headers), {
    params: Promise.resolve({ id }),
  });

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  cookieToken = (await createSession(db, user.id, new Date())).token;
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

const VALID = { date: "2026-11-07", amountCents: 1500, note: "walk-in", paidMethod: "CASH" };

describe("auth and origin", () => {
  it("answers 401 on every route without a session", async () => {
    cookieToken = undefined;
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await month("2026-11")).status).toBe(401);
    expect((await day("2026-11-07")).status).toBe(401);
    expect((await post(VALID)).status).toBe(401);
    expect((await patch(id, VALID)).status).toBe(401);
    expect((await del(id)).status).toBe(401);
    expect(await db.manualIncome.count()).toBe(0);
  });

  it("rejects writes with a foreign or missing Origin before touching anything", async () => {
    const created = await (await post(VALID)).json();
    const id = created.entry.id as string;
    for (const headers of [{ origin: "https://evil.example" }, {} as Record<string, string>]) {
      expect((await post(VALID, headers)).status).toBe(403);
      expect((await patch(id, { ...VALID, amountCents: 1 }, headers)).status).toBe(403);
      expect((await del(id, headers)).status).toBe(403);
    }
    expect(await db.manualIncome.count()).toBe(1);
    expect((await db.manualIncome.findUniqueOrThrow({ where: { id } })).amountCents).toBe(1500);
    expect(await db.auditLog.count()).toBe(1); // only the create
  });
});

describe("month and day from real rows", () => {
  it("computes paid / unpaid / cancelled orders, a bundle per order, and manual entries", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-11-07");
    await createOpenDate("2026-11-08");
    // Cheese horn bundle price from the seed: two customers buying 2 each.
    const a = await createOrder({ date: "2026-11-07", items: [{ productId: p.cheeseHorn, qty: 2 }] });
    const b = await createOrder({ date: "2026-11-07", items: [{ productId: p.cheeseHorn, qty: 2 }] });
    const c = await createOrder({ date: "2026-11-07", items: [{ productId: p.redBean, qty: 1 }] });
    const d = await createOrder({ date: "2026-11-07", items: [{ productId: p.redBean, qty: 1 }], status: "CANCELLED" });
    const e = await createOrder({ date: "2026-11-08", items: [{ productId: p.redBean, qty: 1 }] });
    await db.order.update({ where: { id: a.id }, data: { paid: true, paidMethod: "WECHAT" } });
    await db.order.update({ where: { id: b.id }, data: { paid: true, paidMethod: "ZELLE" } });
    await db.order.update({ where: { id: d.id }, data: { paid: true, paidMethod: "CASH" } });

    const created = await (await post({ ...VALID, amountCents: 700 })).json();
    expect(created.entry.items).toEqual([]);

    const dayJson = await (await day("2026-11-07")).json();
    expect(dayJson.revenueCents).toBe(a.totalCents + b.totalCents + 700);
    expect(dayJson.receivableCents).toBe(c.totalCents);
    expect(dayJson.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual([a.orderNo, b.orderNo, c.orderNo]);
    const horn = dayJson.products.find((x: { productId: string }) => x.productId === p.cheeseHorn);
    expect(horn.qty).toBe(4);
    expect(horn.amountCents).toBe(a.items[0].lineTotalCents + b.items[0].lineTotalCents);
    expect(dayJson.manual).toHaveLength(1);

    const monthJson = await (await month("2026-11")).json();
    expect(monthJson.revenueCents).toBe(dayJson.revenueCents);
    expect(monthJson.receivableCents).toBe(c.totalCents + e.totalCents);
    expect(monthJson.days.map((x: { date: string }) => x.date)).toEqual(["2026-11-07", "2026-11-08"]);
    expect((await (await month("2026-10")).json()).days).toEqual([]);
  });

  it("rejects malformed month and date queries", async () => {
    expect((await month("2026-13")).status).toBe(422);
    expect((await month("nope")).status).toBe(422);
    expect((await monthGET(req("GET", "/api/admin/ledger"))).status).toBe(422);
    expect((await day("2026-02-30")).status).toBe(422);
  });
});

describe("manual entries", () => {
  it("creates an entry with items and writes an audit row", async () => {
    const p = await createDefaultProducts();
    const res = await post({
      ...VALID,
      items: [{ productId: p.redBean, qty: 3 }, { name: "Custom cake", qty: 1 }],
    });
    expect(res.status).toBe(201);
    const { entry } = await res.json();
    expect(entry.items.map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual(
      expect.arrayContaining([["Custom cake", 1]]),
    );
    expect(entry.items).toHaveLength(2);
    const rows = await db.manualIncomeItem.findMany({ where: { incomeId: entry.id } });
    expect(rows.find((r) => r.productId === p.redBean)?.nameSnapshot).toBeTruthy();

    const logs = await db.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actor: "ADMIN",
      action: "manual_income.create",
      entityType: "manual_income",
      entityId: entry.id,
      before: null,
    });
    expect(logs[0].after).toMatchObject({ date: "2026-11-07", amountCents: 1500, note: "walk-in", paidMethod: "CASH" });
  });

  it("updates fields and replaces items, auditing old and new values", async () => {
    const p = await createDefaultProducts();
    const { entry } = await (await post({ ...VALID, items: [{ productId: p.redBean, qty: 3 }] })).json();
    const res = await patch(entry.id, {
      date: "2026-11-09",
      amountCents: 2000,
      note: "changed",
      paidMethod: "ZELLE",
      items: [{ productId: p.brulee, qty: 2 }],
    });
    expect(res.status).toBe(200);
    const row = await db.manualIncome.findUniqueOrThrow({ where: { id: entry.id }, include: { items: true } });
    expect(row).toMatchObject({ amountCents: 2000, note: "changed", paidMethod: "ZELLE" });
    expect(row.items.map((i) => [i.productId, i.qty])).toEqual([[p.brulee, 2]]);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "manual_income.update" } });
    expect(log.entityId).toBe(entry.id);
    expect(log.before).toMatchObject({ date: "2026-11-07", amountCents: 1500, note: "walk-in", paidMethod: "CASH" });
    expect(log.after).toMatchObject({ date: "2026-11-09", amountCents: 2000, note: "changed", paidMethod: "ZELLE" });
    expect((log.before as { items: unknown[] }).items).toHaveLength(1);
  });

  it("deletes with its items and audits the old values", async () => {
    const p = await createDefaultProducts();
    const { entry } = await (await post({ ...VALID, items: [{ productId: p.redBean, qty: 3 }] })).json();
    expect((await del(entry.id)).status).toBe(200);
    expect(await db.manualIncome.count()).toBe(0);
    expect(await db.manualIncomeItem.count()).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "manual_income.delete" } });
    expect(log).toMatchObject({ entityType: "manual_income", entityId: entry.id, after: null });
    expect(log.before).toMatchObject({ amountCents: 1500 });
    expect((await del(entry.id)).status).toBe(404);
    expect((await db.auditLog.findMany({ where: { action: "manual_income.delete" } })).length).toBe(1);
  });

  it("answers 404 for unknown or malformed ids", async () => {
    expect((await patch("00000000-0000-4000-8000-000000000000", VALID)).status).toBe(404);
    expect((await patch("not-a-uuid", VALID)).status).toBe(404);
    expect((await del("not-a-uuid")).status).toBe(404);
  });

  it("sets the item's product to null when the product row is deleted, keeping the name", async () => {
    const p = await createDefaultProducts();
    const { entry } = await (await post({ ...VALID, items: [{ productId: p.brulee, qty: 1 }] })).json();
    await db.product.delete({ where: { id: p.brulee } });
    const items = await db.manualIncomeItem.findMany({ where: { incomeId: entry.id } });
    expect(items[0].productId).toBeNull();
    expect(items[0].nameSnapshot).toBeTruthy();
  });

  it("validates input and writes nothing on failure", async () => {
    const bad: unknown[] = [
      { ...VALID, amountCents: 0 },
      { ...VALID, amountCents: -5 },
      { ...VALID, amountCents: 1.5 },
      { ...VALID, note: "" },
      { ...VALID, note: "   " },
      { ...VALID, note: "x".repeat(101) },
      { ...VALID, paidMethod: "BITCOIN" },
      { ...VALID, date: "2026-02-30" },
      { ...VALID, date: "11/07" },
      { ...VALID, items: [{ name: "x", qty: 0 }] },
      { ...VALID, items: [{ name: "x", qty: 1000 }] },
      { ...VALID, items: [{ qty: 1 }] },
      { ...VALID, items: [{ productId: "00000000-0000-4000-8000-000000000000", qty: 1 }] },
      { ...VALID, items: [{ productId: "nope", qty: 1 }] },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await post("not an object")).status).toBe(422);
    expect(await db.manualIncome.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("accepts boundary values: 1 cent, 100-char note, qty 1 and 999", async () => {
    const res = await post({
      ...VALID,
      amountCents: 1,
      note: "宝".repeat(100),
      items: [{ name: "a", qty: 1 }, { name: "b", qty: 999 }],
    });
    expect(res.status).toBe(201);
  });

  it("an update that fails validation leaves the entry and the log untouched", async () => {
    const { entry } = await (await post(VALID)).json();
    expect((await patch(entry.id, { ...VALID, amountCents: 0 })).status).toBe(422);
    expect((await db.manualIncome.findUniqueOrThrow({ where: { id: entry.id } })).amountCents).toBe(1500);
    expect(await db.auditLog.count()).toBe(1);
  });
});
