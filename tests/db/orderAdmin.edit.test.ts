// adminEditOrder (DATA_MODEL §4 "店主改单"; CAPACITY_RULES §3.3, §6, §8; D45, D48, D52).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LocalDate, OrderStatus, Violation } from "@/domain/types";
import { toDbDate } from "@/server/dbDates";
import { AppError } from "@/server/errors";
import { adminEditOrder, type AdminEditOrderInput } from "@/server/orderAdmin";
import { createAdminOrder, createCustomerOrder } from "@/server/orders";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const A: LocalDate = "2026-10-30"; // Fri
const B: LocalDate = "2026-10-31"; // Sat
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

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError, but the call succeeded");
}

async function placed(
  items: { productId: string; qty: number }[],
  over: { date?: LocalDate; status?: OrderStatus; fulfillment?: "PICKUP" | "DELIVERY" } = {},
) {
  const o = await createOrder({ date: over.date ?? A, items, status: over.status, fulfillment: over.fulfillment });
  return { id: o.id, viewToken: o.viewToken, stamp: o.updatedAt.toISOString() };
}

const edit = (id: string, stamp: string, over: Omit<AdminEditOrderInput, "orderId" | "expectedUpdatedAt">, now = NOW) =>
  adminEditOrder(db, { orderId: id, expectedUpdatedAt: stamp, ...over }, now);

const fetch = (id: string) =>
  db.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { productId: "asc" } } } });

describe("adminEditOrder: capacity", () => {
  it("shrinking on a full day is ok (its own old content is excluded)", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 18 }] }); // 1260 g
    const o = await placed([{ productId: P.redBean, qty: 4 }, { productId: P.rockCheese, qty: 1 }]); // +340 g = 1600
    const res = await edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 2 }, { productId: P.rockCheese, qty: 1 }] });
    expect(res).toMatchObject({ subtotalCents: 2 * 249 + 249, totalCents: 747, updatedAt: NOW.toISOString() });
    const row = await fetch(o.id);
    expect(row.items.map((i) => i.qty).sort()).toEqual([1, 2]);
    expect(await db.auditLog.count({ where: { action: "order.override" } })).toBe(0);
  });

  it("on an exactly-full day, a second cheese horn uses the spare wedge of its own round", async () => {
    await db.openDate.update({ where: { date: toDbDate(A) }, data: { doughLimitG: 1880 } });
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 20 }] }); // 1400 g
    const o = await placed([{ productId: P.redBean, qty: 2 }, { productId: P.cheeseHorn, qty: 1 }]); // +140 +340 = 1880
    await edit(o.id, o.stamp, { items: [{ productId: P.cheeseHorn, qty: 2 }, { productId: P.redBean, qty: 2 }] });
    expect((await fetch(o.id)).items.find((i) => i.productId === P.cheeseHorn)?.qty).toBe(2);
  });

  it("growing over the limits -> OVER_LIMIT listing every violation; nothing changes", async () => {
    await db.openDate.update({ where: { date: toDbDate(A) }, data: { deliveryLimit: 1 } });
    await db.openDateProductLimit.create({ data: { date: toDbDate(A), productId: P.brulee, limit: 1 } });
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 20 }], fulfillment: "DELIVERY" }); // 1400 g, 1 delivery
    const o = await placed([{ productId: P.redBean, qty: 2 }]); // 1540
    const err = await errorOf(
      edit(o.id, o.stamp, {
        items: [{ productId: P.redBean, qty: 4 }, { productId: P.brulee, qty: 2 }],
        fulfillment: "DELIVERY",
      }),
    );
    expect(err.code).toBe("OVER_LIMIT");
    const v = err.extra?.violations as Violation[];
    expect(v).toEqual([
      { kind: "DOUGH", date: A, limit: 1600, after: 1680, over: 80 },
      { kind: "PRODUCT", date: A, productId: P.brulee, limit: 1, after: 2, over: 1 },
      { kind: "DELIVERY", date: A, limit: 1, after: 2, over: 1 },
    ]);
    const row = await fetch(o.id);
    expect(row.items).toHaveLength(1);
    expect(row.fulfillment).toBe("PICKUP");
    expect(row.updatedAt.toISOString()).toBe(o.stamp);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("override + reason proceeds and audits order.override with violations and reason", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 22 }] }); // 1540 g
    const o = await placed([{ productId: P.redBean, qty: 1 }]); // 1610 g: already over, as if forced earlier
    // Growing to 3 -> 1750 g needs an override.
    const res = await edit(o.id, o.stamp, {
      items: [{ productId: P.redBean, qty: 3 }],
      override: true,
      reason: "  老顾客  ",
    });
    expect(res.subtotalCents).toBe(747);
    const audits = await db.auditLog.findMany({ where: { entityId: o.id }, orderBy: { action: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["order.edit", "order.override"]);
    expect(audits[1]).toMatchObject({
      actor: "ADMIN",
      reason: "老顾客",
      after: { violations: [{ kind: "DOUGH", date: A, limit: 1600, after: 1750, over: 150 }] },
    });
    expect(audits[0].reason).toBe("老顾客");
  });

  it("override without a reason -> VALIDATION", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    for (const reason of [undefined, null, "  "]) {
      const err = await errorOf(edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 3 }], override: true, reason }));
      expect(err.code).toBe("VALIDATION");
      expect(err.extra?.fields).toHaveProperty("reason");
    }
  });

  it("only touched capacities are checked (D48): adding brûlée on an over-full dough day is ok", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 24 }] }); // 1680 g, forced earlier
    const o = await placed([{ productId: P.brulee, qty: 2 }]);
    await edit(o.id, o.stamp, { items: [{ productId: P.brulee, qty: 4 }] });
    expect((await fetch(o.id)).items[0].qty).toBe(4);
  });

  it("a non-occupying order is not capacity-checked", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 22 }] });
    const o = await placed([{ productId: P.redBean, qty: 1 }], { status: "CANCELLED" });
    await edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 8 }] });
    expect((await fetch(o.id)).items[0].qty).toBe(8);
  });

  it("note / wechat-only edits do not re-check capacity on an over-full day", async () => {
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 24 }] });
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await edit(o.id, o.stamp, { note: "  晚点取  ", wechatId: "  wx_new " });
    const row = await fetch(o.id);
    expect(row.note).toBe("晚点取");
    expect(row.wechatId).toBe("wx_new");
  });
});

