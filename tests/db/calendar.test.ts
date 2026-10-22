// Admin calendar: GET shape/resolution/usage and PUT warnings, confirm path, audit.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadCalendar, updateOpenDate, type CalendarDay } from "@/server/calendar";
import { toDbDate } from "@/server/dbDates";
import { isAppError } from "@/server/errors";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const D1 = "2026-10-30";
const NOW = new Date("2026-10-20T15:00:00Z");

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await db.$disconnect();
});

const get = (from: string, to: string) => db.$transaction((tx) => loadCalendar(tx, from, to));

function body(over: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    doughLimitG: null,
    deliveryEnabled: true,
    deliveryLimit: null,
    productLimits: {},
    note: null,
    ...over,
  };
}

async function expectError(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("expected an AppError");
}

describe("GET calendar", () => {
  it("returns every date with defaults for days without a row", async () => {
    const res = await get("2026-10-29", "2026-11-01");
    expect(res.days.map((d) => d.date)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(res.independentProducts).toEqual([{ id: P.brulee, name: "焦糖布蕾" }]);
    expect(res.days[0]).toEqual({
      date: "2026-10-29",
      isOpen: false,
      hasRow: false,
      note: null,
      limits: { doughLimitG: 1600, deliveryEnabled: true, deliveryLimit: 8, productLimits: { [P.brulee]: 24 } },
      overrides: { doughLimitG: null, deliveryLimit: null, productLimits: { [P.brulee]: null } },
      usage: { doughG: 0, products: { [P.brulee]: 0 }, deliveries: 0 },
      orderCount: 0,
      over: { dough: false, products: [], delivery: false },
    });
  });

  it("resolves override ?? default and reflects the open row", async () => {
    await createOpenDate(D1, { doughLimitG: 1000, deliveryLimit: 3, deliveryEnabled: false, note: "hi" });
    await db.openDateProductLimit.create({
      data: { date: toDbDate(D1), productId: P.brulee, limit: 10 },
    });
    const day = (await get(D1, D1)).days[0];
    expect(day).toMatchObject({
      isOpen: true,
      hasRow: true,
      note: "hi",
      limits: { doughLimitG: 1000, deliveryEnabled: false, deliveryLimit: 3, productLimits: { [P.brulee]: 10 } },
      overrides: { doughLimitG: 1000, deliveryLimit: 3, productLimits: { [P.brulee]: 10 } },
    });
  });

  it("computes usage from occupying orders and flags over-limit days", async () => {
    await createOpenDate(D1, { doughLimitG: 200, deliveryLimit: 1 });
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 3 }] }); // 210 g
    await createOrder({
      date: D1,
      items: [{ productId: P.brulee, qty: 5 }],
      fulfillment: "DELIVERY",
    });
    await createOrder({ date: D1, items: [{ productId: P.brulee, qty: 5 }], fulfillment: "DELIVERY" });
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 50 }], status: "CANCELLED" });
    const day = (await get(D1, D1)).days[0];
    expect(day.usage).toEqual({ doughG: 210, products: { [P.brulee]: 10 }, deliveries: 2 });
    expect(day.orderCount).toBe(3);
    expect(day.over).toEqual({ dough: true, products: [], delivery: true });
  });

  it("flags delivery over when deliveries exist but delivery is turned off", async () => {
    await createOpenDate(D1, { deliveryEnabled: false });
    await createOrder({ date: D1, items: [{ productId: P.brulee, qty: 1 }], fulfillment: "DELIVERY" });
    const day = (await get(D1, D1)).days[0];
    expect(day.over.delivery).toBe(true);
  });

  it("uses CURRENT product settings (D45)", async () => {
    await createOpenDate(D1);
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 10 }] });
    expect((await get(D1, D1)).days[0].usage.doughG).toBe(700);
    await db.product.update({ where: { id: P.redBean }, data: { doughG: 200 } });
    const day = (await get(D1, D1)).days[0];
    expect(day.usage.doughG).toBe(2000);
    expect(day.over.dough).toBe(true);
  });

  it("flags an INDEPENDENT product over its limit", async () => {
    await createOpenDate(D1);
    await db.openDateProductLimit.create({ data: { date: toDbDate(D1), productId: P.brulee, limit: 4 } });
    await createOrder({ date: D1, items: [{ productId: P.brulee, qty: 5 }] });
    expect((await get(D1, D1)).days[0].over.products).toEqual([P.brulee]);
  });
});

