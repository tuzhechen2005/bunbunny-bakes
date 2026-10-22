// Atomicity: a failure after the order update (writeAudit throws) rolls everything back.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDate } from "@/domain/types";
import { toDbDate } from "@/server/dbDates";
import {
  adminChangeStatus,
  adminCorrectStatus,
  adminEditOrder,
  adminSetPayment,
  customerCancel,
} from "@/server/orderAdmin";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const fail = vi.hoisted(() => ({ on: false }));

vi.mock("@/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return {
    ...actual,
    writeAudit: async (...args: Parameters<typeof actual.writeAudit>) => {
      if (fail.on) throw new Error("boom: audit failed");
      return actual.writeAudit(...args);
    },
  };
});

const A: LocalDate = "2026-10-30";
const B: LocalDate = "2026-10-31";
const NOW = new Date("2026-10-27T15:00:00Z");

let P: DefaultProductIds;

beforeEach(async () => {
  fail.on = false;
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(A);
  await createOpenDate(B);
});

afterAll(async () => {
  await db.$disconnect();
});

async function snapshot(id: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { productId: "asc" } } } });
  return {
    order,
    audits: await db.auditLog.count(),
    notifications: await db.notification.count(),
    itemCount: await db.orderItem.count(),
  };
}

async function placed() {
  const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }] });
  return db.order.update({ where: { id: o.id }, data: { cutoffAt: new Date("2026-10-30T01:00:00Z") } });
}

describe("rollback when writeAudit throws after the update", () => {
  it("adminEditOrder (items + date + fulfillment): order, items, seq unchanged", async () => {
    const o = await placed();
    const before = await snapshot(o.id);
    fail.on = true;
    await expect(
      adminEditOrder(
        db,
        {
          orderId: o.id,
          items: [{ productId: P.cheeseHorn, qty: 3 }],
          pickupDate: B,
          fulfillment: "DELIVERY",
          note: "x",
          expectedUpdatedAt: o.updatedAt.toISOString(),
        },
        NOW,
      ),
    ).rejects.toThrow("boom");
    expect(await snapshot(o.id)).toEqual(before);
    expect(await db.order.count({ where: { pickupDate: toDbDate(B) } })).toBe(0);

    // Works once the failure is gone (the tx really was rolled back, not half-applied).
    fail.on = false;
    const res = await adminEditOrder(db, { orderId: o.id, pickupDate: B, expectedUpdatedAt: o.updatedAt.toISOString() }, NOW);
    expect(res.orderNo).toBe("1031-001");
  });

  it("customerCancel: status unchanged, no notification", async () => {
    const o = await placed();
    const before = await snapshot(o.id);
    fail.on = true;
    await expect(customerCancel(db, { viewToken: o.viewToken }, NOW)).rejects.toThrow("boom");
    expect(await snapshot(o.id)).toEqual(before);
  });

  it("adminChangeStatus / adminCorrectStatus / adminSetPayment: nothing changes", async () => {
    const o = await placed();
    const before = await snapshot(o.id);
    const stamp = o.updatedAt.toISOString();
    fail.on = true;
    await expect(adminChangeStatus(db, { orderId: o.id, to: "CONFIRMED", expectedUpdatedAt: stamp }, NOW)).rejects.toThrow("boom");
    await expect(adminCorrectStatus(db, { orderId: o.id, to: "CANCELLED", reason: "x", expectedUpdatedAt: stamp }, NOW)).rejects.toThrow("boom");
    await expect(adminSetPayment(db, { orderId: o.id, paid: true, method: "CASH", expectedUpdatedAt: stamp }, NOW)).rejects.toThrow("boom");
    expect(await snapshot(o.id)).toEqual(before);
  });
});
