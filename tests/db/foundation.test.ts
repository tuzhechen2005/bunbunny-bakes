import { execFileSync } from "node:child_process";
import { verify } from "@node-rs/argon2";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkDay, usage } from "@/domain/capacity";
import { copy } from "@/copy";
import type { LocalDate } from "@/domain/types";
import type { Tx } from "@/server/db";
import { createPrismaClient } from "@/server/db";
import { fromDbDate, toDbDate } from "@/server/dbDates";
import { AppError, ERROR_CODES } from "@/server/errors";
import {
  loadDayContext,
  loadProductMap,
  loadSettings,
  lockOpenDate,
  lockOpenDates,
} from "@/server/day";
import { writeAudit } from "@/server/audit";
import { enqueueNotification } from "@/server/outbox";
import { seed } from "../../prisma/seed";
import {
  TEST_DATABASE_URL,
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
} from "./helpers";
import { testDirectDatabaseUrl } from "./testDbUrl";

const ADMIN_ENV = { ADMIN_USERNAME: "owner", ADMIN_INITIAL_PASSWORD: "correct-horse-42" };
// The CLI gets the direct URL (Neon: non-pooled), as in production; locally both are the same.
const CHILD_ENV = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: testDirectDatabaseUrl() };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asserts the promise fails because of the named CHECK constraint. */
async function expectCheck(p: Promise<unknown>, constraint: string): Promise<void> {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, `expected ${constraint} to reject`).toBeDefined();
  const e = err as { message?: string; meta?: unknown };
  const text = `${e.message ?? ""} ${JSON.stringify(e.meta ?? {})}`;
  expect(text).toContain(constraint);
}

