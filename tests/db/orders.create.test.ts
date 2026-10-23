// createCustomerOrder: every error path in step order, rate limits, FULL suggestion,
// server-side pricing, line merging, and atomicity of the writes.

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { copy } from "@/copy";
import type { CartLine, Fulfillment, LocalDate } from "@/domain/types";
import { toDbDate } from "@/server/dbDates";
import { AppError } from "@/server/errors";
import { createCustomerOrder, type CreateOrderInput } from "@/server/orders";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const DATE: LocalDate = "2026-10-30"; // Fri
const NOW = new Date("2026-10-27T15:00:00Z"); // Tue 10:00 CDT
const BREAD_CUTOFF = new Date("2026-10-30T01:00:00Z"); // C1: Thu 10/29 20:00 CDT
const BRULEE_CUTOFF = new Date("2026-10-29T01:00:00Z"); // C2: Wed 10/28 20:00 CDT

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await db.$disconnect();
});

let n = 0;
function input(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
  n += 1;
  return {
    items: [{ productId: P.redBean, qty: 1 }],
    pickupDate: DATE,
    fulfillment: "PICKUP",
    wechatId: `wx_${n}`,
    ipHash: `ip_${n}`,
    ...over,
  };
}

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError, but the call succeeded");
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  return (await errorOf(p)).code;
}

const create = (over: Partial<CreateOrderInput> = {}, now: Date = NOW) =>
  createCustomerOrder(db, input(over), now);

async function expectNothingWritten() {
  expect(await db.order.count()).toBe(0);
  expect(await db.orderItem.count()).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
  expect(await db.rateLimitHit.count()).toBe(0);
}