describe("PUT dates/{date}", () => {
  it("creates the row, stores overrides, and writes an audit row", async () => {
    const day = await updateOpenDate(
      db,
      D1,
      body({ doughLimitG: 1200, deliveryLimit: 4, productLimits: { [P.brulee]: 12 }, note: " 周五 " }),
      NOW,
    );
    expect(day).toMatchObject({
      isOpen: true,
      hasRow: true,
      note: "周五",
      limits: { doughLimitG: 1200, deliveryLimit: 4, productLimits: { [P.brulee]: 12 } },
    });
    const row = await db.openDate.findUnique({ where: { date: toDbDate(D1) } });
    expect(row?.doughLimitG).toBe(1200);
    const audits = await db.auditLog.findMany({ where: { action: "date.update" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: "ADMIN", entityType: "OpenDate", entityId: D1, before: null, reason: null });
    expect(audits[0].after).toMatchObject({ isOpen: true, doughLimitG: 1200, productLimits: { [P.brulee]: 12 } });
  });

  it("null clears overrides and records before/after", async () => {
    await updateOpenDate(db, D1, body({ doughLimitG: 1200, deliveryLimit: 4, productLimits: { [P.brulee]: 12 } }), NOW);
    const day = await updateOpenDate(db, D1, body({ productLimits: { [P.brulee]: null } }), NOW);
    expect(day.overrides).toEqual({ doughLimitG: null, deliveryLimit: null, productLimits: { [P.brulee]: null } });
    expect(await db.openDateProductLimit.count()).toBe(0);
    const audits = await db.auditLog.findMany({ where: { action: "date.update" }, orderBy: { at: "asc" } });
    expect(audits).toHaveLength(2);
    const last = audits.at(-1)!;
    expect(last.before).toMatchObject({ doughLimitG: 1200, deliveryLimit: 4 });
    expect(last.after).toMatchObject({ doughLimitG: null, deliveryLimit: null, productLimits: {} });
  });

  it("can close a date without orders and without confirm", async () => {
    await createOpenDate(D1);
    const day = await updateOpenDate(db, D1, body({ isOpen: false }), NOW);
    expect(day.isOpen).toBe(false);
  });

  it("BELOW_USAGE (dough, delivery, product) -> 409 OVER_LIMIT, nothing written", async () => {
    await createOpenDate(D1, { doughLimitG: 1600 });
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 10 }, { productId: P.brulee, qty: 6 }], fulfillment: "DELIVERY" });
    const before = await db.openDate.findUnique({ where: { date: toDbDate(D1) } });
    const e = await expectError(
      updateOpenDate(db, D1, body({ doughLimitG: 500, deliveryLimit: 0, productLimits: { [P.brulee]: 5 } }), NOW),
    );
    expect(e.code).toBe("OVER_LIMIT");
    expect(e.httpStatus).toBe(409);
    expect(e.extra?.warnings).toEqual([
      { kind: "BELOW_USAGE", what: "DOUGH", limit: 500, used: 700 },
      { kind: "BELOW_USAGE", what: "DELIVERY", limit: 0, used: 1 },
      { kind: "BELOW_USAGE", what: "PRODUCT", productId: P.brulee, limit: 5, used: 6 },
    ]);
    expect(await db.openDate.findUnique({ where: { date: toDbDate(D1) } })).toEqual(before);
    expect(await db.openDateProductLimit.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("HAS_ORDERS when un-ticking a day with orders -> 409; confirm writes, audits the reason, keeps orders", async () => {
    await createOpenDate(D1);
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 2 }] });
    await createOrder({ date: D1, items: [{ productId: P.redBean, qty: 2 }], status: "CANCELLED" });
    const e = await expectError(updateOpenDate(db, D1, body({ isOpen: false }), NOW));
    expect(e.extra?.warnings).toEqual([{ kind: "HAS_ORDERS", count: 1 }]);
    expect((await db.openDate.findUnique({ where: { date: toDbDate(D1) } }))?.isOpen).toBe(true);

    const day = await updateOpenDate(db, D1, body({ isOpen: false, confirm: true }), NOW);
    expect(day.isOpen).toBe(false);
    expect(await db.order.count({ where: { status: "NEW" } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "date.update" } });
    expect(audit.reason).toBe("confirmed warnings: HAS_ORDERS 1");
    expect(audit.before).toMatchObject({ isOpen: true });
    expect(audit.after).toMatchObject({ isOpen: false });
  });

  it("rejects productLimits for non-INDEPENDENT or unknown products with VALIDATION", async () => {
    for (const id of [P.redBean, "11111111-1111-4111-8111-111111111111"]) {
      const e = await expectError(updateOpenDate(db, D1, body({ productLimits: { [id]: 3 } }), NOW));
      expect(e.code).toBe("VALIDATION");
    }
    expect(await db.openDate.count()).toBe(0);
  });

  it("rejects malformed bodies and dates with VALIDATION", async () => {
    for (const bad of [
      body({ doughLimitG: -1 }),
      body({ doughLimitG: 1.5 }),
      body({ note: "x".repeat(201) }),
      body({ isOpen: "yes" }),
      { isOpen: true },
    ]) {
      expect((await expectError(updateOpenDate(db, D1, bad, NOW))).code).toBe("VALIDATION");
    }
    expect((await expectError(updateOpenDate(db, "2026-02-30", body(), NOW))).code).toBe("VALIDATION");
    expect(await db.openDate.count()).toBe(0);
  });

  it("returns the day in the GET shape", async () => {
    const day: CalendarDay = await updateOpenDate(db, D1, body(), NOW);
    expect(Object.keys(day).sort()).toEqual(
      ["date", "hasRow", "isOpen", "limits", "note", "orderCount", "over", "overrides", "usage"],
    );
  });
});
