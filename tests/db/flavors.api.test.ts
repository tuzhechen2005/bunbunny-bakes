// /api/admin/products routes: auth, validation (mode <-> fields), merge validation,
// defaults, reorder and audit rows. Real Postgres.

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

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

import { PATCH } from "@/app/api/admin/products/[id]/flavors/[flavorId]/route";
import { PUT as REORDER } from "@/app/api/admin/products/[id]/flavors/order/route";
import { POST } from "@/app/api/admin/products/[id]/flavors/route";
import { POST as QUOTE } from "@/app/api/availability/route";
import { GET } from "@/app/api/admin/products/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { createDefaultProducts, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
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

it("flavour mutations require auth and Origin", async () => {
  const ctx = { params: Promise.resolve({ id: P.redBean, flavorId: P.redBean }) };
  cookieToken = undefined;
  expect((await POST(request("POST", {}), ctx)).status).toBe(401);
  expect((await PATCH(request("PATCH", {}), ctx)).status).toBe(401);
  expect((await REORDER(request("PUT", {}), ctx)).status).toBe(401);
  expect((await POST(request("POST", {}, { origin: "https://evil.test" }), ctx)).status).toBe(403);
});

it("creates, renames, reprices, sorts and deactivates with atomic audit; no hard delete", async () => {
  const ctx = patchCtx(P.redBean);
  for (const bad of [{ name: "", priceCents: 10 }, { name: "a".repeat(13), priceCents: 10 }, { name: "原味", priceCents: -1 }, { name: "原味", priceCents: 1.5 }]) {
    expect((await POST(request("POST", bad), ctx)).status).toBe(422);
  }
  expect(await db.productFlavor.count()).toBe(0);
  const first = await POST(request("POST", { name: "原味", priceCents: 300 }), ctx);
  expect(first.status).toBe(201);
  const a = (await first.json()).product.flavors[0];
  const second = await POST(request("POST", { name: "抹茶", priceCents: 400 }), ctx);
  const b = (await second.json()).product.flavors[1];
  const flavorCtx = { params: Promise.resolve({ id: P.redBean, flavorId: a.id }) };
  const patched = await PATCH(request("PATCH", { name: "香草", priceCents: 350, active: false }), flavorCtx);
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ product: { id: P.redBean }, overLimitDates: [] });
  expect((await REORDER(request("PUT", { ids: [b.id, a.id] }), ctx)).status).toBe(200);
  expect((await REORDER(request("PUT", { ids: [a.id] }), ctx)).status).toBe(409);
  const list = (await (await GET(request("GET"))).json()).products.find((p: { id: string }) => p.id === P.redBean);
  expect(list.flavors.map((f: { id: string }) => f.id)).toEqual([b.id, a.id]);
  expect(list.flavors[1]).toMatchObject({ name: "香草", priceCents: 350, active: false });
  expect(await db.auditLog.count({ where: { entityId: P.redBean, action: { startsWith: "product.flavor." } } })).toBe(4);
  expect((await PATCH(request("PATCH", { name: "x" }), { params: Promise.resolve({ id: P.brulee, flavorId: a.id }) })).status).toBe(404);
});

it("quote prices active flavours from DB, ignores client amounts, and returns flavour errors as 400", async () => {
  const a = await db.productFlavor.create({ data: { productId: P.redBean, name: "原味", priceCents: 300 } });
  const b = await db.productFlavor.create({ data: { productId: P.redBean, name: "抹茶", priceCents: 400 } });
  const quote = (items: unknown[]) => QUOTE(request("POST", { items, fulfillment: "DELIVERY", totalCents: 1 }));
  const valid = await quote([{ productId: P.redBean, flavorId: a.id, qty: 2, unitPriceCents: 1 }, { productId: P.redBean, flavorId: b.id, qty: 3 }]);
  expect(valid.status).toBe(200);
  expect((await valid.json()).pricing).toMatchObject({ subtotalCents: 1800, deliveryFeeCents: 500, totalCents: 2300 });
  const missing = await quote([{ productId: P.redBean, qty: 1 }]);
  expect(missing.status).toBe(400);
  expect((await missing.json()).error).toBe("FLAVOR_REQUIRED");
  await db.productFlavor.update({ where: { id: b.id }, data: { active: false } });
  const inactive = await quote([{ productId: P.redBean, flavorId: b.id, qty: 1 }]);
  expect(inactive.status).toBe(400);
  expect((await inactive.json()).error).toBe("FLAVOR_UNAVAILABLE");
});

it("rolls back a flavour change when its AuditLog insert fails", async () => {
  const a = await db.productFlavor.create({ data: { productId: P.redBean, name: "原味", priceCents: 300 } });
  await db.$executeRawUnsafe(`CREATE FUNCTION f1_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'f1 audit failure'; END; $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER f1_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION f1_fail_audit()`);
  try {
    const { updateFlavor } = await import("@/server/productFlavors");
    await expect(updateFlavor(db, P.redBean, a.id, { active: false, priceCents: 999 }, new Date())).rejects.toThrow(/f1 audit failure/);
    expect(await db.productFlavor.findUnique({ where: { id: a.id } })).toMatchObject({ active: true, priceCents: 300 });
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER f1_fail_audit ON "AuditLog"`);
    await db.$executeRawUnsafe(`DROP FUNCTION f1_fail_audit()`);
  }
});

it("F2: API bundle quotes and date flags never expose internal flavour limits", async () => {
  const { addDays, localDateOf } = await import("@/domain/dates");
  const { createOpenDate } = await import("./helpers");
  const date = addDays(localDateOf(new Date()), 3);
  await createOpenDate(date);
  const ctx = patchCtx(P.redBean);
  const created = await POST(request("POST", { name: "原味", priceCents: 450, bundlePriceCents: 1600, dailyLimit: 0 }), ctx);
  expect(created.status).toBe(201);
  const f = (await created.json()).product.flavors[0];
  expect(f).toMatchObject({ dailyLimit: 0, bundlePriceCents: 1600 });
  const quote = await QUOTE(request("POST", { items: [{ productId: P.redBean, flavorId: f.id, qty: 5 }], fulfillment: "PICKUP" }));
  expect(quote.status).toBe(200);
  const body = await quote.json();
  expect(body.pricing.subtotalCents).toBe(2050);
  expect(body.dates).toEqual([{ date, state: "FULL", soldOutFlavorIds: [f.id] }]);
  expect(JSON.stringify(body)).not.toMatch(/"(dailyLimit|flavorLimits|used|limit|after)"/);
  const { GET: MENU } = await import("@/app/api/menu/route");
  const menu = await (await MENU()).json();
  expect(menu.products.find((p: { id: string }) => p.id === P.redBean).flavors).toEqual([{ id: f.id, name: "原味", priceCents: 450, bundlePriceCents: 1600 }]);
  const { POST: ORDER } = await import("@/app/api/orders/route");
  vi.stubEnv("IP_HASH_SECRET", "f2-test-only");
  const result = await ORDER(request("POST", { items: [{ productId: P.redBean, flavorId: f.id, qty: 1 }], fulfillment: "PICKUP", pickupDate: date, wechatId: "test-customer" }));
  vi.unstubAllEnvs();
  expect(result.status).toBe(409);
  const error = await result.json();
  expect(error).toMatchObject({ error: "FLAVOR_FULL", flavorId: f.id, productId: P.redBean });
  expect(Object.keys(error).sort()).toEqual(["error", "flavorId", "message", "productId"]);
});
