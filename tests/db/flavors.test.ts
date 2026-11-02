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
  expect(p.flavors).toEqual([{ id: original, name: "原味", priceCents: 300, bundlePriceCents: null }, { id: matcha, name: "抹茶", priceCents: 400, bundlePriceCents: null }]);
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
    expect(summary.text).toContain("泡芙：原味 5个、抹茶 3个，共 8个");
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

it("F2: exactly one concurrent customer gets the last flavour slot", async () => {
  await db.productFlavor.update({ where: { id: original }, data: { dailyLimit: 2 } });
  await create();
  const results = await Promise.allSettled([create(), create()]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "FLAVOR_FULL", extra: { flavorId: original, productId } } });
  expect((await db.orderItem.aggregate({ where: { flavorId: original }, _sum: { qty: true } }))._sum.qty).toBe(2);
  await create([line(matcha)]);
});

it("F2: bundle snapshots and no cross-flavour bundles", async () => {
  await db.openDate.updateMany({ data: { doughLimitG: 5000 } });
  await db.productFlavor.update({ where: { id: original }, data: { priceCents: 450, bundlePriceCents: 1600 } });
  const a = await stored((await create([line(original, 5)])).id);
  expect(a.items[0]).toMatchObject({ bundleSize: 4, bundlePriceCents: 1600, lineTotalCents: 2050 });
  const b = await stored((await create([line(original, 3), line(matcha)])).id);
  expect(b.totalCents).toBe(1750);
  await db.productFlavor.update({ where: { id: original }, data: { bundlePriceCents: 999 } });
  await adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), items: [line(original, 4)] }, now);
  expect((await stored(a.id)).totalCents).toBe(1600);
});

it("F2: edits recompute after; restoring cancelled orders checks flavour capacity", async () => {
  const { adminCorrectStatus, customerCancel } = await import("@/server/orderAdmin");
  await db.productFlavor.update({ where: { id: original }, data: { dailyLimit: 2 } });
  const a = await stored((await create()).id);
  await adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), items: [line(original, 2)] }, now);
  const full = await stored(a.id);
  await expect(adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: full.updatedAt.toISOString(), items: [line(original, 3)] }, now)).rejects.toMatchObject({ code: "OVER_LIMIT" });
  await customerCancel(db, { viewToken: a.viewToken }, now);
  await create([line(original, 2)]);
  const cancelled = await stored(a.id);
  const restore = { orderId: a.id, expectedUpdatedAt: cancelled.updatedAt.toISOString(), to: "NEW" as const, reason: "restore requested" };
  await expect(adminCorrectStatus(db, restore, now)).rejects.toMatchObject({ code: "OVER_LIMIT", extra: { violations: [expect.objectContaining({ flavorId: original, after: 4 })] } });
  await adminCorrectStatus(db, { ...restore, override: true }, now);
  expect(await db.auditLog.count({ where: { action: "order.override", entityId: a.id, reason: restore.reason } })).toBe(1);
});

it("F2: owner flavour overrides require a reason and audit on create/edit", async () => {
  await db.productFlavor.update({ where: { id: original }, data: { dailyLimit: 0 } });
  await expect(createAdminOrder(db, { ...input(), override: true }, now)).rejects.toMatchObject({ code: "VALIDATION" });
  const a = await stored((await createAdminOrder(db, { ...input(), override: true, reason: "extra flavour batch" }, now)).id);
  await expect(adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), items: [line(original, 2)] }, now)).rejects.toMatchObject({ code: "OVER_LIMIT" });
  await adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), items: [line(original, 2)], override: true, reason: "extra flavour batch" }, now);
  expect(await db.auditLog.count({ where: { action: "order.override", reason: "extra flavour batch" } })).toBe(2);
});

