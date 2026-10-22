// customerCancel (POST /api/o/{token}/cancel; CAPACITY_RULES §9, §3.4 cancel example; D26).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { usage } from "@/domain/capacity";
import type { LocalDate } from "@/domain/types";
import { loadDayContext, loadProductMap, loadSettings } from "@/server/day";
import { AppError } from "@/server/errors";
import { customerCancel } from "@/server/orderAdmin";
import { createCustomerOrder } from "@/server/orders";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const DATE: LocalDate = "2026-10-30"; // bread cutoff 10/29 20:00 CDT = 10/30 01:00Z
const CUTOFF = new Date("2026-10-30T01:00:00Z");
const NOW = new Date("2026-10-27T15:00:00Z");

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(DATE);
});

afterAll(async () => {
  await db.$disconnect();
});

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError, but the call succeeded");
}

/** Factory order with a real cutoffAt. */
async function placed(
  items: { productId: string; qty: number }[],
  over: { status?: "NEW" | "CONTACTED" | "CONFIRMED" | "BAKING" | "READY" | "COMPLETED" | "CANCELLED" | "REJECTED"; cutoffAt?: Date } = {},
) {
  const o = await createOrder({ date: DATE, items, status: over.status });
  return db.order.update({ where: { id: o.id }, data: { cutoffAt: over.cutoffAt ?? CUTOFF } });
}

async function doughOf(date: LocalDate): Promise<number> {
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const products = await loadProductMap(tx);
    const day = await loadDayContext(tx, date, settings, products);
    return usage(day.orders, products).doughG;
  });
}

describe("customerCancel", () => {
  it("cancels, audits as CUSTOMER and enqueues customer_cancelled:<id> in the same tx", async () => {
    const o = await placed([{ productId: P.redBean, qty: 2 }]);
    const res = await customerCancel(db, { viewToken: o.viewToken }, NOW);
    expect(res.status).toBe("CANCELLED");
    expect(res.alreadyCancelled).toBe(false);
    expect(res.notificationId).toEqual(expect.any(String));

    const after = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledBy).toBe("CUSTOMER");
    expect(after.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    expect(after.updatedAt.toISOString()).toBe(NOW.toISOString());

    const audits = await db.auditLog.findMany({ where: { entityId: o.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor: "CUSTOMER",
      action: "order.cancel",
      entityType: "Order",
      before: { status: "NEW" },
      after: { status: "CANCELLED" },
    });
    expect(audits[0].at.toISOString()).toBe(NOW.toISOString());

    const notes = await db.notification.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: res.notificationId,
      kind: "CUSTOMER_CANCELLED",
      dedupeKey: `customer_cancelled:${o.id}`,
      payload: { orderId: o.id },
      status: "PENDING",
    });
  });

  it("is idempotent: a second cancel returns alreadyCancelled and writes nothing", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await customerCancel(db, { viewToken: o.viewToken }, NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const res = await customerCancel(db, { viewToken: o.viewToken }, later);
    expect(res).toEqual({ status: "CANCELLED", alreadyCancelled: true, notificationId: null });
    const after = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.updatedAt.toISOString()).toBe(NOW.toISOString());
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.notification.count()).toBe(1);
  });

  it("an order the owner cancelled is also returned as already cancelled", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }], { status: "CANCELLED" });
    const res = await customerCancel(db, { viewToken: o.viewToken }, NOW);
    expect(res.alreadyCancelled).toBe(true);
    expect(await db.notification.count()).toBe(0);
  });

  it("at the cutoff instant -> CUTOFF_PASSED with the cancel message; 1 s before -> ok", async () => {
    const a = await placed([{ productId: P.redBean, qty: 1 }]);
    const err = await errorOf(customerCancel(db, { viewToken: a.viewToken }, CUTOFF));
    expect(err.code).toBe("CUTOFF_PASSED");
    expect(err.message).toBe("已过取消时间，请微信联系店主");
    expect((await db.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("NEW");
    expect(await db.auditLog.count()).toBe(0);

    const ok = await customerCancel(db, { viewToken: a.viewToken }, new Date(CUTOFF.getTime() - 1000));
    expect(ok.alreadyCancelled).toBe(false);
  });

  it("CONTACTED and CONFIRMED before the cutoff can be cancelled", async () => {
    for (const status of ["CONTACTED", "CONFIRMED"] as const) {
      const o = await placed([{ productId: P.redBean, qty: 1 }], { status });
      await customerCancel(db, { viewToken: o.viewToken }, NOW);
      expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELLED");
    }
  });

  it("BAKING / READY / COMPLETED / REJECTED -> NOT_CANCELLABLE, even before the cutoff", async () => {
    for (const status of ["BAKING", "READY", "COMPLETED", "REJECTED"] as const) {
      const o = await placed([{ productId: P.redBean, qty: 1 }], { status });
      const err = await errorOf(customerCancel(db, { viewToken: o.viewToken }, NOW));
      expect(err.code).toBe("NOT_CANCELLABLE");
      expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(status);
    }
    expect(await db.auditLog.count()).toBe(0);
  });

  it("unknown or empty token -> NOT_FOUND", async () => {
    expect((await errorOf(customerCancel(db, { viewToken: "nope" }, NOW))).code).toBe("NOT_FOUND");
    expect((await errorOf(customerCancel(db, { viewToken: "" }, NOW))).code).toBe("NOT_FOUND");
  });

  it("frees capacity: a new order that was FULL fits after the cancel", async () => {
    await db.openDate.update({ where: { date: new Date(`${DATE}T00:00:00Z`) }, data: { doughLimitG: 1540 } });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 20 }] }); // 1400 g
    const mine = await createCustomerOrder(
      db,
      { items: [{ productId: P.redBean, qty: 2 }], pickupDate: DATE, fulfillment: "PICKUP", wechatId: "wx_me" },
      NOW,
    ); // 1540 g = limit
    const other = { items: [{ productId: P.redBean, qty: 2 }], pickupDate: DATE, fulfillment: "PICKUP" as const, wechatId: "wx_other" };
    expect((await errorOf(createCustomerOrder(db, other, NOW))).code).toBe("FULL");

    await customerCancel(db, { viewToken: mine.viewToken }, NOW);
    expect(await doughOf(DATE)).toBe(1400);
    const created = await createCustomerOrder(db, other, NOW);
    expect(created.orderNo).toBe("1030-003");
    expect(await doughOf(DATE)).toBe(1540);
  });

  it("CAPACITY_RULES §3.4 cancel example: cancelling cheese horn ×3 after D5 leaves dough at 1600 g", async () => {
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 18 }] }); // 1260 g
    const horn3 = await placed([{ productId: P.cheeseHorn, qty: 3 }]); // 1 round, 340 g
    expect(await doughOf(DATE)).toBe(1600);
    // D5: one more cheese horn fits (4 pieces, still 1 round).
    await createCustomerOrder(
      db,
      { items: [{ productId: P.cheeseHorn, qty: 1 }], pickupDate: DATE, fulfillment: "PICKUP", wechatId: "wx_d5" },
      NOW,
    );
    expect(await doughOf(DATE)).toBe(1600);

    await customerCancel(db, { viewToken: horn3.viewToken }, NOW);
    expect(await doughOf(DATE)).toBe(1600); // 1 horn left, still 1 round
  });
});
