// adminChangeStatus, adminCorrectStatus, adminSetPayment (DATA_MODEL §2, D46, CAPACITY_RULES §8).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { copy } from "@/copy";
import type { LocalDate, OrderStatus } from "@/domain/types";
import { toDbDate } from "@/server/dbDates";
import { AppError } from "@/server/errors";
import { adminChangeStatus, adminCorrectStatus, adminSetPayment } from "@/server/orderAdmin";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const DATE: LocalDate = "2026-10-30";
const NOW = new Date("2026-10-27T15:00:00Z");
const LATER = new Date("2026-10-27T16:00:00Z");

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

async function placed(status: OrderStatus = "NEW", qty = 2) {
  const o = await createOrder({ date: DATE, items: [{ productId: P.redBean, qty }], status });
  return { id: o.id, stamp: o.updatedAt.toISOString() };
}

const fetch = (id: string) => db.order.findUniqueOrThrow({ where: { id } });

describe("adminChangeStatus", () => {
  it("moves forward skipping steps; NEW -> READY sets confirmedAt; audits order.status", async () => {
    const o = await placed("NEW");
    const res = await adminChangeStatus(db, { orderId: o.id, to: "READY", expectedUpdatedAt: o.stamp }, NOW);
    expect(res).toMatchObject({ id: o.id, status: "READY", pickupDate: DATE, updatedAt: NOW.toISOString() });
    const row = await fetch(o.id);
    expect(row.status).toBe("READY");
    expect(row.confirmedAt?.toISOString()).toBe(NOW.toISOString());
    expect(row.updatedAt.toISOString()).toBe(NOW.toISOString());
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: o.id } });
    expect(audit).toMatchObject({ actor: "ADMIN", action: "order.status", before: { status: "NEW" }, after: { status: "READY" } });
  });

  it("keeps an existing confirmedAt", async () => {
    const o = await placed("CONFIRMED");
    const first = new Date("2026-10-20T00:00:00Z");
    await db.order.update({ where: { id: o.id }, data: { confirmedAt: first, updatedAt: NOW } });
    await adminChangeStatus(db, { orderId: o.id, to: "BAKING", expectedUpdatedAt: NOW.toISOString() }, LATER);
    expect((await fetch(o.id)).confirmedAt?.toISOString()).toBe(first.toISOString());
  });

  it("NEW -> CONTACTED does not set confirmedAt", async () => {
    const o = await placed("NEW");
    await adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: o.stamp }, NOW);
    expect((await fetch(o.id)).confirmedAt).toBeNull();
  });

  it("rejects backwards moves and moves out of terminal states", async () => {
    const cases: [OrderStatus, OrderStatus][] = [
      ["READY", "CONFIRMED"],
      ["CONTACTED", "NEW"],
      ["COMPLETED", "CANCELLED"],
      ["CANCELLED", "NEW"],
      ["CONFIRMED", "CONFIRMED"],
    ];
    for (const [from, to] of cases) {
      const o = await placed(from);
      const err = await errorOf(
        adminChangeStatus(db, { orderId: o.id, to, reason: "x", expectedUpdatedAt: o.stamp }, NOW),
      );
      expect(err.code).toBe("VALIDATION");
      expect(err.message).toBe(copy.errors.STATUS_NOT_ALLOWED);
      expect((await fetch(o.id)).status).toBe(from);
    }
    expect(await db.auditLog.count()).toBe(0);
  });

  it("REJECTED needs a reason and is only allowed from NEW / CONTACTED", async () => {
    const o = await placed("NEW");
    for (const reason of [undefined, "   "]) {
      const err = await errorOf(adminChangeStatus(db, { orderId: o.id, to: "REJECTED", reason, expectedUpdatedAt: o.stamp }, NOW));
      expect(err.code).toBe("VALIDATION");
    }
    await adminChangeStatus(db, { orderId: o.id, to: "REJECTED", reason: " 做不了 ", expectedUpdatedAt: o.stamp }, NOW);
    const row = await fetch(o.id);
    expect(row.status).toBe("REJECTED");
    expect(row.cancelledAt).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: o.id } });
    expect(audit.reason).toBe("做不了");

    const c = await placed("CONFIRMED");
    const err = await errorOf(adminChangeStatus(db, { orderId: c.id, to: "REJECTED", reason: "x", expectedUpdatedAt: c.stamp }, NOW));
    expect(err.code).toBe("VALIDATION");
  });

  it("CANCELLED needs a reason and sets cancelledAt / cancelledBy ADMIN", async () => {
    const o = await placed("BAKING");
    const err = await errorOf(adminChangeStatus(db, { orderId: o.id, to: "CANCELLED", expectedUpdatedAt: o.stamp }, NOW));
    expect(err.code).toBe("VALIDATION");
    await adminChangeStatus(db, { orderId: o.id, to: "CANCELLED", reason: "顾客微信取消", expectedUpdatedAt: o.stamp }, NOW);
    const row = await fetch(o.id);
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledBy).toBe("ADMIN");
    expect(row.cancelledAt?.toISOString()).toBe(NOW.toISOString());
    expect(await db.notification.count()).toBe(0);
  });

  it("STALE when expectedUpdatedAt does not match; nothing changes", async () => {
    const o = await placed("NEW");
    const stale = new Date(new Date(o.stamp).getTime() - 1).toISOString();
    const err = await errorOf(adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: stale }, NOW));
    expect(err.code).toBe("STALE");
    expect((await fetch(o.id)).status).toBe("NEW");
    // The returned updatedAt works for the next call; the old stamp is now stale.
    const res = await adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: o.stamp }, NOW);
    await adminChangeStatus(db, { orderId: o.id, to: "CONFIRMED", expectedUpdatedAt: res.updatedAt }, LATER);
    const again = await errorOf(adminChangeStatus(db, { orderId: o.id, to: "BAKING", expectedUpdatedAt: res.updatedAt }, LATER));
    expect(again.code).toBe("STALE");
  });

  it("unknown or malformed id -> NOT_FOUND; bad expectedUpdatedAt -> VALIDATION", async () => {
    const stamp = NOW.toISOString();
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await errorOf(adminChangeStatus(db, { orderId: unknown, to: "CONTACTED", expectedUpdatedAt: stamp }, NOW))).code).toBe("NOT_FOUND");
    expect((await errorOf(adminChangeStatus(db, { orderId: "x", to: "CONTACTED", expectedUpdatedAt: stamp }, NOW))).code).toBe("NOT_FOUND");
    const o = await placed("NEW");
    expect((await errorOf(adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: "yesterday" }, NOW))).code).toBe("VALIDATION");
  });
});

