// D115 / D116 end to end on Postgres: product weekdays (admin API logic + audit), menu,
// availability hints, customer rejection, owner override (create and edit).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { POST as AVAILABILITY } from "@/app/api/availability/route";
import { POST as ORDERS } from "@/app/api/orders/route";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { getMenu } from "@/server/menu";
import { adminEditOrder } from "@/server/orderAdmin";
import { createAdminOrder } from "@/server/orders";
import { createProduct, updateProduct } from "@/server/products";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";
import { jsonRequest, NOW } from "./api.helpers";

// NOW = Tue 10/20 12:00 CDT. 10/21 = Wed, 10/22 = Thu, 10/23 = Fri.
const WED = "2026-10-21";
const THU = "2026-10-22";
const FRI = "2026-10-23";

let ids: DefaultProductIds;
let puff: string;
let prevSecret: string | undefined;

beforeAll(() => {
  prevSecret = process.env.IP_HASH_SECRET;
  process.env.IP_HASH_SECRET = "test-secret";
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
  puff = (await createProduct(db, { name: "泡芙", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 20, pickupWeekdays: [3] }, NOW)).id;
  await createOpenDate(WED);
  await createOpenDate(THU);
  await createOpenDate(FRI);
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  if (prevSecret === undefined) delete process.env.IP_HASH_SECRET;
  else process.env.IP_HASH_SECRET = prevSecret;
  await db.$disconnect();
  await prisma.$disconnect();
});

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError");
}

let n = 0;
function orderBody(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    items: [{ productId: ids.redBean, qty: 2 }, { productId: puff, qty: 1 }],
    pickupDate: THU,
    fulfillment: "PICKUP",
    wechatId: `wx_wd_${n}`,
    note: "",
    idempotencyKey: crypto.randomUUID(),
    website: "",
    ...over,
  };
}

