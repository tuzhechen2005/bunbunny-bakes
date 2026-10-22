// Per-day order numbers come from OpenDate.lastSeq and are never reused, even after an
// order moves to another day (D30, D52).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LocalDate } from "@/domain/types";
import { lockOpenDate } from "@/server/day";
import { toDbDate } from "@/server/dbDates";
import { adminEditOrder } from "@/server/orderAdmin";
import { createAdminOrder } from "@/server/orders";
import { allocateSeq } from "@/server/seq";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const A: LocalDate = "2026-10-30";
const B: LocalDate = "2026-10-31";
const NOW = new Date("2026-10-27T15:00:00Z");

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(A);
  await createOpenDate(B);
});

afterAll(async () => {
  await db.$disconnect();
});

const lastSeq = async (d: LocalDate) =>
  (await db.openDate.findUniqueOrThrow({ where: { date: toDbDate(d) } })).lastSeq;

const phone = (date: LocalDate) =>
  createAdminOrder(db, { items: [{ productId: P.redBean, qty: 1 }], pickupDate: date, fulfillment: "PICKUP", wechatId: "wx_p" }, NOW);

describe("allocateSeq (OpenDate.lastSeq)", () => {
  it("a new OpenDate starts at lastSeq 0; each allocation increments and persists it", async () => {
    expect(await lastSeq(A)).toBe(0);
    const alloc = () =>
      db.$transaction(async (tx) => {
        await lockOpenDate(tx, A);
        return allocateSeq(tx, A);
      });
    expect(await alloc()).toEqual({ seq: 1, orderNo: "1030-001" });
    expect(await alloc()).toEqual({ seq: 2, orderNo: "1030-002" });
    expect(await lastSeq(A)).toBe(2);
    expect(await lastSeq(B)).toBe(0);
  });

  it("rolls back with its transaction (no gap when the create fails)", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await lockOpenDate(tx, A);
        await allocateSeq(tx, A);
        throw new Error("create failed");
      }),
    ).rejects.toThrow("create failed");
    expect(await lastSeq(A)).toBe(0);
    expect((await phone(A)).orderNo).toBe("1030-001");
  });

  it("throws when the date has no OpenDate row", async () => {
    await expect(db.$transaction((tx) => allocateSeq(tx, "2026-12-25"))).rejects.toThrow(/OpenDate/);
  });

  it("never goes below a seq already on the day (rows inserted without allocateSeq)", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 1 }] }); // seq 1, lastSeq untouched
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 1 }] }); // seq 2
    expect((await phone(A)).orderNo).toBe("1030-003");
    expect(await lastSeq(A)).toBe(3);
  });

  it("cancelled / rejected / moved-away orders never free their number", async () => {
    const o1 = await phone(A);
    const o2 = await phone(A);
    expect([o1.orderNo, o2.orderNo]).toEqual(["1030-001", "1030-002"]);
    const row = await db.order.findUniqueOrThrow({ where: { id: o2.id } });
    const moved = await adminEditOrder(db, { orderId: o2.id, pickupDate: B, expectedUpdatedAt: row.updatedAt.toISOString() }, NOW);
    expect(moved.orderNo).toBe("1031-001");
    await db.order.update({ where: { id: o1.id }, data: { status: "CANCELLED" } });
    expect((await phone(A)).orderNo).toBe("1030-003");
    expect((await phone(B)).orderNo).toBe("1031-002");
  });

  it("CHECK: lastSeq >= 0", async () => {
    await expect(db.openDate.update({ where: { date: toDbDate(A) }, data: { lastSeq: -1 } })).rejects.toThrow(
      /OpenDate_lastSeq_chk/,
    );
  });
});