it("F2: date overrides set/clear, warning confirmation, owner usage and public flags", async () => {
  const { updateOpenDate, loadCalendar } = await import("@/server/calendar");
  const { loadAvailabilityInput } = await import("@/server/availabilityData");
  const { listAvailability } = await import("@/domain/availability");
  await db.productFlavor.update({ where: { id: original }, data: { dailyLimit: 3 } });
  await create();
  const body = { isOpen: true, doughLimitG: 340, deliveryEnabled: true, deliveryLimit: null, productLimits: {}, note: null, flavorLimits: { [original]: 0 } };
  await expect(updateOpenDate(db, date, body, now)).rejects.toMatchObject({ code: "OVER_LIMIT", extra: { warnings: [{ what: "FLAVOR", flavorId: original, limit: 0, used: 1, kind: "BELOW_USAGE" }] } });
  await updateOpenDate(db, date, { ...body, confirm: true }, now);
  const day = (await db.$transaction(tx => loadCalendar(tx, date, date))).days[0];
  expect(day.flavors.find(f => f.id === original)).toMatchObject({ limit: 0, used: 1, override: 0 });
  const availability = listAvailability(await loadAvailabilityInput(db, { now, cart: [line(original)], fulfillment: "PICKUP" }));
  expect(availability.dates[0]).toMatchObject({ state: "FULL", soldOutFlavorIds: [original] });
  expect(JSON.stringify(availability)).not.toMatch(/"(limit|used|after|flavorLimits)"/);
  await expect(create()).rejects.toMatchObject({ code: "FLAVOR_FULL" });
  await updateOpenDate(db, date, { ...body, flavorLimits: { [original]: null } }, now);
  await create();
  expect(await db.openDateFlavorLimit.count()).toBe(0);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: "date.update" }, orderBy: { id: "desc" } });
  expect(audit.after).toHaveProperty("flavorLimits");
});

it("F2: validates flavour admin fields, defaults null and audits changes", async () => {
  const { createFlavor, updateFlavor } = await import("@/server/productFlavors");
  for (const data of [{ dailyLimit: -1 }, { dailyLimit: 1.5 }, { bundlePriceCents: 0 }, { bundlePriceCents: -1 }, { bundlePriceCents: 1.5 }]) {
    await expect(updateFlavor(db, productId, original, data, now)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createFlavor(db, productId, { name: "new", priceCents: 450, ...data }, now)).rejects.toMatchObject({ code: "VALIDATION" });
  }
  await updateFlavor(db, productId, original, { dailyLimit: 0, bundlePriceCents: 1600 }, now);
  expect(await db.productFlavor.findUniqueOrThrow({ where: { id: original } })).toMatchObject({ dailyLimit: 0, bundlePriceCents: 1600 });
  await updateFlavor(db, productId, original, { dailyLimit: null, bundlePriceCents: null }, now);
  expect(await db.auditLog.count({ where: { action: "product.flavor.update" } })).toBe(2);
});

it("F2: concurrent edits serialize at the flavour limit even with spare product capacity", async () => {
  await db.openDate.updateMany({ data: { doughLimitG: 5000 } });
  await db.productFlavor.update({ where: { id: original }, data: { dailyLimit: 3 } });
  const a = await stored((await create()).id);
  const b = await stored((await create()).id);
  const results = await Promise.allSettled([a, b].map(o => adminEditOrder(db, {
    orderId: o.id, expectedUpdatedAt: o.updatedAt.toISOString(), items: [line(original, 2)],
  }, now)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "OVER_LIMIT", extra: { violations: [expect.objectContaining({ flavorId: original })] } } });
  expect((await db.orderItem.aggregate({ where: { flavorId: original }, _sum: { qty: true } }))._sum.qty).toBe(3);
});

it("F2: moving a dated order respects destination flavour overrides", async () => {
  const other = "2026-11-05";
  await createOpenDate(other);
  await db.openDateFlavorLimit.create({ data: { date: new Date(`${other}T00:00:00Z`), flavorId: original, limit: 0 } });
  const a = await stored((await create()).id);
  await expect(adminEditOrder(db, { orderId: a.id, expectedUpdatedAt: a.updatedAt.toISOString(), pickupDate: other }, now)).rejects.toMatchObject({ code: "OVER_LIMIT" });
  expect((await stored(a.id)).pickupDate).toEqual(a.pickupDate);
});