describe("adminEditOrder: date change (D52)", () => {
  it("allocates a new seq / orderNo on the new date and keeps the viewToken", async () => {
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 1 }] });
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 1 }] });
    // Through the real create flow, so A's counter (OpenDate.lastSeq) is 1.
    const created = await createAdminOrder(db, { items: [{ productId: P.redBean, qty: 2 }], pickupDate: A, fulfillment: "PICKUP", wechatId: "wx_o" }, NOW);
    const before = await fetch(created.id);
    const o = { id: created.id, viewToken: created.viewToken, stamp: before.updatedAt.toISOString() };
    expect(before.orderNo).toBe("1030-001");

    const res = await edit(o.id, o.stamp, { pickupDate: B });
    expect(res).toMatchObject({ pickupDate: B, orderNo: "1031-003" });
    const row = await fetch(o.id);
    expect(row.seq).toBe(3);
    expect(row.orderNo).toBe("1031-003");
    expect(row.viewToken).toBe(o.viewToken);
    expect(row.pickupDate.toISOString()).toBe(toDbDate(B).toISOString());
    // Bread-only on Sat 10/31 -> cutoff Fri 10/30 20:00 CDT.
    expect(row.cutoffAt.toISOString()).toBe("2026-10-31T01:00:00.000Z");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: o.id, action: "order.edit" } });
    expect(audit.before).toMatchObject({ orderNo: "1030-001", pickupDate: A });
    expect(audit.after).toMatchObject({ orderNo: "1031-003", pickupDate: B });

    // The number the moved order left behind on A is never handed out again.
    const next = await createAdminOrder(db, { items: [{ productId: P.redBean, qty: 1 }], pickupDate: A, fulfillment: "PICKUP", wechatId: "wx_x" }, NOW);
    expect(next.orderNo).toBe("1030-002");
    // Moving it back to A gives it a new number there too.
    const back = await edit(o.id, res.updatedAt, { pickupDate: A }, new Date(NOW.getTime() + 1000));
    expect(back.orderNo).toBe("1030-003");
  });

  it("the new day's capacity is checked (old day's content excluded)", async () => {
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 21 }] }); // 1470 g on B
    const o = await placed([{ productId: P.redBean, qty: 2 }]);
    const err = await errorOf(edit(o.id, o.stamp, { pickupDate: B, items: [{ productId: P.redBean, qty: 1 }, { productId: P.rockCheese, qty: 1 }] }));
    expect(err.code).toBe("OVER_LIMIT");
    expect(err.extra?.violations).toEqual([{ kind: "DOUGH", date: B, limit: 1600, after: 1610, over: 10 }]);
    await edit(o.id, o.stamp, { pickupDate: B, items: [{ productId: P.redBean, qty: 1 }] });
    expect((await fetch(o.id)).orderNo).toBe("1031-002");
  });

  it("closed, missing or past dates -> DATE_CLOSED; the cutoff does not apply to the owner", async () => {
    await createOpenDate("2026-11-01", { isOpen: false });
    await createOpenDate("2026-10-26"); // before NOW's Chicago day
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    for (const d of ["2026-11-01", "2026-11-05", "2026-10-26"]) {
      expect((await errorOf(edit(o.id, o.stamp, { pickupDate: d }))).code).toBe("DATE_CLOSED");
    }
    // B's bread cutoff is 10/31 01:00Z; the owner can still move there after it.
    await edit(o.id, o.stamp, { pickupDate: B }, new Date("2026-10-31T03:00:00Z"));
    expect((await fetch(o.id)).orderNo).toBe("1031-001");
  });

  it("same date as now is not a date change (no renumbering)", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await edit(o.id, o.stamp, { pickupDate: A, note: "x" });
    expect((await fetch(o.id)).orderNo).toBe("1030-001");
  });
});