describe("createCustomerOrder: success", () => {
  it("writes Order, items, RateLimitHit, audit and NEW_ORDER notification", async () => {
    await createOpenDate(DATE);
    const note = "  少糖 ";
    const r = await create({
      items: [{ productId: P.redBean, qty: 4 }],
      wechatId: "  bunny_fan_01 ",
      note,
      ipHash: "abc",
    });
    expect(r.replayed).toBe(false);
    expect(r.orderNo).toBe("1030-001");
    expect(r.viewToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const order = await db.order.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(order).toMatchObject({
      seq: 1,
      status: "NEW",
      source: "WEB",
      wechatId: "bunny_fan_01",
      note: "少糖",
      ipHash: "abc",
      idempotencyKey: null,
      confirmedAt: null,
      fulfillment: "PICKUP",
      subtotalCents: 899,
      deliveryFeeCents: 0,
      totalCents: 899,
    });
    expect(order.cutoffAt.toISOString()).toBe(BREAD_CUTOFF.toISOString());
    expect(order.createdAt.toISOString()).toBe(NOW.toISOString());

    const hits = await db.rateLimitHit.findMany();
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe("order_ip:abc");
    expect(hits[0].at.toISOString()).toBe(NOW.toISOString());

    const audit = await db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "CUSTOMER",
      action: "order.create",
      entityType: "Order",
      entityId: r.id,
      before: null,
      reason: null,
    });
    expect(audit[0].after).toMatchObject({
      orderNo: "1030-001",
      pickupDate: DATE,
      status: "NEW",
      totalCents: 899,
      items: [{ productId: P.redBean, qty: 4, lineTotalCents: 899 }],
    });

    const notes = await db.notification.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: r.notificationId,
      kind: "NEW_ORDER",
      dedupeKey: `new_order:${r.id}`,
      payload: { orderId: r.id },
      status: "PENDING",
    });
  });

  it("empty note becomes null; null ipHash skips the RateLimitHit row", async () => {
    await createOpenDate(DATE);
    const r = await create({ note: "   ", ipHash: null });
    const order = await db.order.findUniqueOrThrow({ where: { id: r.id } });
    expect(order.note).toBeNull();
    expect(order.ipHash).toBeNull();
    expect(await db.rateLimitHit.count()).toBe(0);
  });

  it("sequential replay of an idempotencyKey returns the same order without writing", async () => {
    await createOpenDate(DATE);
    const idempotencyKey = randomUUID();
    const first = await create({ idempotencyKey, wechatId: "wx_replay" });
    // Even after ordering is switched off and the cutoff has passed.
    await createSettings({ orderingEnabled: false });
    const again = await create({ idempotencyKey, wechatId: "wx_replay", ipHash: "another_ip" }, new Date("2026-10-30T12:00:00Z"));
    expect(again).toEqual({ ...first, notificationId: null, replayed: true });
    expect(await db.order.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.rateLimitHit.count()).toBe(1);
  });

  it("replay with the same key but another wechatId -> generic VALIDATION, no token, no writes", async () => {
    await createOpenDate(DATE);
    const idempotencyKey = randomUUID();
    const first = await create({ idempotencyKey, wechatId: "wx_owner" });
    const e = await errorOf(create({ idempotencyKey, wechatId: "wx_stranger" }));
    expect(e.code).toBe("VALIDATION");
    expect(e.message).toBe(copy.errors.fallback);
    expect(JSON.stringify({ message: e.message, extra: e.extra })).not.toContain(first.viewToken);
    expect(JSON.stringify(e.extra)).not.toContain(first.id);
    expect(await db.order.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.notification.count()).toBe(1);
    expect(await db.rateLimitHit.count()).toBe(1);
    // The rightful owner still gets a replay (wechatId compared after trimming).
    await expect(create({ idempotencyKey, wechatId: "  wx_owner " })).resolves.toMatchObject({
      viewToken: first.viewToken,
      replayed: true,
    });
  });

  it("replay with the same key and wechatId but another pickupDate -> VALIDATION, no writes", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    const idempotencyKey = randomUUID();
    const first = await create({ idempotencyKey, wechatId: "wx_owner" });
    const e = await errorOf(create({ idempotencyKey, wechatId: "wx_owner", pickupDate: "2026-10-31" }));
    expect(e.code).toBe("VALIDATION");
    expect(e.message).toBe(copy.errors.fallback);
    expect(JSON.stringify(e.extra)).not.toContain(first.viewToken);
    expect(await db.order.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("idempotencyKey must be a v4 UUID (nil, max, v1, v7 rejected)", async () => {
    await createOpenDate(DATE);
    for (const key of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8", // v1
      "01890a5d-ac96-774b-bcce-b302099a8057", // v7
    ]) {
      const e = await errorOf(create({ idempotencyKey: key }));
      expect(e.code).toBe("VALIDATION");
      expect(Object.keys(e.extra!.fields as object)).toEqual(["idempotencyKey"]);
    }
    expect(await db.order.count()).toBe(0);
  });

  it("cutoff: 1 s before is ok; exactly at cutoff -> CUTOFF_PASSED", async () => {
    await createOpenDate(DATE);
    const before = new Date(BREAD_CUTOFF.getTime() - 1000);
    await expect(create({}, before)).resolves.toMatchObject({ replayed: false });
    expect(await codeOf(create({}, BREAD_CUTOFF))).toBe("CUTOFF_PASSED");
  });

  it("cutoff uses the max leadDays of the cart (brûlée = 2 days)", async () => {
    await createOpenDate(DATE);
    const items = [
      { productId: P.redBean, qty: 1 },
      { productId: P.brulee, qty: 1 },
    ];
    expect(await codeOf(create({ items }, BRULEE_CUTOFF))).toBe("CUTOFF_PASSED");
    const r = await create({ items }, new Date(BRULEE_CUTOFF.getTime() - 1000));
    const order = await db.order.findUniqueOrThrow({ where: { id: r.id } });
    expect(order.cutoffAt.toISOString()).toBe(BRULEE_CUTOFF.toISOString());
  });

  it("cutoff across the DST change (C4: 11/02 pickup -> 11/01 20:00 CST = 02:00Z)", async () => {
    await createOpenDate("2026-11-02");
    const cutoff = new Date("2026-11-02T02:00:00Z");
    expect(await codeOf(create({ pickupDate: "2026-11-02" }, cutoff))).toBe("CUTOFF_PASSED");
    const r = await create({ pickupDate: "2026-11-02" }, new Date(cutoff.getTime() - 1000));
    expect((await db.order.findUniqueOrThrow({ where: { id: r.id } })).cutoffAt.toISOString()).toBe(
      cutoff.toISOString(),
    );
  });
});