/** Raw-SQL product insert with sane defaults; `cols` override them. */
function insertProduct(cols: Record<string, string | number | null>) {
  const base: Record<string, string | number | null> = {
    id: "00000000-0000-0000-0000-0000000000aa",
    name: "x",
    unitPriceCents: 100,
    bundleSize: 4,
    bundlePriceCents: null,
    capacityMode: "DOUGH_PER_UNIT",
    doughG: 70,
    roundG: null,
    piecesPerRound: null,
    dailyLimit: null,
    batchYield: null,
    leadDays: 1,
    ...cols,
  };
  const names = Object.keys(base).map((k) => `"${k}"`);
  const values = Object.keys(base).map((k, i) =>
    k === "capacityMode" ? `$${i + 1}::"CapacityMode"` : k === "id" ? `$${i + 1}::uuid` : `$${i + 1}`,
  );
  return db.$executeRawUnsafe(
    `INSERT INTO "Product" (${names.join(", ")}) VALUES (${values.join(", ")})`,
    ...Object.values(base),
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("migration + seed", () => {
  it("migrate deploy is a no-op the second time and status is clean", () => {
    const out = execFileSync("npx", ["prisma", "migrate", "deploy"], { env: CHILD_ENV }).toString();
    expect(out).toMatch(/No pending migrations/);
    const status = execFileSync("npx", ["prisma", "migrate", "status"], { env: CHILD_ENV }).toString();
    expect(status).toMatch(/Database schema is up to date/);
    expect(status).toContain(decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1)));
  });

  it("seed creates settings, 4 products and the admin, and is idempotent", async () => {
    const first = await seed(db, ADMIN_ENV);
    expect(first).toEqual({ settingCreated: true, productsCreated: 4, adminCreated: true });

    // Owner changes things between runs; the second run must keep them.
    await db.setting.update({ where: { id: 1 }, data: { orderingEnabled: true, defaultDoughLimitG: 2000 } });
    const second = await seed(db, { ADMIN_USERNAME: "someoneelse", ADMIN_INITIAL_PASSWORD: "another-password-1" });
    expect(second).toEqual({ settingCreated: false, productsCreated: 0, adminCreated: false });

    const settings = await db.setting.findMany();
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ id: 1, orderingEnabled: true, defaultDoughLimitG: 2000 });

    const products = await db.product.findMany({ orderBy: { sortOrder: "asc" } });
    expect(
      products.map((p) => ({
        name: p.name,
        unit: p.unitPriceCents,
        bundle: p.bundlePriceCents,
        size: p.bundleSize,
        mode: p.capacityMode,
        doughG: p.doughG,
        roundG: p.roundG,
        pieces: p.piecesPerRound,
        dailyLimit: p.dailyLimit,
        batchYield: p.batchYield,
        leadDays: p.leadDays,
        status: p.status,
        description: p.description,
      })),
    ).toEqual([
      { name: "奶酥红豆包", unit: 249, bundle: 899, size: 4, mode: "DOUGH_PER_UNIT", doughG: 70, roundG: null, pieces: null, dailyLimit: null, batchYield: null, leadDays: 1, status: "ACTIVE", description: "简介待补充" },
      { name: "岩烧乳酪包", unit: 249, bundle: 899, size: 4, mode: "DOUGH_PER_UNIT", doughG: 70, roundG: null, pieces: null, dailyLimit: null, batchYield: null, leadDays: 1, status: "ACTIVE", description: "简介待补充" },
      { name: "奶酪角", unit: 299, bundle: 1099, size: 4, mode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, pieces: 4, dailyLimit: null, batchYield: null, leadDays: 1, status: "ACTIVE", description: "简介待补充" },
      { name: "焦糖布蕾", unit: 229, bundle: 899, size: 4, mode: "INDEPENDENT", doughG: null, roundG: null, pieces: null, dailyLimit: 24, batchYield: 3, leadDays: 2, status: "ACTIVE", description: "简介待补充" },
    ]);

    const admins = await db.adminUser.findMany();
    expect(admins).toHaveLength(1);
    expect(admins[0].username).toBe("owner");
    expect(admins[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(admins[0].passwordHash).not.toContain(ADMIN_ENV.ADMIN_INITIAL_PASSWORD);
    expect(await verify(admins[0].passwordHash, ADMIN_ENV.ADMIN_INITIAL_PASSWORD)).toBe(true);
  });

  it("seed defaults match DATA_MODEL §1", async () => {
    await seed(db, ADMIN_ENV);
    expect(await loadSettings(db as unknown as Tx)).toMatchObject({
      orderingEnabled: false,
      cutoffTime: "20:00",
      defaultDoughLimitG: 1600,
      defaultDeliveryLimit: 8,
      deliveryFeeCents: 500,
      freeDeliveryMinCents: 2500,
      maxQtyPerItem: 8,
      ownerWechatId: "",
      showWechatOnHome: false,
      pickupNote: "自提时间在下午 5 点以后，具体时间微信确认",
      bakingTextBread: "正在为你制作大面包！",
      bakingTextOther: "正在为你制作布蕾！",
    });
  });

  it("does not re-create products when some exist (even if all are archived)", async () => {
    await db.product.create({
      data: { name: "旧商品", unitPriceCents: 100, capacityMode: "DOUGH_PER_UNIT", doughG: 50, status: "ARCHIVED" },
    });
    const r = await seed(db, ADMIN_ENV);
    expect(r.productsCreated).toBe(0);
    expect(await db.product.count()).toBe(1);
  });

  it("refuses a short or missing admin password when no admin exists, writing nothing", async () => {
    await expect(seed(db, { ADMIN_USERNAME: "owner", ADMIN_INITIAL_PASSWORD: "123456789" })).rejects.toThrow(
      /at least 10/,
    );
    await expect(seed(db, { ADMIN_INITIAL_PASSWORD: "long-enough-password" })).rejects.toThrow(/ADMIN_USERNAME/);
    await expect(seed(db, {})).rejects.toThrow();
    expect(await db.setting.count()).toBe(0);
    expect(await db.product.count()).toBe(0);
    expect(await db.adminUser.count()).toBe(0);
  });

  it("`prisma db seed` runs twice via prisma.config.ts and never prints the password", () => {
    const env = { ...CHILD_ENV, ...ADMIN_ENV };
    const run = () =>
      execFileSync("npx", ["prisma", "db", "seed"], { env, stdio: "pipe" }).toString();
    const out1 = run();
    const out2 = run();
    expect(out1).toMatch(/4 product\(s\) created; admin created/);
    expect(out2).toMatch(/0 product\(s\) created; admin kept/);
    expect(out1 + out2).not.toContain(ADMIN_ENV.ADMIN_INITIAL_PASSWORD);
  });
});

