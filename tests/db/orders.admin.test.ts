// createAdminOrder (phone orders, CAPACITY_RULES §8), plus seq / tokens helpers.

import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LocalDate } from "@/domain/types";
import { toDbDate } from "@/server/dbDates";
import { AppError } from "@/server/errors";
import { createAdminOrder, type AdminCreateInput } from "@/server/orders";
import { allocateSeq, formatOrderNo } from "@/server/seq";
import { hashIp, newViewToken } from "@/server/tokens";
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
const NOW = new Date("2026-10-27T15:00:00Z"); // Chicago 10/27

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await db.$disconnect();
});

function input(over: Partial<AdminCreateInput> = {}): AdminCreateInput {
  return {
    items: [{ productId: P.redBean, qty: 1 }],
    pickupDate: DATE,
    fulfillment: "PICKUP",
    wechatId: "wx_phone",
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

const create = (over: Partial<AdminCreateInput> = {}, now: Date = NOW) =>
  createAdminOrder(db, input(over), now);

describe("createAdminOrder", () => {
  it("starts CONFIRMED, source ADMIN, ADMIN audit, no notification, no rate-limit hit", async () => {
    await createOpenDate(DATE);
    const r = await create({ items: [{ productId: P.cheeseHorn, qty: 5 }], fulfillment: "DELIVERY", note: "电话" });
    expect(r).toMatchObject({ orderNo: "1030-001", notificationId: null, replayed: false });
    const o = await db.order.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(o).toMatchObject({
      status: "CONFIRMED",
      source: "ADMIN",
      ipHash: null,
      idempotencyKey: null,
      note: "电话",
      subtotalCents: 1398, // P4
      deliveryFeeCents: 500,
      totalCents: 1898,
    });
    expect(o.confirmedAt?.toISOString()).toBe(NOW.toISOString());
    expect(o.cutoffAt.toISOString()).toBe("2026-10-30T01:00:00.000Z");
    const audit = await db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "ADMIN", action: "order.create", entityId: r.id });
    expect(await db.notification.count()).toBe(0);
    expect(await db.rateLimitHit.count()).toBe(0);
  });

  it("ignores the ordering switch, the cutoff, the per-item max and rate limits; same day ok", async () => {
    await createSettings({ orderingEnabled: false });
    await createOpenDate("2026-10-27", { doughLimitG: 5000 }); // today
    const late = new Date("2026-10-28T03:00:00Z"); // 10/27 22:00 CDT, long past cutoff
    for (let i = 0; i < 3; i++) {
      await expect(
        create({ pickupDate: "2026-10-27", items: [{ productId: P.redBean, qty: 9 }] }, late),
      ).resolves.toBeTruthy();
    }
    expect(await db.order.count({ where: { status: "CONFIRMED" } })).toBe(3);
  });

  it("DATE_CLOSED: past date, closed date, missing date", async () => {
    await createOpenDate("2026-10-26");
    await createOpenDate(DATE, { isOpen: false });
    expect((await errorOf(create({ pickupDate: "2026-10-26" }))).code).toBe("DATE_CLOSED");
    expect((await errorOf(create()))).toMatchObject({ code: "DATE_CLOSED" });
    expect((await errorOf(create({ pickupDate: "2026-11-05" }))).code).toBe("DATE_CLOSED");
  });

  it("PAUSED products allowed; ARCHIVED and unknown -> PRODUCT_UNAVAILABLE", async () => {
    await createOpenDate(DATE);
    await db.product.update({ where: { id: P.rockCheese }, data: { status: "PAUSED" } });
    await db.product.update({ where: { id: P.cheeseHorn }, data: { status: "ARCHIVED" } });
    await expect(create({ items: [{ productId: P.rockCheese, qty: 2 }] })).resolves.toBeTruthy();
    const e = await errorOf(create({ items: [{ productId: P.cheeseHorn, qty: 1 }] }));
    expect(e.code).toBe("PRODUCT_UNAVAILABLE");
    expect(e.extra).toEqual({ productIds: [P.cheeseHorn] });
    expect((await errorOf(create({ items: [{ productId: "00000000-0000-4000-8000-000000000000", qty: 1 }] }))).code).toBe(
      "PRODUCT_UNAVAILABLE",
    );
  });

  it("OVER_LIMIT lists all violations and writes nothing", async () => {
    await createOpenDate(DATE, { doughLimitG: 100, deliveryLimit: 1 });
    await db.openDateProductLimit.create({ data: { date: toDbDate(DATE), productId: P.brulee, limit: 1 } });
    await createOrder({ date: DATE, items: [{ productId: P.brulee, qty: 1 }], fulfillment: "DELIVERY", status: "CONFIRMED" });
    const before = await db.order.count();

    const e = await errorOf(
      create({
        items: [
          { productId: P.redBean, qty: 2 },
          { productId: P.brulee, qty: 2 },
        ],
        fulfillment: "DELIVERY",
      }),
    );
    expect(e.code).toBe("OVER_LIMIT");
    expect(e.extra!.violations).toEqual([
      { kind: "DOUGH", date: DATE, limit: 100, after: 140, over: 40 },
      { kind: "PRODUCT", date: DATE, productId: P.brulee, limit: 1, after: 3, over: 2 },
      { kind: "DELIVERY", date: DATE, limit: 1, after: 2, over: 1 },
    ]);
    expect(await db.order.count()).toBe(before);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("override without a (non-blank) reason -> VALIDATION", async () => {
    await createOpenDate(DATE, { doughLimitG: 0 });
    for (const reason of [undefined, null, "", "   "]) {
      const e = await errorOf(create({ override: true, reason }));
      expect(e.code).toBe("VALIDATION");
      expect(Object.keys(e.extra!.fields as object)).toEqual(["reason"]);
    }
    expect(await db.order.count()).toBe(0);
  });

  it("override with reason persists the order and writes order.override with reason + violations", async () => {
    await createOpenDate(DATE, { deliveryEnabled: false, doughLimitG: 70 });
    const r = await create({
      items: [{ productId: P.redBean, qty: 2 }],
      fulfillment: "DELIVERY",
      override: true,
      reason: "  老顾客，多做两个 ",
    });
    const o = await db.order.findUniqueOrThrow({ where: { id: r.id } });
    expect(o.status).toBe("CONFIRMED");
    const audits = await db.auditLog.findMany({ where: { entityId: r.id }, orderBy: { action: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["order.create", "order.override"]);
    expect(audits[1]).toMatchObject({
      actor: "ADMIN",
      reason: "老顾客，多做两个",
      after: {
        violations: [
          { kind: "DOUGH", date: DATE, limit: 70, after: 140, over: 70 },
          { kind: "DELIVERY_DISABLED", date: DATE },
        ],
      },
    });
  });

  it("override on an order that fits writes no order.override", async () => {
    await createOpenDate(DATE);
    const r = await create({ override: true, reason: "以防万一" });
    const actions = (await db.auditLog.findMany({ where: { entityId: r.id } })).map((a) => a.action);
    expect(actions).toEqual(["order.create"]);
  });

  it("continues the day's seq after customer orders", async () => {
    await createOpenDate(DATE);
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }] });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], status: "CANCELLED" });
    expect((await create()).orderNo).toBe("1030-003");
  });
});

