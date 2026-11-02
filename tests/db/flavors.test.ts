import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { createAdminOrder, createCustomerOrder, type CreateOrderInput } from "@/server/orders";
import { adminEditOrder } from "@/server/orderAdmin";
import { getCustomerOrderView } from "@/server/orderView";
import { getMenu } from "@/server/menu";
import { db, resetDb, createSettings, createDefaultProducts, createOpenDate, createOrder } from "./helpers";

const date = "2026-11-04";
const now = new Date("2026-11-01T15:00:00Z");
let productId: string;
let otherId: string;
let original: string;
let matcha: string;
beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  const products = await createDefaultProducts();
  productId = products.cheeseHorn;
  otherId = products.redBean;
  await createOpenDate(date, { doughLimitG: 340 });
  original = (await db.productFlavor.create({ data: { productId, name: "原味", priceCents: 300, sort: 0 } })).id;
  matcha = (await db.productFlavor.create({ data: { productId, name: "抹茶", priceCents: 400, sort: 1 } })).id;
});
afterAll(() => db.$disconnect());
const line = (flavorId: string | null | undefined, qty = 1) => ({ productId, flavorId, qty });
const input = (items = [line(original)]): CreateOrderInput => ({ items, pickupDate: date, fulfillment: "PICKUP", wechatId: randomUUID(), ipHash: randomUUID() });
const create = (items = [line(original)]) => createCustomerOrder(db, input(items), now);
const stored = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { items: true } });

it("shares round capacity across flavours, merges only matching flavours, ignores client money", async () => {
  const request = { ...input([line(original), line(matcha, 2), line(original)]), totalCents: 1 };
  const result = await createCustomerOrder(db, request, now);
  const order = await stored(result.id);
  expect(order.items).toHaveLength(2);
  expect(order.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ flavorId: original, flavorName: "原味", qty: 2, unitPriceCents: 300, lineTotalCents: 600 }),
    expect.objectContaining({ flavorId: matcha, flavorName: "抹茶", qty: 2, unitPriceCents: 400, lineTotalCents: 800 }),
  ]));
  expect(order.totalCents).toBe(1400);
  await expect(create()).rejects.toMatchObject({ code: "FULL" });
  expect((await getCustomerOrderView(db, result.viewToken, now)).items.map(i => i.flavorName).sort()).toEqual(["原味", "抹茶"].sort());
});

it("D5/D6: mixed flavours fill the last piece of the shared round", async () => {
  await create([line(original, 2), line(matcha)]);
  await create([line(matcha)]);
  await expect(create()).rejects.toMatchObject({ code: "FULL" });
});

it("serializes competing mixed-flavour orders without overselling", async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => create([line(original), line(matcha)])));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
  for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "FULL" });
  expect((await db.orderItem.aggregate({ _sum: { qty: true } }))._sum.qty).toBe(4);
});

it("requires active owned flavours for customer and owner, including overrides", async () => {
  for (const flavorId of [undefined, null]) await expect(create([line(flavorId)])).rejects.toMatchObject({ code: "FLAVOR_REQUIRED", httpStatus: 400 });
  const foreign = await db.productFlavor.create({ data: { productId: otherId, name: "其他", priceCents: 1 } });
  for (const flavorId of [foreign.id, randomUUID()]) await expect(create([line(flavorId)])).rejects.toMatchObject({ code: "FLAVOR_UNAVAILABLE", httpStatus: 400 });
  await db.productFlavor.update({ where: { id: original }, data: { active: false } });
  await expect(create()).rejects.toMatchObject({ code: "FLAVOR_UNAVAILABLE" });
  await expect(createAdminOrder(db, { ...input([line(null)]), override: true, reason: "owner" }, now)).rejects.toMatchObject({ code: "FLAVOR_REQUIRED" });
  expect(await db.order.count()).toBe(0);
});

it("enforces the per-product quantity limit across flavours", async () => {
  await expect(create([line(original, 5), line(matcha, 4)])).rejects.toMatchObject({ code: "QTY_LIMIT" });
});

