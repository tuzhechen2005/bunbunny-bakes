// DATA_MODEL.md §5 concurrency tests 1–5 and 7, on real Postgres with real overlap.

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { usage } from "@/domain/capacity";
import type { CartLine, Fulfillment, LocalDate } from "@/domain/types";
import { createPrismaClient } from "@/server/db";
import { toDbDate } from "@/server/dbDates";
import { isAppError } from "@/server/errors";
import { loadProductMap } from "@/server/day";
import { createCustomerOrder, type CreatedOrder } from "@/server/orders";
import {
  TEST_DATABASE_URL,
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

// Big enough pool for every request to hold its own connection at the same time.
const pool = createPrismaClient(TEST_DATABASE_URL, { max: 25 });

const DATE: LocalDate = "2026-10-30"; // Fri; bread cutoff 10/29 20:00 CDT, brûlée 10/28 20:00 CDT
const NOW = new Date("2026-10-27T15:00:00Z");

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await pool.$disconnect();
  await db.$disconnect();
});

type Outcome = { ok: true; order: CreatedOrder } | { ok: false; code: string };

/** AppError -> its code; anything else still fails the test. */
function settle(p: Promise<CreatedOrder>): Promise<Outcome> {
  return p.then(
    (order): Outcome => ({ ok: true, order }),
    (e: unknown): Outcome => {
      if (isAppError(e)) return { ok: false, code: e.code };
      throw e;
    },
  );
}

/** n concurrent orders, each with its own wechatId and ipHash. */
async function race(
  n: number,
  items: CartLine[],
  fulfillment: Fulfillment = "PICKUP",
  date: LocalDate = DATE,
): Promise<Outcome[]> {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      settle(
        createCustomerOrder(
          pool,
          { items, pickupDate: date, fulfillment, wechatId: `wx_race_${i}`, ipHash: `ip_${i}_${randomUUID()}` },
          NOW,
        ),
      ),
    ),
  );
}

function tally(outcomes: Outcome[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const o of outcomes) {
    const k = o.ok ? "OK" : o.code;
    t[k] = (t[k] ?? 0) + 1;
  }
  return t;
}

async function dayUsage(date: LocalDate) {
  const products = await db.$transaction((tx) => loadProductMap(tx));
  const orders = await db.order.findMany({
    where: { pickupDate: toDbDate(date) },
    include: { items: true },
  });
  return usage(
    orders.map((o) => ({
      id: o.id,
      status: o.status,
      fulfillment: o.fulfillment,
      items: o.items.map((i) => ({ productId: i.productId, qty: i.qty })),
    })),
    products,
  );
}