describe("adminEditOrder: prices, cutoff, products", () => {
  it("keeps the snapshot price of products already on the order; new products use current prices", async () => {
    const o = await placed([{ productId: P.redBean, qty: 4 }]); // 899 bundle snapshot
    await db.product.update({ where: { id: P.redBean }, data: { unitPriceCents: 300, bundlePriceCents: 1100, name: "新名字" } });
    await db.product.update({ where: { id: P.rockCheese }, data: { unitPriceCents: 275 } });

    const res = await edit(o.id, o.stamp, {
      items: [{ productId: P.redBean, qty: 5 }, { productId: P.rockCheese, qty: 1 }],
      fulfillment: "DELIVERY",
    });
    // red bean 899 + 249 (snapshot) = 1148; rock cheese 275 (current); 1423 < 2500 -> +500.
    expect(res).toMatchObject({ subtotalCents: 1423, deliveryFeeCents: 500, totalCents: 1923 });
    const row = await fetch(o.id);
    const red = row.items.find((i) => i.productId === P.redBean)!;
    const rock = row.items.find((i) => i.productId === P.rockCheese)!;
    expect(red).toMatchObject({ qty: 5, unitPriceCents: 249, bundlePriceCents: 899, lineTotalCents: 1148, nameSnapshot: "奶酥红豆包" });
    expect(rock).toMatchObject({ qty: 1, unitPriceCents: 275, lineTotalCents: 275 });
  });

  it("uses the current delivery fee settings", async () => {
    await createSettings({ deliveryFeeCents: 700, freeDeliveryMinCents: 1000 });
    const o = await placed([{ productId: P.redBean, qty: 4 }]);
    const res = await edit(o.id, o.stamp, { fulfillment: "DELIVERY" });
    expect(res).toMatchObject({ subtotalCents: 899, deliveryFeeCents: 700, totalCents: 1599 });
    const res2 = await edit(o.id, res.updatedAt, { items: [{ productId: P.redBean, qty: 5 }] }, new Date(NOW.getTime() + 1000));
    expect(res2).toMatchObject({ subtotalCents: 1148, deliveryFeeCents: 0, totalCents: 1148 });
  });

  it("merges duplicate lines before pricing", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    const res = await edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 2 }, { productId: P.redBean, qty: 2 }] });
    expect(res.subtotalCents).toBe(899);
    expect((await fetch(o.id)).items).toHaveLength(1);
  });

  it("recomputes cutoffAt from the new cart (adding brûlée moves it a day earlier)", async () => {
    const created = await createCustomerOrder(
      db,
      { items: [{ productId: P.redBean, qty: 1 }], pickupDate: A, fulfillment: "PICKUP", wechatId: "wx_c" },
      NOW,
    );
    const row0 = await db.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(row0.cutoffAt.toISOString()).toBe("2026-10-30T01:00:00.000Z");
    await edit(created.id, row0.updatedAt.toISOString(), {
      items: [{ productId: P.redBean, qty: 1 }, { productId: P.brulee, qty: 1 }],
    });
    expect((await fetch(created.id)).cutoffAt.toISOString()).toBe("2026-10-29T01:00:00.000Z");
  });

  it("recomputes cutoffAt across the DST change (11/02 bread -> 11/01 20:00 CST)", async () => {
    await createOpenDate("2026-11-02");
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await edit(o.id, o.stamp, { pickupDate: "2026-11-02" });
    expect((await fetch(o.id)).cutoffAt.toISOString()).toBe("2026-11-02T02:00:00.000Z");
  });

  it("a new ARCHIVED product is rejected; PAUSED is fine; archived products already on the order stay", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await db.product.update({ where: { id: P.rockCheese }, data: { status: "ARCHIVED" } });
    await db.product.update({ where: { id: P.cheeseHorn }, data: { status: "PAUSED" } });
    const err = await errorOf(edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 1 }, { productId: P.rockCheese, qty: 1 }] }));
    expect(err.code).toBe("PRODUCT_UNAVAILABLE");
    expect(err.extra?.productIds).toEqual([P.rockCheese]);
    const unknown = await errorOf(edit(o.id, o.stamp, { items: [{ productId: "00000000-0000-4000-8000-000000000000", qty: 1 }] }));
    expect(unknown.code).toBe("PRODUCT_UNAVAILABLE");

    const r = await edit(o.id, o.stamp, { items: [{ productId: P.redBean, qty: 1 }, { productId: P.cheeseHorn, qty: 1 }] });
    await db.product.update({ where: { id: P.redBean }, data: { status: "ARCHIVED" } });
    await edit(o.id, r.updatedAt, { items: [{ productId: P.redBean, qty: 3 }] }, new Date(NOW.getTime() + 1000));
    expect((await fetch(o.id)).items.map((i) => i.qty)).toEqual([3]);
  });
});