it("requires a real bundle size for flavour creation, updates and product size changes", async () => {
  const { createFlavor, updateFlavor } = await import("@/server/productFlavors");
  const { updateProduct } = await import("@/server/products");
  await updateProduct(db, productId, { bundleSize: 1, bundlePriceCents: null }, now);
  const error = { code: "VALIDATION", httpStatus: 422, extra: { fields: { bundlePriceCents: expect.any(String) } } };
  await expect(createFlavor(db, productId, { name: "new", priceCents: 450, bundlePriceCents: 1600 }, now)).rejects.toMatchObject(error);
  await expect(updateFlavor(db, productId, original, { bundlePriceCents: 1600 }, now)).rejects.toMatchObject(error);
  await updateFlavor(db, productId, original, { bundlePriceCents: null }, now);
  await updateProduct(db, productId, { bundleSize: 2 }, now);
  await createFlavor(db, productId, { name: "new", priceCents: 450, bundlePriceCents: 800, active: false }, now);
  await expect(updateProduct(db, productId, { bundleSize: 1 }, now)).rejects.toMatchObject({
    code: "VALIDATION", httpStatus: 422, extra: { fields: { bundleSize: expect.any(String) } },
  });
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).bundleSize).toBe(2);
});

it("reports sorted open dates over a lowered flavour limit, excluding overrides and non-occupying usage", async () => {
  const { updateFlavor } = await import("@/server/productFlavors");
  const fixtures = [
    ["2026-11-01", 3, "NEW", true],
    [date, 4, "CONFIRMED", true],
    ["2026-11-05", 4, "NEW", true],
    ["2026-11-06", 4, "NEW", false],
    ["2026-10-31", 4, "NEW", true],
    ["2026-11-07", 4, "CANCELLED", true],
    ["2026-11-08", 2, "NEW", true],
  ] as const;
  for (const [day, qty, status, isOpen] of fixtures) {
    if (day !== date) await createOpenDate(day, { isOpen });
    const order = await createOrder({ date: day, items: [{ productId, qty }], status });
    await db.orderItem.updateMany({ where: { orderId: order.id }, data: { flavorId: original } });
  }
  await db.openDateFlavorLimit.create({ data: { date: new Date("2026-11-05"), flavorId: original, limit: 0 } });
  const result = await updateFlavor(db, productId, original, { dailyLimit: 2 }, now);
  expect(result.product.flavors.find(f => f.id === original)?.dailyLimit).toBe(2);
  expect(result.overLimitDates).toEqual([
    { date: "2026-11-01", kinds: ["FLAVOR"] }, { date, kinds: ["FLAVOR"] },
  ]);
  expect((await updateFlavor(db, productId, original, { dailyLimit: 1 }, now)).overLimitDates).toHaveLength(3);
  for (const patch of [{ dailyLimit: 1 }, { dailyLimit: 5 }, { dailyLimit: null }, { name: "renamed" }]) {
    expect((await updateFlavor(db, productId, original, patch, now)).overLimitDates).toEqual([]);
  }
});

it("exposes readable flavour bundles to the assistant without raw bundle cents", async () => {
  const { publicProduct } = await import("@/server/assistant/tools");
  await db.productFlavor.update({ where: { id: original }, data: { bundlePriceCents: 1600 } });
  const menu = await getMenu(db);
  const product = menu.products.find(p => p.id === productId)!;
  const view = publicProduct(menu, product, "p1");
  expect(view.flavors[0]).toMatchObject({ id: original, bundle: "4 个 $16.00" });
  expect(view.flavors[1]).not.toHaveProperty("bundle");
  expect(JSON.stringify(view)).not.toContain("bundlePriceCents");
  const fallback = publicProduct(menu, { ...product, flavors: [], bundlePriceCents: 1600 }, "p1");
  expect(fallback.bundle).toBe(view.flavors[0].bundle);
});