describe("CHECK constraints", () => {
  it("Setting is a single row (id = 1)", async () => {
    await createSettings();
    await expectCheck(db.setting.create({ data: { id: 2 } }), "Setting_single_row_chk");
  });

  it("Setting cutoffTime is HH:MM (00:00-23:59)", async () => {
    await createSettings();
    const set = (cutoffTime: string) => db.setting.update({ where: { id: 1 }, data: { cutoffTime } });
    for (const bad of ["8pm", "8:00", "24:00", "20:60", "20:00 ", " 20:00", "2000", "", "20:00:00"]) {
      await expectCheck(set(bad), "Setting_cutoffTime_chk");
    }
    for (const ok of ["00:00", "09:30", "20:00", "23:59"]) await set(ok);
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).cutoffTime).toBe("23:59");
  });

  it("Setting fees and limits >= 0, maxQtyPerItem >= 1", async () => {
    await createSettings();
    const set = (data: Record<string, number>) => db.setting.update({ where: { id: 1 }, data });
    await expectCheck(set({ deliveryFeeCents: -1 }), "Setting_fees_chk");
    await expectCheck(set({ freeDeliveryMinCents: -1 }), "Setting_fees_chk");
    await expectCheck(set({ defaultDoughLimitG: -1 }), "Setting_limits_chk");
    await expectCheck(set({ defaultDeliveryLimit: -1 }), "Setting_limits_chk");
    await expectCheck(set({ maxQtyPerItem: 0 }), "Setting_maxQty_chk");
    await set({
      deliveryFeeCents: 0,
      freeDeliveryMinCents: 0,
      defaultDoughLimitG: 0,
      defaultDeliveryLimit: 0,
      maxQtyPerItem: 1,
    });
  });

  it("Product capacity mode requires its fields", async () => {
    const C = "Product_capacity_mode_chk";
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_UNIT", doughG: null }), C);
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_UNIT", doughG: 0 }), C);
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: null, piecesPerRound: 4 }), C);
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 0, piecesPerRound: 4 }), C);
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, piecesPerRound: null }), C);
    await expectCheck(insertProduct({ capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, piecesPerRound: 0 }), C);
    await expectCheck(insertProduct({ capacityMode: "INDEPENDENT", doughG: null, dailyLimit: null }), C);
    await expectCheck(insertProduct({ capacityMode: "INDEPENDENT", doughG: null, dailyLimit: -1 }), C);
    // Valid rows of each mode are accepted (INDEPENDENT with limit 0 is allowed).
    await insertProduct({ id: "00000000-0000-0000-0000-000000000001", capacityMode: "DOUGH_PER_UNIT", doughG: 1 });
    await insertProduct({ id: "00000000-0000-0000-0000-000000000002", capacityMode: "DOUGH_PER_ROUND", doughG: null, roundG: 340, piecesPerRound: 1 });
    await insertProduct({ id: "00000000-0000-0000-0000-000000000003", capacityMode: "INDEPENDENT", doughG: null, dailyLimit: 0 });
    expect(await db.product.count()).toBe(3);
  });

  it("Product prices, bundle size, lead days, batch yield", async () => {
    await expectCheck(insertProduct({ unitPriceCents: -1 }), "Product_unitPrice_chk");
    await expectCheck(insertProduct({ bundleSize: 0 }), "Product_bundleSize_chk");
    await expectCheck(insertProduct({ bundlePriceCents: -1 }), "Product_bundlePrice_chk");
    await expectCheck(insertProduct({ leadDays: -1 }), "Product_leadDays_chk");
    await expectCheck(insertProduct({ batchYield: 0 }), "Product_batchYield_chk");
    await insertProduct({ unitPriceCents: 0, bundleSize: 1, bundlePriceCents: 0, leadDays: 0 });
    expect(await db.product.count()).toBe(1);
  });

  it("OpenDate limits are null or >= 0", async () => {
    await expectCheck(createOpenDate("2026-10-24", { doughLimitG: -1 }), "OpenDate_doughLimit_chk");
    await expectCheck(createOpenDate("2026-10-24", { deliveryLimit: -1 }), "OpenDate_deliveryLimit_chk");
    await createOpenDate("2026-10-24", { doughLimitG: 0, deliveryLimit: 0 });
    await createOpenDate("2026-10-25", { doughLimitG: null, deliveryLimit: null });
  });

  it("OpenDateProductLimit.limit >= 0", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    await expectCheck(
      db.openDateProductLimit.create({ data: { date: toDbDate("2026-10-24"), productId: p.brulee, limit: -1 } }),
      "OpenDateProductLimit_limit_chk",
    );
    await db.openDateProductLimit.create({ data: { date: toDbDate("2026-10-24"), productId: p.brulee, limit: 0 } });
  });

  it("Order money, wechatId length, note length, seq", async () => {
    await createOpenDate("2026-10-24");
    let n = 0;
    const order = (data: Record<string, unknown>) => {
      n += 1;
      return db.order.create({
        data: {
          openDate: { connect: { date: toDbDate("2026-10-24") } },
          seq: n,
          orderNo: `1024-${n}`,
          viewToken: `tok-${n}`,
          wechatId: "wx",
          fulfillment: "PICKUP",
          subtotalCents: 0,
          deliveryFeeCents: 0,
          totalCents: 0,
          cutoffAt: new Date("2026-10-24T01:00:00Z"),
          source: "WEB",
          ...data,
        },
      });
    };
    await expectCheck(order({ subtotalCents: -1 }), "Order_money_chk");
    await expectCheck(order({ deliveryFeeCents: -1 }), "Order_money_chk");
    await expectCheck(order({ totalCents: -1 }), "Order_money_chk");
    await expectCheck(order({ wechatId: "" }), "Order_wechatId_chk");
    await expectCheck(order({ wechatId: "a".repeat(41) }), "Order_wechatId_chk");
    // Must be stored trimmed (the app trims; this is the backstop).
    for (const untrimmed of ["   ", " wx", "wx ", "\twx", "wx\n"]) {
      await expectCheck(order({ wechatId: untrimmed }), "Order_wechatId_chk");
    }
    await expectCheck(order({ note: "面".repeat(301) }), "Order_note_chk");
    await expectCheck(order({ seq: 0 }), "Order_seq_chk");
    // Boundaries are accepted; length counts characters, not bytes.
    await order({ wechatId: "微".repeat(40), note: "面".repeat(300) });
    await order({ wechatId: "a", note: null });
    expect(await db.order.count()).toBe(2);
  });

  it("OrderItem qty >= 1 and snapshot numbers", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    const o = await createOrder({ date: "2026-10-24", items: [{ productId: p.redBean, qty: 1 }] });
    const item = (data: Record<string, unknown>) =>
      db.orderItem.create({
        data: {
          orderId: o.id,
          productId: p.redBean,
          nameSnapshot: "奶酥红豆包",
          qty: 1,
          unitPriceCents: 249,
          bundleSize: 4,
          bundlePriceCents: 899,
          lineTotalCents: 249,
          ...data,
        },
      });
    await expectCheck(item({ qty: 0 }), "OrderItem_qty_chk");
    await expectCheck(item({ lineTotalCents: -1 }), "OrderItem_snapshot_chk");
    await expectCheck(item({ bundleSize: 0 }), "OrderItem_snapshot_chk");
    await item({ qty: 1 });
  });

  it("uniques: (pickupDate, seq), viewToken, idempotencyKey, dedupeKey, username", async () => {
    const p = await createDefaultProducts();
    await createOpenDate("2026-10-24");
    const o = await createOrder({ date: "2026-10-24", items: [{ productId: p.redBean, qty: 1 }] });
    const base = {
      openDate: { connect: { date: toDbDate("2026-10-24") } },
      orderNo: "x",
      wechatId: "wx",
      fulfillment: "PICKUP" as const,
      subtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      cutoffAt: new Date(),
      source: "WEB" as const,
    };
    await expect(db.order.create({ data: { ...base, seq: o.seq, viewToken: "new" } })).rejects.toThrow();
    await expect(db.order.create({ data: { ...base, seq: 99, viewToken: o.viewToken } })).rejects.toThrow();
    await db.order.create({ data: { ...base, seq: 2, viewToken: "a", idempotencyKey: "k" } });
    await expect(db.order.create({ data: { ...base, seq: 3, viewToken: "b", idempotencyKey: "k" } })).rejects.toThrow();
    await db.adminUser.create({ data: { username: "u", passwordHash: "h" } });
    await expect(db.adminUser.create({ data: { username: "u", passwordHash: "h" } })).rejects.toThrow();
  });
});