describe("createCustomerOrder: errors in step order", () => {
  it("VALIDATION lists fields and writes nothing", async () => {
    await createOpenDate(DATE);
    const e = await errorOf(
      create({
        items: [{ productId: "not-a-uuid", qty: 0 }],
        pickupDate: "2026-02-30",
        fulfillment: "BOAT" as Fulfillment,
        wechatId: "   ",
        note: "x".repeat(301),
        idempotencyKey: "nope",
      }),
    );
    expect(e.code).toBe("VALIDATION");
    expect(e.httpStatus).toBe(422);
    expect(Object.keys(e.extra!.fields as object).sort()).toEqual(
      ["fulfillment", "idempotencyKey", "items.0.productId", "items.0.qty", "note", "pickupDate", "wechatId"].sort(),
    );
    await expectNothingWritten();
  });

  it("VALIDATION: empty cart, qty > 100, fractional qty, 41-char wechat", async () => {
    await createOpenDate(DATE);
    expect(await codeOf(create({ items: [] }))).toBe("VALIDATION");
    expect(await codeOf(create({ items: [{ productId: P.redBean, qty: 101 }] }))).toBe("VALIDATION");
    expect(await codeOf(create({ items: [{ productId: P.redBean, qty: 1.5 }] }))).toBe("VALIDATION");
    expect(await codeOf(create({ wechatId: "a".repeat(41) }))).toBe("VALIDATION");
    // 40 code points is fine even when they are astral (char_length in the DB CHECK).
    await expect(create({ wechatId: "🐰".repeat(40) })).resolves.toBeTruthy();
    await expect(create({ note: "🐰".repeat(300) })).resolves.toBeTruthy();
  });

  it("ORDERING_DISABLED", async () => {
    await createSettings({ orderingEnabled: false });
    await createOpenDate(DATE);
    expect(await codeOf(create())).toBe("ORDERING_DISABLED");
    await expectNothingWritten();
  });

  it("ordering off beats a closed / missing date", async () => {
    await createSettings({ orderingEnabled: false });
    await createOpenDate(DATE, { isOpen: false });
    expect(await codeOf(create())).toBe("ORDERING_DISABLED");
    expect(await codeOf(create({ pickupDate: "2026-11-05" }))).toBe("ORDERING_DISABLED");
  });

  it("DATE_CLOSED: no row, isOpen false, today, past", async () => {
    await createOpenDate(DATE, { isOpen: false });
    await createOpenDate("2026-10-27"); // today in Chicago
    await createOpenDate("2026-10-26");
    expect(await codeOf(create())).toBe("DATE_CLOSED");
    expect(await codeOf(create({ pickupDate: "2026-11-05" }))).toBe("DATE_CLOSED");
    expect(await codeOf(create({ pickupDate: "2026-10-27" }))).toBe("DATE_CLOSED");
    expect(await codeOf(create({ pickupDate: "2026-10-26" }))).toBe("DATE_CLOSED");
    await expectNothingWritten();
  });

  it("DATE_CLOSED beats unavailable products", async () => {
    await db.product.update({ where: { id: P.redBean }, data: { status: "PAUSED" } });
    expect(await codeOf(create())).toBe("DATE_CLOSED");
  });

  it("PRODUCT_UNAVAILABLE: paused, archived, unknown", async () => {
    await createOpenDate(DATE);
    await db.product.update({ where: { id: P.rockCheese }, data: { status: "PAUSED" } });
    await db.product.update({ where: { id: P.cheeseHorn }, data: { status: "ARCHIVED" } });
    const paused = await errorOf(create({ items: [{ productId: P.rockCheese, qty: 1 }] }));
    expect(paused.code).toBe("PRODUCT_UNAVAILABLE");
    expect(paused.extra).toEqual({ productIds: [P.rockCheese] });
    expect(await codeOf(create({ items: [{ productId: P.cheeseHorn, qty: 1 }] }))).toBe("PRODUCT_UNAVAILABLE");
    expect(await codeOf(create({ items: [{ productId: randomUUID(), qty: 1 }] }))).toBe("PRODUCT_UNAVAILABLE");
    await expectNothingWritten();
  });

  it("PRODUCT_UNAVAILABLE beats QTY_LIMIT", async () => {
    await createOpenDate(DATE);
    await db.product.update({ where: { id: P.rockCheese }, data: { status: "PAUSED" } });
    const items = [
      { productId: P.redBean, qty: 9 },
      { productId: P.rockCheese, qty: 1 },
    ];
    expect(await codeOf(create({ items }))).toBe("PRODUCT_UNAVAILABLE");
  });

  it("QTY_LIMIT on the merged quantity per product", async () => {
    await createOpenDate(DATE);
    const e = await errorOf(create({ items: [{ productId: P.redBean, qty: 9 }] }));
    expect(e.code).toBe("QTY_LIMIT");
    expect(e.extra).toEqual({ productIds: [P.redBean] });
    const split = [
      { productId: P.redBean, qty: 5 },
      { productId: P.redBean, qty: 4 },
    ];
    expect(await codeOf(create({ items: split }))).toBe("QTY_LIMIT");
    await expect(create({ items: [{ productId: P.redBean, qty: 8 }] })).resolves.toBeTruthy();
  });

  it("QTY_LIMIT beats CUTOFF_PASSED", async () => {
    await createOpenDate(DATE);
    expect(await codeOf(create({ items: [{ productId: P.redBean, qty: 9 }] }, BREAD_CUTOFF))).toBe("QTY_LIMIT");
  });

  it("CUTOFF_PASSED beats RATE_LIMITED and FULL", async () => {
    await createOpenDate(DATE, { doughLimitG: 0 });
    for (let i = 0; i < 3; i++) await db.rateLimitHit.create({ data: { key: "order_ip:same", at: NOW } });
    const late = new Date(BREAD_CUTOFF.getTime() + 1);
    expect(await codeOf(create({ ipHash: "same" }, late))).toBe("CUTOFF_PASSED");
  });

  it("RATE_LIMITED beats FULL", async () => {
    await createOpenDate(DATE, { doughLimitG: 0 });
    for (let i = 0; i < 3; i++) await db.rateLimitHit.create({ data: { key: "order_ip:same", at: NOW } });
    expect(await codeOf(create({ ipHash: "same" }))).toBe("RATE_LIMITED");
  });

  it("FULL when dough would go over; DELIVERY_FULL when only delivery is over", async () => {
    await createOpenDate(DATE, { doughLimitG: 140, deliveryLimit: 0 });
    expect(await codeOf(create({ items: [{ productId: P.redBean, qty: 3 }] }))).toBe("FULL");
    // Dough and delivery both over -> FULL wins.
    expect(await codeOf(create({ items: [{ productId: P.redBean, qty: 3 }], fulfillment: "DELIVERY" }))).toBe("FULL");
    const e = await errorOf(create({ fulfillment: "DELIVERY" }));
    expect(e.code).toBe("DELIVERY_FULL");
    expect(e.message).toBe(copy.errors.DELIVERY_FULL);
    await expectNothingWritten();
    await expect(create({ fulfillment: "PICKUP" })).resolves.toBeTruthy();
  });

  it("DELIVERY_FULL when delivery is disabled that day", async () => {
    await createOpenDate(DATE, { deliveryEnabled: false });
    expect(await codeOf(create({ fulfillment: "DELIVERY" }))).toBe("DELIVERY_FULL");
  });

  it("D48: a brûlée-only order still fits on a day whose dough is over", async () => {
    await createOpenDate(DATE, { doughLimitG: 70 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 2 }], status: "CONFIRMED" });
    await expect(create({ items: [{ productId: P.brulee, qty: 2 }] })).resolves.toBeTruthy();
    expect(await codeOf(create())).toBe("FULL");
  });
});

