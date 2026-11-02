import { afterAll, beforeEach, expect, it } from "vitest";
import { db, resetDb, createOpenDate, createDefaultProducts, createOrder } from "./helpers";
import { balance, purchase, claimCoinFinish } from "@/server/economy";
import { adminChangeStatus, adminCorrectStatus } from "@/server/orderAdmin";

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());
const now = new Date("2026-11-01T18:00:00Z");
it("serializes two purchases against one wallet", async () => {
  await db.coinLedger.create({ data: { wechatIdNorm: "wx", delta: 100, reason: "ADMIN", refId: "seed" } });
  const results = await Promise.allSettled([" WX ", "wx"].map(id => db.$transaction(tx => purchase(tx, id, "bomb", 1))));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(40);
  expect(await db.inventory.findMany()).toMatchObject([{ count: 1 }]);
});
it("double completion awards once, correction reverses and recompletion restores", async () => {
  await createOpenDate("2026-11-02");
  const products = await createDefaultProducts();
  const order = await createOrder({ date: "2026-11-02", status: "READY", wechatId: "Wx", items: [{ productId: products.redBean, qty: 1 }] });
  const request = { orderId: order.id, to: "COMPLETED" as const, expectedUpdatedAt: order.updatedAt.toISOString() };
  const results = await Promise.allSettled([adminChangeStatus(db, request, now), adminChangeStatus(db, request, now)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.coinLedger.count()).toBe(1);
  const completed = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  const corrected = await adminCorrectStatus(db, { orderId: order.id, to: "READY", reason: "mistake", expectedUpdatedAt: completed.updatedAt.toISOString() }, now);
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(0);
  await adminChangeStatus(db, { ...request, expectedUpdatedAt: corrected.updatedAt }, now);
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(Math.floor(order.subtotalCents / 100) * 10);
  expect(await db.auditLog.count()).toBe(3);
});
it("atomic finishes enforce shared daily cap, duplicate claim and inventory rollback", async () => {
  await db.coinLedger.create({ data: { wechatIdNorm: "wx", delta: 290, reason: "GAME_RUN", refId: "earlier", createdAt: now } });
  const makeRun = () => db.gameRun.create({ data: { game: "TD", seed: "s", wechatId: "Wx", nickname: "n", tiersSnapshot: [], level: 6 } });
  const a = await makeRun(), b = await makeRun();
  const args = (id: string) => ({ where: { id, finishedAt: null }, data: { finishedAt: now, passedAt: now, score: 6 } });
  await Promise.all([claimCoinFinish(db, args(a.id), now), claimCoinFinish(db, args(b.id), now)]);
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(300);
  expect((await claimCoinFinish(db, args(a.id), now)).count).toBe(0);
  const c = await makeRun();
  await expect(claimCoinFinish(db, args(c.id), now, { bomb: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
  expect((await db.gameRun.findUniqueOrThrow({ where: { id: c.id } })).finishedAt).toBeNull();
  await db.inventory.create({ data: { wechatIdNorm: "wx", item: "bomb", count: 1 } });
  await Promise.all([claimCoinFinish(db, args(c.id), now, { bomb: 1 }), claimCoinFinish(db, args(c.id), now, { bomb: 1 })]);
  expect((await db.inventory.findFirstOrThrow()).count).toBe(0);
});
it("excludes hidden and banned runs and resets cap at Chicago midnight across DST", async () => {
  const finish = async (id: string, when: Date) => {
    const run = await db.gameRun.create({ data: { game: "BIG", seed: "s", wechatId: id, nickname: "n", tiersSnapshot: [], hidden: id === "hidden" } });
    await claimCoinFinish(db, { where: { id: run.id, finishedAt: null }, data: { finishedAt: when, score: 3000 } }, when);
  };
  await db.gameBan.create({ data: { wechatId: "Banned" } });
  await finish("hidden", now);
  await finish("banned", now);
  expect(await db.coinLedger.count()).toBe(0);
  await db.coinLedger.create({ data: { wechatIdNorm: "wx", delta: 300, reason: "GAME_RUN", refId: "cap", createdAt: new Date("2026-11-01T05:00:00Z") } });
  await finish("wx", new Date("2026-11-02T05:59:59Z"));
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(300);
  await finish("wx", new Date("2026-11-02T06:00:00Z"));
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(330);
});
it("rolls order status and audit back if coin insertion fails, without outbox changes", async () => {
  await createOpenDate("2026-11-02");
  const products = await createDefaultProducts();
  const order = await createOrder({ date: "2026-11-02", status: "READY", items: [{ productId: products.redBean, qty: 1 }] });
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_coin_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_coin_test BEFORE INSERT ON "CoinLedger" FOR EACH ROW EXECUTE FUNCTION fail_coin_test()`);
  try {
    await expect(adminChangeStatus(db, { orderId: order.id, to: "COMPLETED", expectedUpdatedAt: order.updatedAt.toISOString() }, now)).rejects.toThrow();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("READY");
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.coinLedger.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER fail_coin_test ON "CoinLedger"`);
    await db.$executeRawUnsafe(`DROP FUNCTION fail_coin_test()`);
  }
  await adminChangeStatus(db, { orderId: order.id, to: "CANCELLED", reason: "not picked up", expectedUpdatedAt: order.updatedAt.toISOString() }, now);
  expect(await db.coinLedger.count()).toBe(0);
});
it("shop projection returns only balance, inventory and catalog for the normalized caller", async () => {
  const { shopView } = await import("@/server/economy");
  for (const id of ["wx", "other"]) {
    await db.coinLedger.create({ data: { wechatIdNorm: id, delta: 90, reason: "ORDER", refId: id, createdAt: now } });
    await db.inventory.create({ data: { wechatIdNorm: id, item: "bell", count: 1 } });
  }
  await db.coinLedger.create({ data: { wechatIdNorm: "wx", delta: 10, reason: "ORDER", refId: "old", createdAt: new Date("2026-10-01Z") } });
  const result = await db.$transaction(tx => shopView(tx, " WX "));
  expect(result.balance).toBe(100);
  expect(result.inventory).toEqual({ bomb: 0, bell: 1, slide: 0 });
  expect(Object.keys(result).sort()).toEqual(["balance", "catalog", "inventory"]);
  expect(JSON.stringify(result)).not.toContain("wechatId");
});

it("concurrent different runs cannot consume the same last item", async () => {
  await db.inventory.create({ data: { wechatIdNorm: "wx", item: "bomb", count: 1 } });
  const runs = await Promise.all([1, 2].map(() => db.gameRun.create({ data: { game: "TD", seed: "s", wechatId: "Wx", nickname: "n", tiersSnapshot: [], level: 1 } })));
  const results = await Promise.allSettled(runs.map(run => claimCoinFinish(db, { where: { id: run.id, finishedAt: null }, data: { finishedAt: now, score: 1 } }, now, { bomb: 1 })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.gameRun.count({ where: { finishedAt: { not: null } } })).toBe(1);
  expect(await db.coinLedger.count()).toBe(1);
  expect((await db.inventory.findFirstOrThrow()).count).toBe(0);
});

it("purchase audit failure rolls back both payment and inventory", async () => {
  await db.coinLedger.create({ data: { wechatIdNorm: "wx", delta: 100, reason: "ADMIN", refId: "seed" } });
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_shop_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER fail_shop_audit_test BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_shop_audit_test()`);
  try {
    await expect(db.$transaction(tx => purchase(tx, "wx", "bomb", 1))).rejects.toThrow();
    expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(100);
    expect(await db.inventory.count()).toBe(0);
    expect(await db.coinLedger.count({ where: { reason: "PURCHASE" } })).toBe(0);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER fail_shop_audit_test ON "AuditLog"`);
    await db.$executeRawUnsafe(`DROP FUNCTION fail_shop_audit_test()`);
  }
});

it.each(["BIG", "TU", "RUN", "M3", "TD", "GRAB"] as const)("does not award coins when a %s finish flags the run suspicious", async game => {
  const run = await db.gameRun.create({ data: { game, seed: "s", wechatId: "Wx", nickname: "n", tiersSnapshot: [], level: 6 } });
  const claimed = await claimCoinFinish(db, {
    where: { id: run.id, finishedAt: null },
    data: { finishedAt: now, passedAt: now, score: 3000, suspicious: true },
  }, now, {}, 3000);
  expect(claimed.count).toBe(1);
  expect(await db.gameRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ finishedAt: now, suspicious: true });
  expect(await db.coinLedger.count()).toBe(0);
  expect(await db.$transaction(tx => balance(tx, "wx"))).toBe(0);
});