describe("DATA_MODEL §5 concurrency", () => {
  it("1: 20 x red bean x1 with 140 g left -> exactly 2 succeed, 18 FULL, dough == limit", async () => {
    // 8 red bean + 8 rock cheese = 1120 g used; limit 1260 -> 140 g = 2 red beans left.
    await createOpenDate(DATE, { doughLimitG: 1260 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 8 }], status: "CONFIRMED" });
    await createOrder({ date: DATE, items: [{ productId: P.rockCheese, qty: 8 }], status: "NEW" });

    const outcomes = await race(20, [{ productId: P.redBean, qty: 1 }]);
    expect(tally(outcomes)).toEqual({ OK: 2, FULL: 18 });
    expect((await dayUsage(DATE)).doughG).toBe(1260);
    expect(await db.order.count()).toBe(4);
  });

  it("2: dough full, cheese horn 3 (1 piece left) -> 10 x horn x1 -> exactly 1 succeeds", async () => {
    // 3 horns = 1 round (340 g) + 8 red bean (560 g) = 900 g = limit.
    await createOpenDate(DATE, { doughLimitG: 900 });
    await createOrder({ date: DATE, items: [{ productId: P.cheeseHorn, qty: 3 }] });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 8 }] });
    expect((await dayUsage(DATE)).doughG).toBe(900);

    const outcomes = await race(10, [{ productId: P.cheeseHorn, qty: 1 }]);
    expect(tally(outcomes)).toEqual({ OK: 1, FULL: 9 });
    expect((await dayUsage(DATE)).doughG).toBe(900);
    const horns = await db.orderItem.aggregate({ where: { productId: P.cheeseHorn }, _sum: { qty: true } });
    expect(horns._sum.qty).toBe(4);
  });

  it("3: brûlée 2 left, 10 x 1 -> exactly 2 succeed", async () => {
    await createOpenDate(DATE);
    await db.openDateProductLimit.create({ data: { date: toDbDate(DATE), productId: P.brulee, limit: 2 } });

    const outcomes = await race(10, [{ productId: P.brulee, qty: 1 }]);
    expect(tally(outcomes)).toEqual({ OK: 2, FULL: 8 });
    expect((await dayUsage(DATE)).products[P.brulee]).toBe(2);
  });

  it("4: delivery 1 slot left, 5 delivery orders -> exactly 1, others DELIVERY_FULL", async () => {
    await createOpenDate(DATE, { deliveryLimit: 2 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], fulfillment: "DELIVERY" });

    const outcomes = await race(5, [{ productId: P.redBean, qty: 1 }], "DELIVERY");
    expect(tally(outcomes)).toEqual({ OK: 1, DELIVERY_FULL: 4 });
    expect((await dayUsage(DATE)).deliveries).toBe(2);
  });

  it("5: same idempotencyKey x5 concurrently -> 1 order, all 5 return the same viewToken", async () => {
    await createOpenDate(DATE);
    const idempotencyKey = randomUUID();
    const input = {
      items: [{ productId: P.redBean, qty: 2 }],
      pickupDate: DATE,
      fulfillment: "PICKUP" as const,
      wechatId: "wx_idem",
      idempotencyKey,
      ipHash: "ip_idem",
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createCustomerOrder(pool, input, NOW)),
    );
    expect(await db.order.count()).toBe(1);
    const order = await db.order.findFirstOrThrow();
    expect(new Set(results.map((r) => r.viewToken))).toEqual(new Set([order.viewToken]));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(4);
    expect(results.find((r) => !r.replayed)!.notificationId).not.toBeNull();
    expect(results.filter((r) => r.replayed).every((r) => r.notificationId === null)).toBe(true);
    // Replays write nothing.
    expect(await db.notification.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.rateLimitHit.count()).toBe(1);
  });

  it("5b: same idempotencyKey racing on two different dates -> 1 order, the other rejected without a token", async () => {
    // Different day locks, so the loser hits the unique index (P2002 path), then must not
    // receive the winner's viewToken because the pickup date differs.
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    const idempotencyKey = randomUUID();
    const base = {
      items: [{ productId: P.redBean, qty: 1 }],
      fulfillment: "PICKUP" as const,
      idempotencyKey,
      wechatId: "wx_same_person",
    };
    const outcomes = await Promise.all([
      settle(createCustomerOrder(pool, { ...base, pickupDate: DATE, ipHash: "ip_a" }, NOW)),
      settle(createCustomerOrder(pool, { ...base, pickupDate: "2026-10-31", ipHash: "ip_b" }, NOW)),
    ]);
    expect(tally(outcomes)).toEqual({ OK: 1, VALIDATION: 1 });
    expect(await db.order.count()).toBe(1);
    const winner = outcomes.find((o) => o.ok) as { ok: true; order: CreatedOrder };
    expect(winner.order.replayed).toBe(false);
    expect(await db.notification.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.rateLimitHit.count()).toBe(1);
  });

  it("IP limit across dates: same ipHash, 6 orders on 6 open dates at once -> exactly 3 OK, 3 RATE_LIMITED", async () => {
    // Each order holds a different day lock; only the IP advisory lock serializes them.
    const dates: LocalDate[] = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    for (const d of dates) await createOpenDate(d);
    const outcomes = await Promise.all(
      dates.map((d, i) =>
        settle(createCustomerOrder(
          pool,
          {
            items: [{ productId: P.redBean, qty: 1 }],
            pickupDate: d,
            fulfillment: "PICKUP",
            wechatId: `wx_ip_${i}`,
            ipHash: "ip_shared",
          },
          NOW,
        )),
      ),
    );
    expect(tally(outcomes)).toEqual({ OK: 3, RATE_LIMITED: 3 });
    expect(await db.rateLimitHit.count({ where: { key: "order_ip:ip_shared" } })).toBe(3);
    expect(await db.order.count()).toBe(3);
  });

  it("WeChat limit: same wechatId, 5 orders on one date at once -> exactly 2 OK", async () => {
    await createOpenDate(DATE);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        settle(createCustomerOrder(
          pool,
          {
            items: [{ productId: P.redBean, qty: 1 }],
            pickupDate: DATE,
            fulfillment: "PICKUP",
            wechatId: "wx_one",
            ipHash: `ip_w_${i}`,
          },
          NOW,
        )),
      ),
    );
    expect(tally(outcomes)).toEqual({ OK: 2, RATE_LIMITED: 3 });
  });

  it("7: after concurrent creates, seq for the day is 1..N with no gaps or duplicates", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }] });

    const [a, b] = await Promise.all([
      race(15, [{ productId: P.brulee, qty: 1 }], "PICKUP", DATE),
      race(5, [{ productId: P.brulee, qty: 1 }], "PICKUP", "2026-10-31"),
    ]);
    expect(tally(a)).toEqual({ OK: 15 });
    expect(tally(b)).toEqual({ OK: 5 });

    for (const [date, n, mmdd] of [
      [DATE, 16, "1030"],
      ["2026-10-31", 5, "1031"],
    ] as const) {
      const orders = await db.order.findMany({ where: { pickupDate: toDbDate(date) }, orderBy: { seq: "asc" } });
      expect(orders.map((o) => o.seq)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(orders.map((o) => o.orderNo)).toEqual(
        orders.map((o) => `${mmdd}-${String(o.seq).padStart(3, "0")}`),
      );
    }
  });
});