describe("createCustomerOrder: rate limits (D38)", () => {
  it("4th order from the same IP within an hour -> RATE_LIMITED; ok again after an hour", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    await create({ ipHash: "same" }, NOW);
    await create({ ipHash: "same", pickupDate: "2026-10-31" }, new Date(NOW.getTime() + 10 * 60_000));
    await create({ ipHash: "same" }, new Date(NOW.getTime() + 20 * 60_000));
    const fourth = new Date(NOW.getTime() + 30 * 60_000);
    const e = await errorOf(create({ ipHash: "same", pickupDate: "2026-10-31" }, fourth));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.httpStatus).toBe(429);
    expect(await db.rateLimitHit.count()).toBe(3);
    // Other IPs and a null ipHash are unaffected.
    await expect(create({ ipHash: "other" }, fourth)).resolves.toBeTruthy();
    await expect(create({ ipHash: null }, fourth)).resolves.toBeTruthy();
    // Exactly one hour after the first hit it no longer counts.
    await expect(create({ ipHash: "same" }, new Date(NOW.getTime() + 60 * 60_000))).resolves.toBeTruthy();
  });

  it("3rd unconfirmed order for the same wechat/date -> RATE_LIMITED", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    await create({ wechatId: "wx_same" });
    await create({ wechatId: "wx_same" });
    expect(await codeOf(create({ wechatId: "wx_same" }))).toBe("RATE_LIMITED");
    // Other date is fine; matching is on the trimmed id.
    await expect(create({ wechatId: "wx_same", pickupDate: "2026-10-31" })).resolves.toBeTruthy();
    expect(await codeOf(create({ wechatId: " wx_same " }))).toBe("RATE_LIMITED");
  });

  it("CONTACTED counts; confirmed and cancelled orders don't", async () => {
    await createOpenDate(DATE);
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], wechatId: "wx_c", status: "CONFIRMED" });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], wechatId: "wx_c", status: "CANCELLED" });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], wechatId: "wx_c", status: "CONTACTED" });
    await expect(create({ wechatId: "wx_c" })).resolves.toBeTruthy(); // 2nd unconfirmed
    expect(await codeOf(create({ wechatId: "wx_c" }))).toBe("RATE_LIMITED");
  });
});

