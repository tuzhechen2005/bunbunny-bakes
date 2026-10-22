// /api/admin/products routes: auth, validation (mode <-> fields), merge validation,
// defaults, reorder and audit rows. Real Postgres.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a Next.js request scope; cookies() is replaced by a per-test token.
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

import { PATCH } from "@/app/api/admin/products/[id]/route";
import { POST as REORDER } from "@/app/api/admin/products/reorder/route";
import { GET, POST } from "@/app/api/admin/products/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { createDefaultProducts, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.com";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
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

function request(method: string, body?: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(`${SITE}/api/admin/products`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const patchCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const unitBody = {
  name: "  肉桂卷  ",
  unitPriceCents: 350,
  capacityMode: "DOUGH_PER_UNIT",
  doughG: 90,
};

describe("auth", () => {
  it("answers 401 without a valid session on every route", async () => {
    cookieToken = undefined;
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", unitBody))).status).toBe(401);
    expect((await PATCH(request("PATCH", { name: "x" }), patchCtx(P.redBean))).status).toBe(401);
    expect((await REORDER(request("POST", { ids: [P.redBean] }))).status).toBe(401);
    expect(await db.product.count()).toBe(4);
  });

  it("answers 403 on writes with a foreign or missing Origin, before touching data", async () => {
    for (const headers of [{} as Record<string, string>, { origin: "https://evil.example" }]) {
      expect((await POST(request("POST", unitBody, headers))).status).toBe(403);
      expect((await PATCH(request("PATCH", { name: "x" }, headers), patchCtx(P.redBean))).status).toBe(403);
      expect((await REORDER(request("POST", { ids: [P.redBean] }, headers))).status).toBe(403);
    }
    expect(await db.product.count()).toBe(4);
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("GET", () => {
  it("lists every product incl. PAUSED/ARCHIVED, ordered by sortOrder then name, with all fields", async () => {
    await db.product.update({ where: { id: P.brulee }, data: { status: "ARCHIVED" } });
    await db.product.update({ where: { id: P.cheeseHorn }, data: { status: "PAUSED" } });
    await db.product.create({
      data: { name: "A同序", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 1, sortOrder: 1 },
    });
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const { products } = await res.json();
    expect(products.map((p: { name: string }) => p.name)).toEqual([
      "A同序",
      "奶酥红豆包",
      "岩烧乳酪包",
      "奶酪角",
      "焦糖布蕾",
    ]);
    expect(products[4]).toMatchObject({ status: "ARCHIVED", batchYield: 3, dailyLimit: 24, imageUrl: null });
    expect(Object.keys(products[0])).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "description",
        "unitPriceCents",
        "bundleSize",
        "capacityMode",
        "leadDays",
        "sortOrder",
        "createdAt",
      ]),
    );
  });
});

describe("POST", () => {
  it("creates a DOUGH_PER_UNIT product with defaults, trimmed name, sortOrder = max+1 and an audit row", async () => {
    const res = await POST(request("POST", unitBody));
    expect(res.status).toBe(201);
    const { product } = await res.json();
    expect(product).toMatchObject({
      name: "肉桂卷",
      description: "",
      unitPriceCents: 350,
      bundleSize: 4,
      bundlePriceCents: null,
      capacityMode: "DOUGH_PER_UNIT",
      doughG: 90,
      roundG: null,
      piecesPerRound: null,
      dailyLimit: null,
      batchYield: null,
      leadDays: 1,
      status: "ACTIVE",
      sortOrder: 5,
    });
    const audit = await db.auditLog.findMany({ where: { entityId: product.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "ADMIN", action: "product.create", entityType: "Product" });
    expect(audit[0].after).toMatchObject({ name: "肉桂卷", doughG: 90 });
  });

  it("creates a DOUGH_PER_ROUND product and an INDEPENDENT product", async () => {
    const round = await POST(
      request("POST", {
        name: "大圆包",
        unitPriceCents: 300,
        capacityMode: "DOUGH_PER_ROUND",
        roundG: 400,
        piecesPerRound: 5,
        bundlePriceCents: 1000,
        bundleSize: 4,
      }),
    );
    expect(round.status).toBe(201);
    expect((await round.json()).product).toMatchObject({
      roundG: 400,
      piecesPerRound: 5,
      doughG: null,
      bundlePriceCents: 1000,
    });

    const solo = await POST(
      request("POST", {
        name: "布丁",
        unitPriceCents: 200,
        capacityMode: "INDEPENDENT",
        dailyLimit: 0,
        leadDays: 2,
        batchYield: 3,
      }),
    );
    expect(solo.status).toBe(201);
    expect((await solo.json()).product).toMatchObject({ dailyLimit: 0, leadDays: 2, batchYield: 3, doughG: null });
  });

  it("stores fields the mode does not use as null", async () => {
    const res = await POST(request("POST", { ...unitBody, roundG: 300, piecesPerRound: 3, dailyLimit: 9 }));
    expect(res.status).toBe(201);
    expect((await res.json()).product).toMatchObject({
      doughG: 90,
      roundG: null,
      piecesPerRound: null,
      dailyLimit: null,
    });
  });

  it.each([
    ["DOUGH_PER_UNIT without doughG", { capacityMode: "DOUGH_PER_UNIT" }, "doughG"],
    ["DOUGH_PER_UNIT with doughG 0", { capacityMode: "DOUGH_PER_UNIT", doughG: 0 }, "doughG"],
    ["DOUGH_PER_ROUND without roundG", { capacityMode: "DOUGH_PER_ROUND", piecesPerRound: 4 }, "roundG"],
    ["DOUGH_PER_ROUND without piecesPerRound", { capacityMode: "DOUGH_PER_ROUND", roundG: 300 }, "piecesPerRound"],
    [
      "DOUGH_PER_ROUND with piecesPerRound 0",
      { capacityMode: "DOUGH_PER_ROUND", roundG: 300, piecesPerRound: 0 },
      "piecesPerRound",
    ],
    ["INDEPENDENT without dailyLimit", { capacityMode: "INDEPENDENT" }, "dailyLimit"],
    ["INDEPENDENT with negative dailyLimit", { capacityMode: "INDEPENDENT", dailyLimit: -1 }, "dailyLimit"],
    ["unknown mode", { capacityMode: "MAGIC", doughG: 5 }, "capacityMode"],
    ["empty name", { name: "   ", capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "name"],
    ["name over 30 chars", { name: "一".repeat(31), capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "name"],
    [
      "description over 200 chars",
      { description: "字".repeat(201), capacityMode: "DOUGH_PER_UNIT", doughG: 5 },
      "description",
    ],
    ["negative price", { unitPriceCents: -1, capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "unitPriceCents"],
    ["fractional price", { unitPriceCents: 2.5, capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "unitPriceCents"],
    ["bundleSize 0", { bundleSize: 0, capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "bundleSize"],
    [
      "negative bundle price",
      { bundlePriceCents: -5, capacityMode: "DOUGH_PER_UNIT", doughG: 5 },
      "bundlePriceCents",
    ],
    ["leadDays 8", { leadDays: 8, capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "leadDays"],
    ["batchYield 0", { batchYield: 0, capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "batchYield"],
    ["bad status", { status: "GONE", capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "status"],
    ["price as string", { unitPriceCents: "2.49", capacityMode: "DOUGH_PER_UNIT", doughG: 5 }, "unitPriceCents"],
  ])("rejects %s with 422 VALIDATION (never a DB 500)", async (_label, over, field) => {
    const res = await POST(request("POST", { name: "X", unitPriceCents: 100, ...over }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION");
    expect(Object.keys(json.fields)).toContain(field);
    expect(await db.product.count()).toBe(4);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("rejects a non-JSON body with 422", async () => {
    const res = await POST(
      new Request(`${SITE}/api/admin/products`, { method: "POST", headers: { origin: SITE }, body: "nope" }),
    );
    expect(res.status).toBe(422);
  });
});

describe("PATCH", () => {
  it("updates fields, writes before/after audit, and returns no overLimitDates for a price change", async () => {
    const res = await PATCH(
      request("PATCH", { unitPriceCents: 259, description: "  新口味  " }),
      patchCtx(P.redBean),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.product).toMatchObject({ unitPriceCents: 259, description: "新口味" });
    expect(json.overLimitDates).toEqual([]);
    const audit = await db.auditLog.findMany({ where: { entityId: P.redBean, action: "product.update" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "ADMIN",
      before: expect.objectContaining({ unitPriceCents: 249 }),
      after: expect.objectContaining({ unitPriceCents: 259 }),
    });
  });

  it("validates the merged result: switching mode requires the new mode's fields", async () => {
    const bad = await PATCH(request("PATCH", { capacityMode: "DOUGH_PER_ROUND" }), patchCtx(P.redBean));
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).fields).sort()).toEqual(["piecesPerRound", "roundG"]);
    expect((await db.product.findUniqueOrThrow({ where: { id: P.redBean } })).capacityMode).toBe("DOUGH_PER_UNIT");

    const ok = await PATCH(
      request("PATCH", { capacityMode: "DOUGH_PER_ROUND", roundG: 280, piecesPerRound: 4 }),
      patchCtx(P.redBean),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).product).toMatchObject({
      capacityMode: "DOUGH_PER_ROUND",
      roundG: 280,
      piecesPerRound: 4,
      doughG: null,
    });
  });

  it("rejects nulling a field the current mode needs", async () => {
    const res = await PATCH(request("PATCH", { doughG: null }), patchCtx(P.redBean));
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).fields)).toEqual(["doughG"]);
  });

  it("allows clearing the bundle price and batchYield", async () => {
    const res = await PATCH(request("PATCH", { bundlePriceCents: null, batchYield: null }), patchCtx(P.brulee));
    expect(res.status).toBe(200);
    expect((await res.json()).product).toMatchObject({ bundlePriceCents: null, batchYield: null });
  });

  it("answers 404 for an unknown or malformed id and 422 for unknown keys", async () => {
    expect(
      (await PATCH(request("PATCH", { name: "x" }), patchCtx("00000000-0000-4000-8000-000000000000"))).status,
    ).toBe(404);
    expect((await PATCH(request("PATCH", { name: "x" }), patchCtx("not-a-uuid"))).status).toBe(404);
    expect((await PATCH(request("PATCH", { imageUrl: "http://x" }), patchCtx(P.redBean))).status).toBe(422);
  });

  it("writes no audit row when nothing changed", async () => {
    const res = await PATCH(request("PATCH", { name: "奶酥红豆包" }), patchCtx(P.redBean));
    expect(res.status).toBe(200);
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("POST /reorder", () => {
  it("rewrites sortOrder to 1..n in one transaction with one audit row", async () => {
    const ids = [P.brulee, P.redBean, P.cheeseHorn, P.rockCheese];
    const res = await REORDER(request("POST", { ids }));
    expect(res.status).toBe(200);
    const { products } = await res.json();
    expect(products.map((p: { id: string; sortOrder: number }) => [p.id, p.sortOrder])).toEqual(
      ids.map((id, i) => [id, i + 1]),
    );
    const audit = await db.auditLog.findMany({ where: { action: "product.reorder" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("ADMIN");
  });

  it("rejects a list that is not exactly the product set (409 STALE) or has duplicates (422)", async () => {
    const partial = await REORDER(request("POST", { ids: [P.redBean, P.rockCheese] }));
    expect(partial.status).toBe(409);
    expect((await partial.json()).error).toBe("STALE");
    const dup = await REORDER(request("POST", { ids: [P.redBean, P.redBean, P.rockCheese, P.cheeseHorn] }));
    expect(dup.status).toBe(422);
    const unknown = await REORDER(
      request("POST", { ids: [P.redBean, P.rockCheese, P.cheeseHorn, "00000000-0000-4000-8000-000000000000"] }),
    );
    expect(unknown.status).toBe(409);
    expect(await db.auditLog.count()).toBe(0);
  });
});