describe("lockOpenDate", () => {
  const D = "2026-10-24";
  const OTHER = "2026-10-25";

  it("returns the row, or null for a missing date", async () => {
    await createOpenDate(D, { doughLimitG: 1200, note: "备注" });
    const rows = await db.$transaction(async (tx) => [await lockOpenDate(tx, D), await lockOpenDate(tx, "2026-12-01")]);
    expect(rows[0]).toEqual({
      date: D,
      isOpen: true,
      doughLimitG: 1200,
      deliveryEnabled: true,
      deliveryLimit: null,
      note: "备注",
    });
    expect(rows[1]).toBeNull();
    await expect(db.$transaction((tx) => lockOpenDate(tx, "2026-02-30"))).rejects.toThrow();
  });

  it("blocks a second transaction on the same date until the first commits; other dates are free", async () => {
    await createOpenDate(D);
    await createOpenDate(OTHER);
    const events: string[] = [];

    let signalLocked!: () => void;
    const aLocked = new Promise<void>((r) => (signalLocked = r));
    let release!: () => void;
    const aRelease = new Promise<void>((r) => (release = r));

    const txA = db.$transaction(
      async (tx) => {
        await lockOpenDate(tx, D);
        events.push("A locked");
        // A changes the row while holding the lock; B must see the committed value.
        await tx.openDate.update({ where: { date: toDbDate(D) }, data: { isOpen: false } });
        signalLocked();
        await aRelease;
        events.push("A committing");
      },
      { timeout: 15_000 },
    );
    await aLocked;

    let bAcquired = false;
    const txB = db.$transaction(
      async (tx) => {
        const row = await lockOpenDate(tx, D);
        bAcquired = true;
        events.push("B locked");
        return row;
      },
      { timeout: 15_000 },
    );

    // A different date can be locked right away while A holds D.
    const t0 = Date.now();
    const other = await db.$transaction((tx) => lockOpenDate(tx, OTHER));
    expect(other?.date).toBe(OTHER);
    expect(Date.now() - t0).toBeLessThan(2_000);

    // NOWAIT probe: D is locked by someone right now.
    await expect(
      db.$transaction(
        (tx) => tx.$queryRaw`SELECT 1 FROM "OpenDate" WHERE "date" = ${D}::date FOR UPDATE NOWAIT`,
      ),
    ).rejects.toThrow(/could not obtain lock|55P03/);

    await sleep(500);
    expect(bAcquired).toBe(false);

    release();
    await txA;
    const bRow = await txB;
    expect(events).toEqual(["A locked", "A committing", "B locked"]);
    expect(bRow?.isOpen).toBe(false);
  });

  it("lockOpenDates dedupes and locks in ascending date order", async () => {
    for (const d of ["2026-10-24", "2026-10-25", "2026-11-02"]) await createOpenDate(d);
    const seen: unknown[] = [];
    const result = await db.$transaction(async (tx) => {
      const spy = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === "$queryRaw") {
            return (strings: TemplateStringsArray, ...values: unknown[]) => {
              seen.push(values[0]);
              return target.$queryRaw(strings, ...values);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      return lockOpenDates(spy, ["2026-11-02", "2026-10-24", "2026-12-31", "2026-11-02", "2026-10-25"]);
    });
    expect(seen).toEqual(["2026-10-24", "2026-10-25", "2026-11-02", "2026-12-31"]);
    expect([...result.keys()]).toEqual(["2026-10-24", "2026-10-25", "2026-11-02", "2026-12-31"]);
    expect(result.get("2026-12-31")).toBeNull();
    expect(result.get("2026-10-25")?.date).toBe("2026-10-25");
  });

  it("opposite-order date pairs do not deadlock", async () => {
    await createOpenDate("2026-10-24");
    await createOpenDate("2026-10-25");
    const swap = (dates: LocalDate[]) =>
      db.$transaction(
        async (tx) => {
          await lockOpenDates(tx, dates);
          await sleep(200);
          return "ok";
        },
        { timeout: 15_000 },
      );
    const results = await Promise.all([
      swap(["2026-10-24", "2026-10-25"]),
      swap(["2026-10-25", "2026-10-24"]),
      swap(["2026-10-25", "2026-10-24"]),
    ]);
    expect(results).toEqual(["ok", "ok", "ok"]);
  });
});

describe("loadSettings / loadProductMap / loadDayContext", () => {
  it("loadSettings throws when the row is missing", async () => {
    await expect(db.$transaction((tx) => loadSettings(tx))).rejects.toThrow(/Setting row/);
  });

  it("resolves overrides vs defaults and includes PAUSED/ARCHIVED products", async () => {
    await createSettings({ defaultDoughLimitG: 1600, defaultDeliveryLimit: 8 });
    const p = await createDefaultProducts();
    const pausedPudding = await db.product.create({
      data: { name: "暂停布丁", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 10, status: "PAUSED", leadDays: 2 },
    });
    const archivedBun = await db.product.create({
      data: { name: "下架面包", unitPriceCents: 300, capacityMode: "DOUGH_PER_UNIT", doughG: 100, status: "ARCHIVED", sortOrder: 9 },
    });

    const PLAIN = "2026-10-24";
    const CUSTOM = "2026-10-25";
    await createOpenDate(PLAIN);
    await createOpenDate(CUSTOM, { doughLimitG: 1200, deliveryEnabled: false, deliveryLimit: 3 });
    await db.openDateProductLimit.create({ data: { date: toDbDate(CUSTOM), productId: p.brulee, limit: 12 } });
    // An override on another day must not leak.
    await db.openDateProductLimit.create({ data: { date: toDbDate(PLAIN), productId: pausedPudding.id, limit: 0 } });

    const o1 = await createOrder({ date: CUSTOM, items: [{ productId: p.redBean, qty: 4 }, { productId: p.cheeseHorn, qty: 3 }], fulfillment: "DELIVERY" });
    const o2 = await createOrder({ date: CUSTOM, items: [{ productId: archivedBun.id, qty: 2 }], status: "CANCELLED" });
    const o3 = await createOrder({ date: CUSTOM, items: [{ productId: p.brulee, qty: 5 }], status: "COMPLETED" });
    await createOrder({ date: PLAIN, items: [{ productId: p.redBean, qty: 1 }] });

    const ctx = await db.$transaction(async (tx) => {
      await lockOpenDate(tx, CUSTOM);
      const settings = await loadSettings(tx);
      const products = await loadProductMap(tx);
      return {
        products,
        custom: await loadDayContext(tx, CUSTOM, settings, products),
        plain: await loadDayContext(tx, PLAIN, settings, products),
        missing: await loadDayContext(tx, "2026-12-31", settings, products),
      };
    });

    expect(Object.keys(ctx.products).sort()).toEqual(
      [p.redBean, p.rockCheese, p.cheeseHorn, p.brulee, pausedPudding.id, archivedBun.id].sort(),
    );
    expect(ctx.products[archivedBun.id]).toEqual({
      id: archivedBun.id,
      capacityMode: "DOUGH_PER_UNIT",
      doughG: 100,
      roundG: null,
      piecesPerRound: null,
      dailyLimit: null,
      leadDays: 1,
      name: "下架面包",
      status: "ARCHIVED",
      unitPriceCents: 300,
      bundleSize: 4,
      bundlePriceCents: null,
      sortOrder: 9,
      batchYield: null,
    });
    expect(ctx.products[pausedPudding.id].status).toBe("PAUSED");
    expect(ctx.products[p.brulee]).toMatchObject({ batchYield: 3, dailyLimit: 24, leadDays: 2 });

    expect(ctx.plain.limits).toEqual({
      doughLimitG: 1600,
      deliveryEnabled: true,
      deliveryLimit: 8,
      productLimits: { [p.brulee]: 24, [pausedPudding.id]: 0 },
    });
    expect(ctx.custom.limits).toEqual({
      doughLimitG: 1200,
      deliveryEnabled: false,
      deliveryLimit: 3,
      productLimits: { [p.brulee]: 12, [pausedPudding.id]: 10 },
    });
    expect(ctx.custom.openDate).toMatchObject({ date: CUSTOM, isOpen: true });
    expect(ctx.missing.openDate).toBeNull();
    expect(ctx.missing.limits.doughLimitG).toBe(1600);
    expect(ctx.missing.orders).toEqual([]);

    // ALL orders of the day, any status, with items; nothing from other days.
    expect(ctx.custom.orders).toEqual([
      {
        id: o1.id,
        status: "NEW",
        fulfillment: "DELIVERY",
        items: expect.arrayContaining([
          { productId: p.redBean, qty: 4 },
          { productId: p.cheeseHorn, qty: 3 },
        ]),
      },
      { id: o2.id, status: "CANCELLED", fulfillment: "PICKUP", items: [{ productId: archivedBun.id, qty: 2 }] },
      { id: o3.id, status: "COMPLETED", fulfillment: "PICKUP", items: [{ productId: p.brulee, qty: 5 }] },
    ]);
    expect(ctx.custom.orders[0].items).toHaveLength(2);
    expect(ctx.plain.orders).toHaveLength(1);

    // The shapes plug straight into the capacity functions.
    expect(usage(ctx.custom.orders, ctx.products)).toEqual({
      doughG: 4 * 70 + 340,
      products: { [p.brulee]: 5, [pausedPudding.id]: 0 },
      deliveries: 1,
    });
    const check = checkDay({
      date: CUSTOM,
      existing: ctx.custom.orders,
      candidate: { items: [{ productId: p.brulee, qty: 8 }], fulfillment: "PICKUP" },
      products: ctx.products,
      limits: ctx.custom.limits,
    });
    expect(check.violations).toEqual([
      { kind: "PRODUCT", date: CUSTOM, productId: p.brulee, limit: 12, after: 13, over: 1 },
    ]);
  });
});

describe("outbox and audit", () => {
  it("enqueueNotification inserts PENDING due now and dedupes on dedupeKey", async () => {
    const now = new Date("2026-10-22T15:30:00.123Z");
    const first = await db.$transaction((tx) =>
      enqueueNotification(tx, { kind: "NEW_ORDER", dedupeKey: "new_order:abc", payload: { orderId: "abc", n: 1 }, now }),
    );
    expect(first.created).toBe(true);

    // A duplicate inside a transaction does not abort it: later writes still commit.
    const second = await db.$transaction(async (tx) => {
      const r = await enqueueNotification(tx, {
        kind: "NEW_ORDER",
        dedupeKey: "new_order:abc",
        payload: { orderId: "abc", n: 2 },
        now: new Date("2026-10-23T00:00:00Z"),
      });
      await enqueueNotification(tx, { kind: "DAILY_SUMMARY", dedupeKey: "summary:2026-10-23", payload: {}, now });
      return r;
    });
    expect(second).toEqual({ created: false });

    const rows = await db.notification.findMany({ orderBy: { dedupeKey: "asc" } });
    expect(rows).toHaveLength(2);
    const n = rows.find((r) => r.dedupeKey === "new_order:abc")!;
    expect(first.created && first.id).toBe(n.id);
    expect(n).toMatchObject({
      kind: "NEW_ORDER",
      status: "PENDING",
      attempts: 0,
      lastError: null,
      sentAt: null,
      payload: { orderId: "abc", n: 1 },
    });
    expect(n.nextAttemptAt.toISOString()).toBe(now.toISOString());
    expect(n.createdAt.toISOString()).toBe(now.toISOString());
  });

  it("enqueueNotification rolls back with its transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueueNotification(tx, { kind: "NEW_ORDER", dedupeKey: "new_order:x", payload: {}, now: new Date() });
        throw new Error("business write failed");
      }),
    ).rejects.toThrow("business write failed");
    expect(await db.notification.count()).toBe(0);
  });

  it("writeAudit stores before/after JSON and reason", async () => {
    const at = new Date("2026-10-22T12:00:00Z");
    const { id } = await db.$transaction((tx) =>
      writeAudit(tx, {
        actor: "ADMIN",
        action: "order.override",
        entityType: "Order",
        entityId: "o1",
        before: { qty: 1 },
        after: { qty: 9, at },
        reason: "老顾客",
        at,
      }),
    );
    await db.$transaction((tx) =>
      writeAudit(tx, { actor: "SYSTEM", action: "ordering.toggle", entityType: "Setting", entityId: "1", at }),
    );
    const row = await db.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      actor: "ADMIN",
      action: "order.override",
      before: { qty: 1 },
      after: { qty: 9, at: at.toISOString() },
      reason: "老顾客",
    });
    expect(row.at.toISOString()).toBe(at.toISOString());
    const bare = await db.auditLog.findFirstOrThrow({ where: { action: "ordering.toggle" } });
    expect(bare).toMatchObject({ before: null, after: null, reason: null });
  });
});