describe("createCustomerOrder: FULL suggestion (§7.1)", () => {
  it("suggests the first later open day that fits the whole cart", async () => {
    await createOpenDate(DATE, { doughLimitG: 100 });
    await createOpenDate("2026-10-31", { isOpen: false });
    await createOpenDate("2026-11-01", { doughLimitG: 200 }); // fits 2 red beans, not 3
    await createOpenDate("2026-11-02", { deliveryEnabled: false }); // fulfillment matters
    await createOpenDate("2026-11-03");
    const items = [{ productId: P.redBean, qty: 3 }];
    const pickup = await errorOf(create({ items }));
    expect(pickup.code).toBe("FULL");
    expect(pickup.extra).toEqual({ suggestion: "2026-11-02" });
    expect(pickup.message).toBe(copy.errors.FULL);

    const delivery = await errorOf(create({ items, fulfillment: "DELIVERY" }));
    expect(delivery.extra).toEqual({ suggestion: "2026-11-03" });
    await expectNothingWritten();
  });

  it("suggestion is null (with FULL_NO_SUGGESTION copy) when no day fits", async () => {
    await createOpenDate(DATE, { doughLimitG: 100 });
    await createOpenDate("2026-10-29", { doughLimitG: 1600 }); // earlier days are never suggested
    await createOpenDate("2026-12-31"); // beyond today + 60
    const e = await errorOf(create({ items: [{ productId: P.redBean, qty: 3 }] }));
    expect(e.code).toBe("FULL");
    expect(e.extra).toEqual({ suggestion: null });
    expect(e.message).toBe(copy.errors.FULL_NO_SUGGESTION);
  });
});