describe("adminEditOrder: validation, STALE, audit", () => {
  it("STALE when expectedUpdatedAt is old; nothing changes", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    const err = await errorOf(edit(o.id, "2026-01-01T00:00:00.000Z", { note: "x" }));
    expect(err.code).toBe("STALE");
    expect((await fetch(o.id)).note).toBeNull();
  });

  it("validates wechatId / note / items / empty edits", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    const bad: Omit<AdminEditOrderInput, "orderId" | "expectedUpdatedAt">[] = [
      { wechatId: "   " },
      { wechatId: "x".repeat(41) },
      { note: "字".repeat(301) },
      { items: [] },
      { items: [{ productId: P.redBean, qty: 0 }] },
      { pickupDate: "2026-02-30" },
      {},
    ];
    for (const b of bad) {
      expect((await errorOf(edit(o.id, o.stamp, b))).code).toBe("VALIDATION");
    }
    // Max lengths are fine; "" clears the note.
    const r = await edit(o.id, o.stamp, { wechatId: "x".repeat(40), note: "字".repeat(300) });
    await edit(o.id, r.updatedAt, { note: "" }, new Date(NOW.getTime() + 1000));
    expect((await fetch(o.id)).note).toBeNull();
  });

  it("writes order.edit with before / after of items, date, orderNo, fulfillment, wechatId, note, totals", async () => {
    const o = await placed([{ productId: P.redBean, qty: 1 }]);
    await edit(o.id, o.stamp, { items: [{ productId: P.cheeseHorn, qty: 4 }], wechatId: "wx_2", note: "n", fulfillment: "DELIVERY" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: o.id, action: "order.edit" } });
    expect(audit.actor).toBe("ADMIN");
    expect(audit.before).toMatchObject({
      orderNo: "1030-001",
      pickupDate: A,
      fulfillment: "PICKUP",
      note: null,
      items: [{ productId: P.redBean, name: "奶酥红豆包", qty: 1, lineTotalCents: 249 }],
      subtotalCents: 249,
      deliveryFeeCents: 0,
      totalCents: 249,
    });
    expect(audit.after).toMatchObject({
      orderNo: "1030-001",
      pickupDate: A,
      fulfillment: "DELIVERY",
      wechatId: "wx_2",
      note: "n",
      items: [{ productId: P.cheeseHorn, name: "奶酪角", qty: 4, lineTotalCents: 1099 }],
      subtotalCents: 1099,
      deliveryFeeCents: 500,
      totalCents: 1599,
    });
    expect(await db.orderItem.count({ where: { orderId: o.id } })).toBe(1);
  });
});