it("changes flavour at current DB price and preserves unchanged line snapshots", async () => {
  const result = await create([line(original, 2)]);
  const old = await stored(result.id);
  await db.productFlavor.update({ where: { id: matcha }, data: { priceCents: 450 } });
  await db.productFlavor.update({ where: { id: original }, data: { priceCents: 650, name: "renamed" } });
  await adminEditOrder(db, { orderId: old.id, expectedUpdatedAt: old.updatedAt.toISOString(), items: [line(original), line(matcha)] }, now);
  const changed = await stored(old.id);
  expect(changed.totalCents).toBe(750);
  expect(changed.items).toHaveLength(2);
  expect(changed.items.find(i => i.flavorId === original)).toMatchObject({ flavorName: "原味", unitPriceCents: 300 });
});

it("retains an inactive flavour and its snapshot when editing another line quantity", async () => {
  const old = await stored((await create([line(original), line(matcha)])).id);
  const snapshot = old.items.find(i => i.flavorId === original)!;
  await db.productFlavor.update({ where: { id: original }, data: { active: false, name: "renamed", priceCents: 999 } });
  await adminEditOrder(db, {
    orderId: old.id, expectedUpdatedAt: old.updatedAt.toISOString(), items: [line(original), line(matcha, 2)],
  }, now);
  const changed = await stored(old.id);
  expect(changed.items).toHaveLength(2);
  expect(changed.items.find(i => i.flavorId === original)).toMatchObject({
    flavorName: snapshot.flavorName, nameSnapshot: snapshot.nameSnapshot,
    unitPriceCents: snapshot.unitPriceCents, bundleSize: snapshot.bundleSize,
    bundlePriceCents: snapshot.bundlePriceCents, lineTotalCents: snapshot.lineTotalCents, qty: snapshot.qty,
  });
  expect(changed.items.find(i => i.flavorId === matcha)?.qty).toBe(2);
  expect(changed.totalCents).toBe(1100);
});

it("rejects a new inactive flavour line on an existing product even with override", async () => {
  const old = await stored((await create([line(original)])).id);
  await db.productFlavor.update({ where: { id: matcha }, data: { active: false } });
  await expect(adminEditOrder(db, {
    orderId: old.id, expectedUpdatedAt: old.updatedAt.toISOString(),
    items: [line(original), line(matcha)], override: true, reason: "extra batch",
  }, now)).rejects.toMatchObject({ code: "FLAVOR_UNAVAILABLE" });
  expect(await stored(old.id)).toEqual(old);
});

it("allows explicit legacy null on edits only and keeps its price snapshot", async () => {
  const legacy = await createOrder({ date, items: [{ productId, qty: 1 }] });
  await expect(adminEditOrder(db, { orderId: legacy.id, expectedUpdatedAt: legacy.updatedAt.toISOString(), items: [{ productId, qty: 2 }] }, now)).rejects.toMatchObject({ code: "FLAVOR_REQUIRED" });
  await adminEditOrder(db, { orderId: legacy.id, expectedUpdatedAt: legacy.updatedAt.toISOString(), items: [line(null, 2), line(matcha)] }, now);
  const { getOrderDetail } = await import("@/server/orderQueries");
  const detail = await getOrderDetail(db, legacy.id);
  expect(detail.items.find(i => i.flavorId === null)?.flavorLabel).toBe("\u672a\u9009\u53e3\u5473");
  const changed = await stored(legacy.id);
  expect(changed.items.find(i => i.flavorId === null)).toMatchObject({ flavorName: null, unitPriceCents: 299, qty: 2 });
});

it("menu returns active flavours sorted and minimum price, fallback when none active", async () => {
  let p = (await getMenu(db)).products.find(p => p.id === productId)!;
  expect(p.flavors).toEqual([{ id: original, name: "原味", priceCents: 300 }, { id: matcha, name: "抹茶", priceCents: 400 }]);
  expect(p.priceFromCents).toBe(300);
  await db.productFlavor.updateMany({ data: { active: false } });
  p = (await getMenu(db)).products.find(p => p.id === productId)!;
  expect(p.flavors).toEqual([]);
  expect(p.priceFromCents).toBe(299);
  await expect(create([line(undefined)])).resolves.toBeTruthy();
});