describe("createCustomerOrder: pricing and merging", () => {
  async function priced(items: CartLine[], fulfillment: Fulfillment) {
    const r = await create({ items, fulfillment });
    return db.order.findUniqueOrThrow({
      where: { id: r.id },
      include: { items: { orderBy: { lineTotalCents: "asc" } } },
    });
  }

  it("P7: red bean 4 + rock cheese 4 + cheese horn 4, delivery -> $28.97, free delivery", async () => {
    await createOpenDate(DATE);
    const o = await priced(
      [
        { productId: P.redBean, qty: 4 },
        { productId: P.rockCheese, qty: 4 },
        { productId: P.cheeseHorn, qty: 4 },
      ],
      "DELIVERY",
    );
    expect([o.subtotalCents, o.deliveryFeeCents, o.totalCents]).toEqual([2897, 0, 2897]);
    expect(o.items.map((i) => i.lineTotalCents)).toEqual([899, 899, 1099]);
  });

  it("P9: cheese horn 8 + red bean 1, delivery -> $24.47 + $5.00", async () => {
    await createOpenDate(DATE);
    const o = await priced(
      [
        { productId: P.cheeseHorn, qty: 8 },
        { productId: P.redBean, qty: 1 },
      ],
      "DELIVERY",
    );
    expect([o.subtotalCents, o.deliveryFeeCents, o.totalCents]).toEqual([2447, 500, 2947]);
  });

  it("prices come from the DB and are snapshotted; client amounts are ignored", async () => {
    await createOpenDate(DATE);
    await db.product.update({
      where: { id: P.redBean },
      data: { unitPriceCents: 300, bundlePriceCents: 1000, bundleSize: 3, name: "新红豆包" },
    });
    await db.setting.update({ where: { id: 1 }, data: { deliveryFeeCents: 700, freeDeliveryMinCents: 5000 } });
    const tampered = {
      ...input({ items: [{ productId: P.redBean, qty: 4 }], fulfillment: "DELIVERY" }),
      subtotalCents: 1,
      totalCents: 1,
      deliveryFeeCents: 0,
    } as CreateOrderInput;
    const r = await createCustomerOrder(db, tampered, NOW);
    // Price change after the order does not affect it.
    await db.product.update({ where: { id: P.redBean }, data: { unitPriceCents: 999, name: "改名" } });

    const o = await db.order.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect([o.subtotalCents, o.deliveryFeeCents, o.totalCents]).toEqual([1300, 700, 2000]);
    expect(o.items[0]).toMatchObject({
      nameSnapshot: "新红豆包",
      qty: 4,
      unitPriceCents: 300,
      bundleSize: 3,
      bundlePriceCents: 1000,
      lineTotalCents: 1300,
    });
  });

  it("duplicate lines of the same product are merged before pricing (2 + 2 = bundle of 4)", async () => {
    await createOpenDate(DATE);
    const o = await priced(
      [
        { productId: P.redBean, qty: 2 },
        { productId: P.brulee, qty: 1 },
        { productId: P.redBean, qty: 2 },
      ],
      "PICKUP",
    );
    expect(o.items).toHaveLength(2);
    expect(o.items.find((i) => i.productId === P.redBean)).toMatchObject({ qty: 4, lineTotalCents: 899 });
    expect(o.subtotalCents).toBe(899 + 249);
  });
});

describe("createCustomerOrder: atomicity", () => {
  it("a failure after the order insert rolls back order, items, audit, notification and hit", async () => {
    await createOpenDate(DATE);
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION m2b_fail_notification() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER m2b_fail_notification BEFORE INSERT ON "Notification"
      FOR EACH ROW EXECUTE FUNCTION m2b_fail_notification()`);
    try {
      await expect(create({ ipHash: "x", idempotencyKey: randomUUID() })).rejects.toThrow(/forced failure/);
      await expectNothingWritten();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS m2b_fail_notification ON "Notification"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS m2b_fail_notification()`);
    }
    // The day is usable again and seq starts at 1.
    const r = await create();
    expect(r.orderNo).toBe("1030-001");
    expect(await db.order.count({ where: { pickupDate: toDbDate(DATE) } })).toBe(1);
  });
});
