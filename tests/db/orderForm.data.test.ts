// GET /api/admin/order-form: data, usage numbers, auth.

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

import { GET } from "@/app/api/admin/order-form/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { loadOrderFormData } from "@/server/orderForm";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const NOW = new Date("2026-10-27T15:00:00Z"); // Tue 10/27 Chicago
let P: DefaultProductIds;
let previousSiteUrl: string | undefined;

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = "https://bunbunnybakes.shop";
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  cookieToken = undefined;
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

describe("loadOrderFormData", () => {
  it("excludes archived products, keeps paused ones", async () => {
    await db.product.update({ where: { id: P.brulee }, data: { status: "ARCHIVED" } });
    await db.product.update({ where: { id: P.rockCheese }, data: { status: "PAUSED" } });
    const data = await loadOrderFormData(db, NOW);
    const ids = data.products.map((p) => p.id);
    expect(ids).not.toContain(P.brulee);
    expect(ids).toContain(P.rockCheese);
    expect(data.products.find((p) => p.id === P.rockCheese)?.status).toBe("PAUSED");
  });

  it("lists open dates from today to today+60 with usage from occupying orders only", async () => {
    await createOpenDate("2026-10-26"); // past
    await createOpenDate("2026-10-27"); // today
    await createOpenDate("2026-10-30", { deliveryEnabled: false });
    await createOpenDate("2026-11-02", { isOpen: false });
    await createOpenDate("2027-01-30"); // > today + 60
    await createOrder({ date: "2026-10-30", items: [{ productId: P.redBean, qty: 4 }], status: "CONFIRMED" });
    await createOrder({
      date: "2026-10-30",
      items: [{ productId: P.redBean, qty: 8 }],
      status: "CANCELLED",
    });
    await createOrder({
      date: "2026-10-27",
      items: [{ productId: P.redBean, qty: 2 }],
      status: "NEW",
      fulfillment: "DELIVERY",
    });

    const data = await loadOrderFormData(db, NOW);
    expect(data.dates.map((d) => d.date)).toEqual(["2026-10-27", "2026-10-30"]);
    const today = data.dates[0];
    expect(today).toMatchObject({ deliveries: 1, deliveryEnabled: true, doughLimitG: 1600 });
    expect(today.doughG).toBeGreaterThan(0);
    const fri = data.dates[1];
    expect(fri.deliveryEnabled).toBe(false);
    expect(fri.label).toBe("10/30 周五");
    // 4 red-bean buns only; the cancelled order does not count.
    const one = await loadOrderFormData(db, NOW);
    expect(one.dates[1].doughG).toBe(fri.doughG);
    expect(fri.doughG).toBeGreaterThan(0);
    expect(data.fees).toEqual({ deliveryFeeCents: 500, freeDeliveryMinCents: 2500 });
  });
});

describe("GET /api/admin/order-form", () => {
  it("is 401 without a session and 200 with one", async () => {
    const anon = await GET(new Request("https://bunbunnybakes.shop/api/admin/order-form"));
    expect(anon.status).toBe(401);

    const user = await db.adminUser.create({
      data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
    });
    const { token } = await createSession(db, user.id, new Date());
    cookieToken = token;
    const res = await GET(new Request("https://bunbunnybakes.shop/api/admin/order-form"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.fees).toBeDefined();
  });
});
