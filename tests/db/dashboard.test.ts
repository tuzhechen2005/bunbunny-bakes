// Dashboard data (loadDashboard) and the ordering switch, on the real test database.

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

import { GET as dashboardGET } from "@/app/api/admin/dashboard/route";
import { POST as orderingPOST } from "@/app/api/admin/ordering/route";
import { buildSummary } from "@/domain/summary";
import { createSession, hashPassword } from "@/server/auth";
import { loadDashboard, setOrderingEnabled } from "@/server/dashboard";
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

const SITE = "https://bunbunnybakes.com";
// 10:00 on 2026-10-28 in Chicago (CDT).
const NOW = new Date("2026-10-28T15:00:00Z");
const TODAY = "2026-10-28";
const TOMORROW = "2026-10-29";

let ids: DefaultProductIds;
let userId: string;

beforeEach(async () => {
  await resetDb();
  process.env.SITE_URL = SITE;
  cookieToken = undefined;
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  userId = user.id;
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

/** The CAPACITY_RULES §10 example on TOMORROW. */
async function seedExample() {
  await createOpenDate(TOMORROW);
  await createOrder({
    date: TOMORROW,
    status: "CONFIRMED",
    items: [
      { productId: ids.redBean, qty: 6 },
      { productId: ids.cheeseHorn, qty: 3 },
      { productId: ids.brulee, qty: 10 },
    ],
  });
  await createOrder({
    date: TOMORROW,
    status: "NEW",
    fulfillment: "DELIVERY",
    items: [
      { productId: ids.rockCheese, qty: 6 },
      { productId: ids.cheeseHorn, qty: 3 },
      { productId: ids.brulee, qty: 10 },
    ],
  });
}

describe("loadDashboard", () => {
  it("matches the nightly summary for the §10 example (1520/1600 g, 2 rounds +2, brûlée 20 -> 7 batches +1)", async () => {
    await seedExample();
    const d = await loadDashboard(db, NOW);

    expect(d.today).toBe(TODAY);
    expect(d.tomorrow).toBe(TOMORROW);
    expect(d.orderingEnabled).toBe(true);

    const card = d.days[TOMORROW];
    expect(card.isOpen).toBe(true);
    expect(card.doughG).toBe(1520);
    expect(card.doughLimitG).toBe(1600);
    expect(card.products.map((p) => [p.name, p.qty, p.rounds])).toEqual([
      ["奶酥红豆包", 6, null],
      ["岩烧乳酪包", 6, null],
      ["奶酪角", 6, { rounds: 2, leftover: 2 }],
    ]);
    expect(card.independent).toEqual([
      { productId: ids.brulee, name: "焦糖布蕾", qty: 20, limit: 24 },
    ]);
    expect(card.deliveries).toBe(1);
    expect(card.deliveryLimit).toBe(8);
    expect(card.deliveryEnabled).toBe(true);
    expect(card.byStatus.NEW).toBe(1);
    expect(card.byStatus.CONFIRMED).toBe(1);

    expect(d.tonightBrulee).toEqual([
      { productId: ids.brulee, name: "焦糖布蕾", qty: 20, batches: 7, leftover: 1 },
    ]);

    // Same numbers as buildSummary on the same facts.
    const products = Object.fromEntries(
      (await db.product.findMany()).map((p) => [
        p.id,
        {
          id: p.id,
          capacityMode: p.capacityMode,
          doughG: p.doughG,
          roundG: p.roundG,
          piecesPerRound: p.piecesPerRound,
          dailyLimit: p.dailyLimit,
          leadDays: p.leadDays,
          name: p.name,
          sortOrder: p.sortOrder,
          batchYield: p.batchYield,
        },
      ]),
    );
    const summary = buildSummary({
      today: TODAY,
      products,
      days: {
        [TOMORROW]: {
          date: TOMORROW,
          isOpen: true,
          limits: {
            doughLimitG: 1600,
            deliveryEnabled: true,
            deliveryLimit: 8,
            productLimits: { [ids.brulee]: 24 },
          },
          orders: [
            {
              id: "a",
              orderNo: "1029-001",
              wechatId: "a",
              status: "CONFIRMED",
              fulfillment: "PICKUP",
              items: [
                { productId: ids.redBean, qty: 6 },
                { productId: ids.cheeseHorn, qty: 3 },
                { productId: ids.brulee, qty: 10 },
              ],
            },
            {
              id: "b",
              orderNo: "1029-002",
              wechatId: "b",
              status: "NEW",
              fulfillment: "DELIVERY",
              items: [
                { productId: ids.rockCheese, qty: 6 },
                { productId: ids.cheeseHorn, qty: 3 },
                { productId: ids.brulee, qty: 10 },
              ],
            },
          ],
        },
      },
    });
    expect(summary.bread?.doughG).toBe(card.doughG);
    expect(summary.bread?.lines.map((l) => [l.productId, l.qty, l.rounds])).toEqual(
      card.products.map((p) => [p.productId, p.qty, p.rounds]),
    );
    expect(summary.tonight.lines).toEqual(d.tonightBrulee);
  });

  it("excludes cancelled/rejected orders from capacity but counts them in byStatus", async () => {
    await seedExample();
    await createOrder({
      date: TOMORROW,
      status: "CANCELLED",
      fulfillment: "DELIVERY",
      items: [
        { productId: ids.cheeseHorn, qty: 8 },
        { productId: ids.brulee, qty: 4 },
      ],
    });
    await createOrder({
      date: TOMORROW,
      status: "REJECTED",
      items: [{ productId: ids.redBean, qty: 5 }],
    });
    const d = await loadDashboard(db, NOW);
    const card = d.days[TOMORROW];
    expect(card.doughG).toBe(1520);
    expect(card.deliveries).toBe(1);
    expect(card.independent[0].qty).toBe(20);
    expect(card.byStatus.CANCELLED).toBe(1);
    expect(card.byStatus.REJECTED).toBe(1);
    expect(d.tonightBrulee[0].qty).toBe(20);
    expect(d.unconfirmedTomorrow).toBe(1);
  });

  it("counts unconfirmed (NEW + CONTACTED) orders picked up tomorrow only", async () => {
    await createOpenDate(TODAY);
    await createOpenDate(TOMORROW);
    await createOpenDate("2026-10-30");
    const item = [{ productId: ids.redBean, qty: 1 }];
    await createOrder({ date: TOMORROW, status: "NEW", items: item });
    await createOrder({ date: TOMORROW, status: "CONTACTED", items: item });
    await createOrder({ date: TOMORROW, status: "CONFIRMED", items: item });
    await createOrder({ date: TODAY, status: "NEW", items: item });
    await createOrder({ date: "2026-10-30", status: "NEW", items: item });
    const d = await loadDashboard(db, NOW);
    expect(d.unconfirmedTomorrow).toBe(2);
    expect(d.days[TODAY].byStatus.NEW).toBe(1);
  });

  it("reports a closed tomorrow with no orders as closed and empty", async () => {
    const d = await loadDashboard(db, NOW);
    const card = d.days[TOMORROW];
    expect(card.isOpen).toBe(false);
    expect(card.products).toEqual([]);
    expect(card.independent).toEqual([]);
    expect(card.doughG).toBe(0);
    expect(d.tonightBrulee).toEqual([]);
    expect(d.unconfirmedTomorrow).toBe(0);
  });

  it("uses the Chicago date for 'today' (01:00 UTC is still the previous day)", async () => {
    const d = await loadDashboard(db, new Date("2026-10-29T01:00:00Z"));
    expect(d.today).toBe(TODAY);
  });

  it("counts FAILED notifications only", async () => {
    const base = { kind: "NEW_ORDER" as const, payload: {}, nextAttemptAt: NOW };
    const kind = base.kind;
    await db.notification.createMany({
      data: [
        { ...base, kind, dedupeKey: "a", status: "FAILED" },
        { ...base, kind, dedupeKey: "b", status: "FAILED" },
        { ...base, kind, dedupeKey: "c", status: "SENT" },
        { ...base, kind, dedupeKey: "d", status: "PENDING" },
      ],
    });
    expect((await loadDashboard(db, NOW)).failedNotifications).toBe(2);
  });

  it("lists 14 days from today and marks over-limit days", async () => {
    await createOpenDate("2026-10-30", { doughLimitG: 100 });
    await createOpenDate("2026-10-31", { deliveryLimit: 0 });
    await createOpenDate("2026-11-01");
    await createOrder({
      date: "2026-10-30",
      items: [{ productId: ids.redBean, qty: 2 }],
    });
    await createOrder({
      date: "2026-10-31",
      fulfillment: "DELIVERY",
      items: [{ productId: ids.redBean, qty: 1 }],
    });
    await createOrder({ date: "2026-11-01", items: [{ productId: ids.redBean, qty: 1 }] });
    const d = await loadDashboard(db, NOW);
    expect(d.next14).toHaveLength(14);
    expect(d.next14[0].date).toBe(TODAY);
    expect(d.next14[13].date).toBe("2026-11-10");
    const byDate = Object.fromEntries(d.next14.map((x) => [x.date, x]));
    expect(byDate["2026-10-30"]).toMatchObject({ isOpen: true, doughG: 140, doughLimitG: 100, over: true });
    expect(byDate["2026-10-31"]).toMatchObject({ deliveries: 1, deliveryLimit: 0, over: true });
    expect(byDate["2026-11-01"]).toMatchObject({ doughG: 70, doughLimitG: 1600, over: false });
    expect(byDate["2026-11-02"]).toMatchObject({ isOpen: false, over: false });
  });
});

describe("ordering switch", () => {
  it("toggles Setting.orderingEnabled and writes an ordering.toggle audit row", async () => {
    expect(await setOrderingEnabled(db, false, NOW)).toEqual({ orderingEnabled: false });
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).orderingEnabled).toBe(false);
    const rows = await db.auditLog.findMany({ where: { action: "ordering.toggle" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: "ADMIN",
      entityType: "Setting",
      before: { orderingEnabled: true },
      after: { orderingEnabled: false },
    });
  });
});

describe("routes", () => {
  const get = () => new Request(SITE + "/api/admin/dashboard");
  const post = (body: unknown, origin: string | null = SITE) =>
    new Request(SITE + "/api/admin/ordering", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });

  it("answers 401 without a session", async () => {
    expect((await dashboardGET(get())).status).toBe(401);
    expect((await orderingPOST(post({ enabled: false }))).status).toBe(401);
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).orderingEnabled).toBe(true);
  });

  it("answers 403 for a foreign or missing Origin on the switch", async () => {
    cookieToken = (await createSession(db, userId, new Date())).token;
    expect((await orderingPOST(post({ enabled: false }, "https://evil.example"))).status).toBe(403);
    expect((await orderingPOST(post({ enabled: false }, null))).status).toBe(403);
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).orderingEnabled).toBe(true);
  });

  it("serves the dashboard and flips the switch for a signed-in admin", async () => {
    cookieToken = (await createSession(db, userId, new Date())).token;
    const res = await dashboardGET(get());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orderingEnabled).toBe(true);
    expect(json.next14).toHaveLength(14);

    const off = await orderingPOST(post({ enabled: false }));
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ orderingEnabled: false });
    expect((await orderingPOST(post({ enabled: "yes" }))).status).toBe(422);
  });
});