describe("seq and tokens", () => {
  it("formatOrderNo pads NNN to at least 3 digits", () => {
    expect(formatOrderNo("2026-01-05", 3)).toBe("0105-003");
    expect(formatOrderNo("2026-10-24", 42)).toBe("1024-042");
    expect(formatOrderNo("2026-10-24", 1234)).toBe("1024-1234");
    expect(() => formatOrderNo("2026-10-24", 0)).toThrow();
  });

  it("allocateSeq returns max(seq)+1 for the date only", async () => {
    await createOpenDate(DATE);
    await createOpenDate("2026-10-31");
    expect(await db.$transaction((tx) => allocateSeq(tx, DATE))).toEqual({ seq: 1, orderNo: "1030-001" });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }] });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 1 }], status: "REJECTED" });
    expect(await db.$transaction((tx) => allocateSeq(tx, DATE))).toEqual({ seq: 3, orderNo: "1030-003" });
    expect(await db.$transaction((tx) => allocateSeq(tx, "2026-10-31"))).toEqual({ seq: 1, orderNo: "1031-001" });
  });

  it("newViewToken is 43 base64url chars and random", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newViewToken()));
    expect(tokens.size).toBe(100);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashIp is sha256 hex of ip + secret", () => {
    const expected = createHash("sha256").update("1.2.3.4s3cret").digest("hex");
    expect(hashIp("1.2.3.4", "s3cret")).toBe(expected);
    expect(hashIp("1.2.3.4", "other")).not.toBe(expected);
    expect(() => hashIp("1.2.3.4", "")).toThrow();
  });
});
