// enqueueDailySummary and POST /api/cron/summary on the real test database.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
// The route now sends right away: never reach a real provider from tests.
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  getTransport: () => ({ send: async () => ({ id: "test" }) }),
}));

import { POST as summaryPOST } from "@/app/api/cron/summary/route";
import { prisma } from "@/server/db";
import { loadDashboard } from "@/server/dashboard";
import { renderNotification } from "@/server/emails";
import { enqueueDailySummary, loadDailySummary } from "@/server/summaryJob";
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
// 20:05 on 2026-10-29 in Chicago (CDT).
const NOW = new Date("2026-10-30T01:05:00Z");
const SECRET = "cron-secret-for-tests";

let ids: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  process.env.SITE_URL = SITE;
  process.env.CRON_SECRET = SECRET;
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function seedExample() {
  await createOpenDate("2026-10-30");
  await createOrder({
    date: "2026-10-30",
    status: "CONFIRMED",
    items: [
      { productId: ids.redBean, qty: 6 },
      { productId: ids.cheeseHorn, qty: 3 },
      { productId: ids.brulee, qty: 10 },
    ],
  });
  await createOrder({
    date: "2026-10-30",
    status: "NEW",
    fulfillment: "DELIVERY",
    items: [
      { productId: ids.rockCheese, qty: 6 },
      { productId: ids.cheeseHorn, qty: 3 },
      { productId: ids.brulee, qty: 10 },
    ],
  });
}

describe("enqueueDailySummary", () => {
  it("enqueues a DAILY_SUMMARY keyed summary:<X+1> with the summary and siteUrl", async () => {
    await seedExample();
    const r = await enqueueDailySummary(db, NOW);
    expect(r.status).toBe("enqueued");
    const rows = await db.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "DAILY_SUMMARY",
      dedupeKey: "summary:2026-10-30",
      status: "PENDING",
    });
    if (r.status === "enqueued") expect(rows[0].id).toBe(r.notificationId);
    const payload = rows[0].payload as { siteUrl: string; tomorrow: string; isEmpty: boolean };
    expect(payload.siteUrl).toBe(SITE);
    expect(payload.tomorrow).toBe("2026-10-30");
    expect(payload.isEmpty).toBe(false);

    const email = await renderNotification(db, rows[0], NOW);
    expect(email.subject).toBe("🐰 明天 10/30 周五：面包 18 个 · 1520 g｜今晚布蕾 20 杯");
  });

  it("calling twice the same evening gives one notification", async () => {
    await seedExample();
    expect((await enqueueDailySummary(db, NOW)).status).toBe("enqueued");
    expect((await enqueueDailySummary(db, new Date(NOW.getTime() + 60_000))).status).toBe("duplicate");
    expect(await db.notification.count()).toBe(1);
  });

  it("enqueues nothing when there is nothing to report", async () => {
    await createOpenDate("2026-10-30"); // open but no orders
    expect(await enqueueDailySummary(db, NOW)).toEqual({ status: "empty" });
    expect(await db.notification.count()).toBe(0);
  });

  it("excludes cancelled orders (a day with only cancelled orders is empty)", async () => {
    await createOpenDate("2026-10-30");
    await createOrder({
      date: "2026-10-30",
      status: "CANCELLED",
      items: [
        { productId: ids.redBean, qty: 6 },
        { productId: ids.brulee, qty: 10 },
      ],
    });
    expect(await enqueueDailySummary(db, NOW)).toEqual({ status: "empty" });

    await createOrder({
      date: "2026-10-30",
      status: "CONFIRMED",
      items: [{ productId: ids.redBean, qty: 2 }],
    });
    const s = await loadDailySummary(db, NOW);
    expect(s.bread?.lines.map((l) => [l.name, l.qty])).toEqual([["奶酥红豆包", 2]]);
    expect(s.tonight.lines).toEqual([]);
    expect(s.deliveries).toEqual({ pickup: 1, delivery: 0 });
  });

  it("tomorrow not open but brûlée the day after: bread is null, tomorrow night has the cups", async () => {
    await createOpenDate("2026-10-31");
    await createOrder({
      date: "2026-10-31",
      status: "CONFIRMED",
      items: [{ productId: ids.brulee, qty: 9 }],
    });
    const s = await loadDailySummary(db, NOW);
    expect(s.bread).toBeNull();
    expect(s.tomorrowNight.lines.map((l) => [l.qty, l.batches, l.leftover])).toEqual([[9, 3, 0]]);
    expect((await enqueueDailySummary(db, NOW)).status).toBe("enqueued");
  });

  it("numbers equal the dashboard's for the same data (PRD §9 #11)", async () => {
    await seedExample();
    await createOpenDate("2026-10-31");
    const s = await loadDailySummary(db, NOW);
    const d = await loadDashboard(db, NOW);
    const card = d.days["2026-10-30"];

    expect(s.bread?.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, rounds: l.rounds }))).toEqual(
      card.products,
    );
    expect(s.bread?.doughG).toBe(card.doughG);
    expect(s.bread?.doughLimitG).toBe(card.doughLimitG);
    expect(s.tonight.lines).toEqual(d.tonightBrulee);
    expect(s.deliveries.delivery).toBe(card.deliveries);
    expect(s.unconfirmed.filter((u) => u.pickupDate === "2026-10-30").length).toBe(d.unconfirmedTomorrow);
    expect(s.bread?.doughG).toBe(1520);
    expect(s.tonight.lines[0]).toMatchObject({ qty: 20, batches: 7, leftover: 1 });
  });
});

describe("POST /api/cron/summary", () => {
  function req(auth?: string) {
    return new Request("http://localhost/api/cron/summary", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    });
  }

  it("401 without or with a wrong secret", async () => {
    expect((await summaryPOST(req())).status).toBe(401);
    expect((await summaryPOST(req("Bearer nope"))).status).toBe(401);
    expect(await db.notification.count()).toBe(0);
  });

  it("200 enqueues once; the second call is a duplicate", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    await seedExample();
    const first = await summaryPOST(req(`Bearer ${SECRET}`));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "enqueued" });
    const second = await summaryPOST(req(`Bearer ${SECRET}`));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });
    expect(await db.notification.count()).toBe(1);
  });

  it("200 with status empty when there is nothing to report", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const res = await summaryPOST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "empty" });
    expect(await db.notification.count()).toBe(0);
  });
});