describe("AppError", () => {
  it("covers every API_SPEC §1 code with a status and a default message", () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        "VALIDATION", "ORDERING_DISABLED", "DATE_CLOSED", "CUTOFF_PASSED", "PRODUCT_UNAVAILABLE",
        "QTY_LIMIT", "FULL", "DELIVERY_FULL", "RATE_LIMITED", "NOT_CANCELLABLE", "OVER_LIMIT",
        "STALE", "UNAUTHORIZED", "NOT_FOUND",
      ].sort(),
    );
    const statuses = Object.fromEntries(ERROR_CODES.map((c) => [c, new AppError(c).httpStatus]));
    expect(statuses).toMatchObject({ VALIDATION: 422, RATE_LIMITED: 429, UNAUTHORIZED: 401, NOT_FOUND: 404, FULL: 409, STALE: 409 });
    for (const c of ERROR_CODES) {
      const e = new AppError(c);
      expect(e.message).toBe(copy.errors[c]);
      expect(e.message.length).toBeGreaterThan(0);
      expect(e).toBeInstanceOf(Error);
    }
    const full = new AppError("FULL", { extra: { suggestion: "2026-10-31" } });
    expect(full.message).toBe("这一天的预订名额已经满啦，可以选择下一个有空位的日期～");
    expect(full.extra).toEqual({ suggestion: "2026-10-31" });
    expect(new AppError("VALIDATION", { message: "x" }).message).toBe("x");
    // PAGES.md: FULL without a suggested date.
    expect(copy.errors.FULL_NO_SUGGESTION).toBe(
      "暂时没有可以容纳这个订单的日期，可以减少数量或加微信联系店主",
    );
  });
});

describe("createPrismaClient", () => {
  it("honours the pool size option", async () => {
    const small = createPrismaClient(TEST_DATABASE_URL, { max: 2 });
    try {
      const backendsOf = async () => {
        const r = await db.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = 'pool-size-probe'`;
        return r[0].n;
      };
      // 6 concurrent holders on a pool of 2: at most 2 connections at once.
      let peak = 0;
      await Promise.all(
        Array.from({ length: 6 }, () =>
          small.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL application_name = 'pool-size-probe'`;
            await sleep(150);
            peak = Math.max(peak, await backendsOf());
          }, { maxWait: 10_000, timeout: 10_000 }),
        ),
      );
      expect(peak).toBeGreaterThanOrEqual(1);
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      await small.$disconnect();
    }
    expect(() => createPrismaClient(TEST_DATABASE_URL, { max: 0 })).toThrow(/max/);
  });
});

describe("dbDates with a real column", () => {
  it("fromDbDate(toDbDate(d)) survives a write/read", async () => {
    await createOpenDate("2026-11-01");
    const row = await db.openDate.findFirstOrThrow();
    expect(fromDbDate(row.date)).toBe("2026-11-01");
  });
});