it("owner overrides capacity with a reason but never flavour validity", async () => {
  await expect(createAdminOrder(db, input([line(original, 5)]), now)).rejects.toMatchObject({ code: "OVER_LIMIT" });
  const r = await createAdminOrder(db, { ...input([line(original, 5)]), override: true, reason: "extra batch" }, now);
  expect((await stored(r.id)).totalCents).toBe(1500);
  expect(await db.auditLog.count({ where: { action: "order.override", reason: "extra batch" } })).toBe(1);
});

it("mixed independent flavours share the daily limit and summary/email breakdowns", async () => {
  const { loadCalendar } = await import("@/server/calendar");
  const { loadDailySummary } = await import("@/server/summaryJob");
  const { renderNotification } = await import("@/server/emails");
  await db.product.update({ where: { id: productId }, data: { name: "泡芙", capacityMode: "INDEPENDENT", roundG: null, piecesPerRound: null, dailyLimit: 8, batchYield: 3 } });
  const r = await create([line(original, 5), line(matcha, 3)]);
  await expect(create()).rejects.toMatchObject({ code: "FULL" });
  await db.productFlavor.update({ where: { id: original }, data: { name: "新原味", priceCents: 999, active: false } });
  const daily = await loadDailySummary(db, new Date("2026-11-03T15:00:00Z"));
  expect(daily.tonight.lines[0]).toMatchObject({ qty: 8, batches: 3, leftover: 1, flavors: expect.arrayContaining([
    { flavorId: original, flavorName: "原味", qty: 5 }, { flavorId: matcha, flavorName: "抹茶", qty: 3 },
  ]) });
  const calendar = await db.$transaction(tx => loadCalendar(tx, date, date));
  expect(calendar.days[0].production.independent).toEqual(daily.tonight.lines);
  const previousSite = process.env.SITE_URL;
  process.env.SITE_URL = "https://example.test";
  try {
    const notification = await db.notification.findUniqueOrThrow({ where: { id: r.notificationId! } });
    const owner = await renderNotification(db, notification, now);
    expect(owner.text).toContain("泡芙：原味 5、抹茶 3，共 8");
    const summary = await renderNotification(db, { id: "summary", kind: "DAILY_SUMMARY", dedupeKey: "summary", payload: daily }, now);
    expect(summary.text).toContain("泡芙：原味 5、抹茶 3，共 8");
  } finally {
    if (previousSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSite;
  }
});

it("flavour price/deactivation changes serialize with an order snapshot", async () => {
  const { updateFlavor } = await import("@/server/productFlavors");
  // Hold the product lock while changing the flavour, then start an order on another connection.
  let locked!: () => void;
  let release!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutation = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId}::uuid FOR UPDATE`;
    await tx.productFlavor.update({ where: { id: original }, data: { active: false } });
    locked();
    await gate;
  });
  await acquired;
  const pending = create();
  release();
  await mutation;
  await expect(pending).rejects.toMatchObject({ code: "FLAVOR_UNAVAILABLE" });
  await updateFlavor(db, productId, original, { active: true, priceCents: 525 }, now);
  expect((await stored((await create()).id)).totalCents).toBe(525);
});

it("concurrent edits of different orders cannot oversell shared flavoured capacity", async () => {
  const a = await stored((await create()).id);
  const b = await stored((await create([line(matcha)])).id);
  const results = await Promise.allSettled([a, b].map(o => adminEditOrder(db, {
    orderId: o.id, expectedUpdatedAt: o.updatedAt.toISOString(), items: [line(original), line(matcha, 2)],
  }, now)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "OVER_LIMIT" } });
  expect((await db.orderItem.aggregate({ _sum: { qty: true } }))._sum.qty).toBe(4);
});