describe("product pickupWeekdays", () => {
  it("defaults to [] (every day) for existing and new products", async () => {
    const red = await db.product.findUniqueOrThrow({ where: { id: ids.redBean } });
    expect(red.pickupWeekdays).toEqual([]);
    const p = await db.product.findUniqueOrThrow({ where: { id: puff } });
    expect(p.pickupWeekdays).toEqual([3]);
  });

  it("PATCH normalises (sorted; all seven -> []) and writes the change to the AuditLog", async () => {
    const r1 = await updateProduct(db, ids.redBean, { pickupWeekdays: [6, 3] }, NOW);
    expect(r1.product.pickupWeekdays).toEqual([3, 6]);
    const r2 = await updateProduct(db, ids.redBean, { pickupWeekdays: [0, 1, 2, 3, 4, 5, 6] }, NOW);
    expect(r2.product.pickupWeekdays).toEqual([]);
    const audits = await db.auditLog.findMany({
      where: { entityId: ids.redBean, action: "product.update" },
      orderBy: { at: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect((audits[0].before as { pickupWeekdays: number[] }).pickupWeekdays).toEqual([]);
    expect((audits[0].after as { pickupWeekdays: number[] }).pickupWeekdays).toEqual([3, 6]);
    expect((audits[1].after as { pickupWeekdays: number[] }).pickupWeekdays).toEqual([]);
    // Same set in another order is no change (no audit row).
    await updateProduct(db, puff, { pickupWeekdays: [3] }, NOW);
    expect(await db.auditLog.count({ where: { entityId: puff, action: "product.update" } })).toBe(0);
  });

  it("rejects out-of-range, fractional and duplicate weekdays with VALIDATION", async () => {
    for (const bad of [[7], [-1], [1.5], [3, 3], "3", [null]]) {
      const e = await errorOf(updateProduct(db, ids.redBean, { pickupWeekdays: bad }, NOW));
      expect(e.code).toBe("VALIDATION");
    }
  });

  it("the database refuses out-of-range values and all seven days (CHECK)", async () => {
    await expect(
      db.$executeRaw`UPDATE "Product" SET "pickupWeekdays" = ARRAY[7] WHERE "id" = ${ids.redBean}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE "Product" SET "pickupWeekdays" = ARRAY[0,1,2,3,4,5,6] WHERE "id" = ${ids.redBean}::uuid`,
    ).rejects.toThrow();
  });

  it("menu carries pickupWeekdays", async () => {
    const menu = await getMenu(db);
    const byId = Object.fromEntries(menu.products.map((p) => [p.id, p.pickupWeekdays]));
    expect(byId[puff]).toEqual([3]);
    expect(byId[ids.redBean]).toEqual([]);
  });
});

describe("POST /api/availability with weekdays and hints", () => {
  it("WEEKDAY on Thu/Fri with a SPLIT WEEKDAY hint; Wed AVAILABLE", async () => {
    const res = await AVAILABILITY(
      jsonRequest("/api/availability", {
        items: [{ productId: ids.redBean, qty: 2 }, { productId: puff, qty: 1 }],
        fulfillment: "PICKUP",
      }),
    );
    const { dates } = await res.json();
    expect(dates.map((d: { date: string; state: string }) => [d.date, d.state])).toEqual([
      [WED, "AVAILABLE"],
      [THU, "WEEKDAY"],
      [FRI, "WEEKDAY"],
    ]);
    expect(dates[1]).toEqual({
      date: THU,
      state: "WEEKDAY",
      hints: [
        {
          kind: "SPLIT",
          reason: "WEEKDAY",
          here: [{ productId: ids.redBean, qty: 2 }],
          rest: [{ productId: puff, qty: 1 }],
          restDate: WED,
        },
      ],
    });
  });

  it("FULL day gets REDUCE + SPLIT CAPACITY hints with quantities only", async () => {
    // Thu: 1600 g limit, 红豆包 ×21 (1470 g) taken → 130 g left → one more 70 g bread fits.
    await createOrder({ date: THU, items: [{ productId: ids.redBean, qty: 21 }], status: "CONFIRMED" });
    const res = await AVAILABILITY(
      jsonRequest("/api/availability", { items: [{ productId: ids.redBean, qty: 3 }], fulfillment: "PICKUP" }),
    );
    const { dates } = await res.json();
    const thu = dates.find((d: { date: string }) => d.date === THU);
    expect(thu).toEqual({
      date: THU,
      state: "FULL",
      hints: [
        { kind: "REDUCE", remove: [{ productId: ids.redBean, qty: 2 }] },
        {
          kind: "SPLIT",
          reason: "CAPACITY",
          here: [{ productId: ids.redBean, qty: 1 }],
          rest: [{ productId: ids.redBean, qty: 2 }],
          restDate: WED,
        },
      ],
    });
    expect(JSON.stringify(thu)).not.toMatch(/doughG|limit|used|remaining|1470|1600/);
  });
});

describe("POST /api/orders weekday check", () => {
  it("rejects a weekday violation with WEEKDAY_UNAVAILABLE (409) and writes nothing", async () => {
    const res = await ORDERS(jsonRequest("/api/orders", orderBody(), { "x-forwarded-for": "203.0.113.9" }));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toBe("WEEKDAY_UNAVAILABLE");
    expect(j.message).toBe("有商品这一天不能取，请换一天或分开下单");
    expect(j.productIds).toEqual([puff]);
    expect(await db.order.count()).toBe(0);
  });

  it("WEEKDAY wins over FULL; Wednesday is accepted", async () => {
    await createOpenDate("2026-10-29", { doughLimitG: 0 }); // a full Thursday
    const res = await ORDERS(jsonRequest("/api/orders", orderBody({ pickupDate: "2026-10-29" })));
    expect((await res.json()).error).toBe("WEEKDAY_UNAVAILABLE");
    const ok = await ORDERS(jsonRequest("/api/orders", orderBody({ pickupDate: WED })));
    expect(ok.status).toBe(201);
  });

  it("the SPLIT here-part alone is accepted on Thu", async () => {
    const res = await ORDERS(jsonRequest("/api/orders", orderBody({ items: [{ productId: ids.redBean, qty: 2 }] })));
    expect(res.status).toBe(201);
  });
});

describe("owner override", () => {
  const adminInput = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: puff, qty: 2 }],
    pickupDate: THU,
    fulfillment: "PICKUP" as const,
    wechatId: "wx_phone",
    ...over,
  });

  it("admin create: OVER_LIMIT lists the WEEKDAY violation; override with reason saves and logs it", async () => {
    const e = await errorOf(createAdminOrder(db, adminInput(), NOW));
    expect(e.code).toBe("OVER_LIMIT");
    expect(e.extra?.violations).toEqual([{ kind: "WEEKDAY", date: THU, productId: puff, weekdays: [3] }]);

    const created = await createAdminOrder(db, adminInput({ override: true, reason: "老顾客周四顺路" }), NOW);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "order.override" } });
    expect(audit.reason).toBe("老顾客周四顺路");
    expect(audit.after).toEqual({ violations: [{ kind: "WEEKDAY", date: THU, productId: puff, weekdays: [3] }] });
  });

  it("admin edit: moving a 泡芙 order from Wed to Thu needs an override", async () => {
    const created = await createAdminOrder(db, adminInput({ pickupDate: WED }), NOW);
    const order = await db.order.findUniqueOrThrow({ where: { id: created.id } });
    const edit = (over: Record<string, unknown> = {}) =>
      adminEditOrder(
        db,
        { orderId: order.id, pickupDate: THU, expectedUpdatedAt: order.updatedAt.toISOString(), ...over },
        NOW,
      );
    const e = await errorOf(edit());
    expect(e.code).toBe("OVER_LIMIT");
    expect(e.extra?.violations).toEqual([{ kind: "WEEKDAY", date: THU, productId: puff, weekdays: [3] }]);
    await edit({ override: true, reason: "顾客改到周四" });
    const moved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(moved.pickupDate.toISOString().slice(0, 10)).toBe(THU);
    expect(await db.auditLog.count({ where: { entityId: order.id, action: "order.override" } })).toBe(1);
  });
});