describe("adminCorrectStatus", () => {
  async function fillDay() {
    // 1600 g with a cancelled red bean ×2 waiting to come back.
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 20 }, { productId: P.rockCheese, qty: 2 }] });
    return placed("CANCELLED", 2);
  }

  it("CANCELLED -> NEW on a full day -> OVER_LIMIT with violations; nothing changes", async () => {
    const o = await fillDay();
    await db.order.update({ where: { id: o.id }, data: { cancelledAt: NOW, cancelledBy: "CUSTOMER", updatedAt: NOW } });
    const err = await errorOf(
      adminCorrectStatus(db, { orderId: o.id, to: "NEW", reason: "点错了", expectedUpdatedAt: NOW.toISOString() }, LATER),
    );
    expect(err.code).toBe("OVER_LIMIT");
    expect(err.extra?.violations).toEqual([{ kind: "DOUGH", date: DATE, limit: 1600, after: 1680, over: 80 }]);
    const row = await fetch(o.id);
    expect(row.status).toBe("CANCELLED");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("with override + reason it goes through; order.status_correct and order.override are audited", async () => {
    const o = await fillDay();
    await db.order.update({ where: { id: o.id }, data: { cancelledAt: NOW, cancelledBy: "CUSTOMER", updatedAt: NOW } });
    const res = await adminCorrectStatus(
      db,
      { orderId: o.id, to: "CONFIRMED", reason: "点错了", override: true, expectedUpdatedAt: NOW.toISOString() },
      LATER,
    );
    expect(res.status).toBe("CONFIRMED");
    const row = await fetch(o.id);
    expect(row.cancelledAt).toBeNull();
    expect(row.cancelledBy).toBeNull();
    expect(row.confirmedAt?.toISOString()).toBe(LATER.toISOString());
    const audits = await db.auditLog.findMany({ where: { entityId: o.id }, orderBy: { action: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["order.override", "order.status_correct"]);
    expect(audits[0]).toMatchObject({
      reason: "点错了",
      after: { violations: [{ kind: "DOUGH", date: DATE, limit: 1600, after: 1680, over: 80 }] },
    });
    expect(audits[1]).toMatchObject({ before: { status: "CANCELLED" }, after: { status: "CONFIRMED" }, reason: "点错了" });
  });

  it("re-occupying when it fits needs no override and writes no order.override", async () => {
    const o = await placed("REJECTED");
    await adminCorrectStatus(db, { orderId: o.id, to: "NEW", reason: "点错了", expectedUpdatedAt: o.stamp }, NOW);
    expect((await fetch(o.id)).status).toBe("NEW");
    expect(await db.auditLog.count({ where: { action: "order.override" } })).toBe(0);
  });

  it("a reason is always required; same status is rejected", async () => {
    const o = await placed("READY");
    for (const reason of [undefined, "", "  "]) {
      const err = await errorOf(adminCorrectStatus(db, { orderId: o.id, to: "CONFIRMED", reason: reason as string, expectedUpdatedAt: o.stamp }, NOW));
      expect(err.code).toBe("VALIDATION");
    }
    const same = await errorOf(adminCorrectStatus(db, { orderId: o.id, to: "READY", reason: "x", expectedUpdatedAt: o.stamp }, NOW));
    expect(same.code).toBe("VALIDATION");
  });

  it("moves backwards without a capacity check (READY -> CONFIRMED on an over-full day)", async () => {
    await db.openDate.update({ where: { date: toDbDate(DATE) }, data: { doughLimitG: 100 } });
    const o = await placed("READY", 4); // 280 g > 100 g
    await adminCorrectStatus(db, { orderId: o.id, to: "CONFIRMED", reason: "还没做好", expectedUpdatedAt: o.stamp }, NOW);
    expect((await fetch(o.id)).status).toBe("CONFIRMED");
  });

  it("correcting into CANCELLED sets cancelledAt / cancelledBy ADMIN", async () => {
    const o = await placed("COMPLETED");
    await adminCorrectStatus(db, { orderId: o.id, to: "CANCELLED", reason: "没来取", expectedUpdatedAt: o.stamp }, NOW);
    const row = await fetch(o.id);
    expect(row).toMatchObject({ status: "CANCELLED", cancelledBy: "ADMIN" });
  });

  it("STALE", async () => {
    const o = await placed("READY");
    const err = await errorOf(adminCorrectStatus(db, { orderId: o.id, to: "NEW", reason: "x", expectedUpdatedAt: LATER.toISOString() }, NOW));
    expect(err.code).toBe("STALE");
  });
});

describe("adminSetPayment", () => {
  it("toggles on and off, keeps the method and first paidAt, audits order.paid", async () => {
    const o = await placed("CONFIRMED");
    const r1 = await adminSetPayment(db, { orderId: o.id, paid: true, method: "ZELLE", expectedUpdatedAt: o.stamp }, NOW);
    expect(r1).toMatchObject({ paid: true, paidMethod: "ZELLE" });
    let row = await fetch(o.id);
    expect(row.paidAt?.toISOString()).toBe(NOW.toISOString());

    // Paid again without a method: method and paidAt are kept.
    const r2 = await adminSetPayment(db, { orderId: o.id, paid: true, expectedUpdatedAt: r1.updatedAt }, LATER);
    row = await fetch(o.id);
    expect(row).toMatchObject({ paid: true, paidMethod: "ZELLE" });
    expect(row.paidAt?.toISOString()).toBe(NOW.toISOString());
    expect(row.updatedAt.toISOString()).toBe(LATER.toISOString());

    const r3 = await adminSetPayment(db, { orderId: o.id, paid: false, method: "CASH", expectedUpdatedAt: r2.updatedAt }, LATER);
    expect(r3).toMatchObject({ paid: false, paidMethod: null });
    row = await fetch(o.id);
    expect(row.paidAt).toBeNull();

    const audits = await db.auditLog.findMany({ where: { entityId: o.id, action: "order.paid" }, orderBy: { at: "asc" } });
    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatchObject({
      actor: "ADMIN",
      before: { paid: false, paidMethod: null, paidAt: null },
      after: { paid: true, paidMethod: "ZELLE", paidAt: NOW.toISOString() },
    });
    expect(audits.at(-1)).toMatchObject({ after: { paid: false, paidMethod: null, paidAt: null } });
  });

  it("paid with no method at all stores null; a method can be changed later", async () => {
    const o = await placed("NEW");
    const r1 = await adminSetPayment(db, { orderId: o.id, paid: true, expectedUpdatedAt: o.stamp }, NOW);
    expect(r1.paidMethod).toBeNull();
    const r2 = await adminSetPayment(db, { orderId: o.id, paid: true, method: "VENMO", expectedUpdatedAt: r1.updatedAt }, LATER);
    expect(r2.paidMethod).toBe("VENMO");
  });

  it("STALE and bad method -> VALIDATION", async () => {
    const o = await placed("NEW");
    expect((await errorOf(adminSetPayment(db, { orderId: o.id, paid: true, expectedUpdatedAt: LATER.toISOString() }, NOW))).code).toBe("STALE");
    expect(
      (await errorOf(adminSetPayment(db, { orderId: o.id, paid: true, method: "BITCOIN" as never, expectedUpdatedAt: o.stamp }, NOW))).code,
    ).toBe("VALIDATION");
    expect((await fetch(o.id)).paid).toBe(false);
  });
});
