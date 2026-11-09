import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, resetDb, createSettings, createOpenDate } from './helpers';
import { createCustomerOrder, createAdminOrder } from '@/server/orders';
import { adminEditOrder, customerCancel, adminCorrectStatus } from '@/server/orderAdmin';
import { createProduct, updateProduct } from '@/server/products';
import { createFlavor, updateFlavor } from '@/server/productFlavors';
import { createStock, updateStock, poolProgress, decidePool, listStock } from '@/server/groupStock';
import { loadAvailabilityInput } from '@/server/availabilityData';
import { listAvailability } from '@/domain/availability';
import { getCustomerOrderView } from '@/server/orderView';
import { toDbDate } from '@/server/dbDates';
const date = '2026-11-13';
const now = new Date('2026-11-08T15:00:00Z');
let productId: string;
const buy = (qty = 1, extra = {}, at = now) => createCustomerOrder(db, { items: [{ productId, qty, ifNotFormed: 'CONTACT', ...extra }], pickupDate: date, fulfillment: 'PICKUP', wechatId: randomUUID(), idempotencyKey: randomUUID() }, at);
const key = () => ({ date, productId, flavorId: null });
const progress = () => poolProgress(db, key(), now);
beforeEach(async () => {
  await resetDb(); await createSettings({ orderingEnabled: true, maxQtyPerItem: 100 }); await createOpenDate(date);
  const p = await createProduct(db, { name: 'Group cake', capacityMode: 'INDEPENDENT', dailyLimit: 1, batchYield: 6, groupMin: 4, saleMode: 'GROUP', unitPriceCents: 500, bundleSize: 6, bundlePriceCents: 2500 }, now);
  productId = p.id;
});
afterAll(() => db.$disconnect());
describe('group and stock under the real date lock', () => {
  it('ten concurrent requests for last piece: exactly one succeeds', async () => {
    await buy(5);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => buy()));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await progress()).toMatchObject({ pieces: 6, cakes: 1, status: 'FORMED' });
  });
  it('ten flavours racing for last cake: exactly one succeeds', async () => {
    const flavors = [];
    for (let i = 0; i < 10; i++) {
      const p = await createFlavor(db, productId, { name: `F${i}`, priceCents: 500 }, now);
      flavors.push(p.flavors.find(f => f.name === `F${i}`)!.id);
    }
    const results = await Promise.allSettled(flavors.map(flavorId => buy(1, { flavorId })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('idempotency and cancel restore pool progress', async () => {
    const input = { items: [{ productId, qty: 4, ifNotFormed: 'CANCEL' as const }], pickupDate: date, fulfillment: 'PICKUP' as const, wechatId: 'retry', idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([createCustomerOrder(db, input, now), createCustomerOrder(db, input, now)]);
    expect(a.id).toBe(b.id); expect((await progress()).pieces).toBe(4);
    await customerCancel(db, { viewToken: a.viewToken }, now);
    expect((await progress()).pieces).toBe(0);
  });
  it('requires GROUP preferences for both customer and admin, NORMAL ignores them', async () => {
    const input = { items: [{ productId, qty: 1 }], pickupDate: date, fulfillment: 'PICKUP' as const, wechatId: 'choice' };
    await expect(createCustomerOrder(db, input, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(createAdminOrder(db, input, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await updateProduct(db, productId, { saleMode: 'NORMAL' }, now);
    const o = await buy();
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).ifNotFormed).toBeNull();
  });
  it('admin minimum, confirmation, failure and explicit reopen are audited', async () => {
    await buy(3);
    expect((await decidePool(db, { ...key(), action: 'minimum', minOverride: 3 }, now)).status).toBe('FORMED');
    await decidePool(db, { ...key(), action: 'confirm' }, now);
    expect((await decidePool(db, { ...key(), action: 'minimum', minOverride: 6 }, now)).status).toBe('CONFIRMED');
    expect((await decidePool(db, { ...key(), action: 'fail' }, now)).status).toBe('FAILED');
    expect((await decidePool(db, { ...key(), action: 'reopen' }, now)).status).toBe('OPEN');
    expect(await db.auditLog.count({ where: { entityType: 'GroupPool' } })).toBe(5);
    expect(await db.order.count({ where: { status: 'NEW' } })).toBe(1);
  });
  it('edit recomputes progress and preserves choices; confirmation survives cancellation', async () => {
    const o = await buy(4, { ifNotFormed: 'CANCEL' });
    const old = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    await adminEditOrder(db, { orderId: o.id, expectedUpdatedAt: old.updatedAt.toISOString(), items: [{ productId, qty: 2, ifNotFormed: 'CANCEL' }] }, now);
    expect(await progress()).toMatchObject({ pieces: 2, status: 'OPEN' });
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).ifNotFormed).toBe('CANCEL');
    await decidePool(db, { ...key(), action: 'confirm' }, now);
    await customerCancel(db, { viewToken: o.viewToken }, now);
    expect((await progress()).status).toBe('CONFIRMED');
    expect((await getCustomerOrderView(db, o.viewToken, now)).items[0].poolStatus).toBe('CONFIRMED');
  });
  it('stock last piece race after preorder cutoff, idempotency, cancel and restore', async () => {
    const lot = await createStock(db, { ...key(), qty: 1 }, now);
    const at = new Date('2026-11-13T17:00:00Z'); // 11:00 Chicago
    expect(lot.sellUntil.toISOString()).toBe('2026-11-13T18:00:00.000Z');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => buy(1, { stockLotId: lot.id }, at)));
    const wins = results.filter(r => r.status === 'fulfilled'); expect(wins).toHaveLength(1);
    const win = (wins[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof buy>>>).value;
    expect((await progress()).pieces).toBe(0);
    await customerCancel(db, { viewToken: win.viewToken }, at);
    expect((await listStock(db, { from: date, to: date }, at))[0].left).toBe(1);
    await buy(1, { stockLotId: lot.id }, at);
    const old = await db.order.findUniqueOrThrow({ where: { id: win.id } });
    await expect(adminCorrectStatus(db, { orderId: win.id, expectedUpdatedAt: old.updatedAt.toISOString(), to: 'CONFIRMED', reason: 'restore', override: true }, at)).rejects.toMatchObject({ code: 'FULL' });
  });
  it('stock edit restores inventory and cannot lower qty below sold', async () => {
    const lot = await createStock(db, { ...key(), qty: 2 }, now);
    const o = await buy(2, { stockLotId: lot.id });
    const old = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    await adminEditOrder(db, { orderId: o.id, expectedUpdatedAt: old.updatedAt.toISOString(), items: [{ productId, qty: 1, stockLotId: lot.id }] }, now);
    expect((await listStock(db, { from: date, to: date }, now))[0].left).toBe(1);
    await expect(updateStock(db, lot.id, { qty: 0 }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await updateStock(db, lot.id, { closed: true }, now);
    await expect(buy(1, { stockLotId: lot.id })).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
  });
  it('stock expiry, lot identity/date and mixed preorder CUTOFF semantics', async () => {
    const lot = await createStock(db, { ...key(), qty: 3 }, now);
    await expect(buy(1, { stockLotId: lot.id }, lot.sellUntil)).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
    await expect(createCustomerOrder(db, { items: [{ productId, qty: 1, stockLotId: lot.id }, { productId, qty: 1, ifNotFormed: 'CONTACT' }], pickupDate: date, fulfillment: 'PICKUP', wechatId: 'mixed' }, new Date('2026-11-13T17:00:00Z'))).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
    await createOpenDate('2026-11-14');
    await expect(createCustomerOrder(db, { items: [{ productId, qty: 1, stockLotId: lot.id }], pickupDate: '2026-11-14', fulfillment: 'PICKUP', wechatId: 'wrong' }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('spare converts once, reserves against preorder growth; general stock uses no cake', async () => {
    await buy(4);
    const lot = await createStock(db, key(), now, true); expect(lot.qty).toBe(2);
    await expect(createStock(db, key(), now, true)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(buy()).rejects.toMatchObject({ code: 'FULL' });
    await buy(2, { stockLotId: lot.id });
    await updateStock(db, lot.id, { closed: true }, now);
    await expect(createStock(db, key(), now, true)).rejects.toMatchObject({ code: 'FULL' });
    const general = await createStock(db, { ...key(), qty: 5 }, now);
    await buy(5, { stockLotId: general.id });
    expect((await progress()).pieces).toBe(4);
  });
  it('mixed same-product stock/preorder lines stay distinct and stock retry is idempotent', async () => {
    const lot = await createStock(db, { ...key(), qty: 2 }, now);
    const input = { items: [{ productId, qty: 1, stockLotId: lot.id }, { productId, qty: 1, ifNotFormed: 'CONTACT' as const }], pickupDate: date, fulfillment: 'PICKUP' as const, wechatId: 'mixed', idempotencyKey: randomUUID() };
    const a = await createCustomerOrder(db, input, now), b = await createCustomerOrder(db, input, now);
    expect(a.id).toBe(b.id); expect(await db.orderItem.count({ where: { orderId: a.id } })).toBe(2);
    expect((await listStock(db, { from: date, to: date }, now))[0].left).toBe(1);
  });
  it('flavour weekdays must be a product subset; customer blocked and owner reason overrides', async () => {
    await updateProduct(db, productId, { pickupWeekdays: [5, 6] }, now);
    await expect(createFlavor(db, productId, { name: 'bad', priceCents: 500, pickupWeekdays: [1] }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    const p = await createFlavor(db, productId, { name: 'Saturday', priceCents: 500, pickupWeekdays: [6] }, now);
    const flavorId = p.flavors[0].id;
    await expect(updateFlavor(db, productId, flavorId, { pickupWeekdays: [1] }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(updateProduct(db, productId, { pickupWeekdays: [5] }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(buy(1, { flavorId })).rejects.toMatchObject({ code: 'WEEKDAY_UNAVAILABLE' });
    const input = { items: [{ productId, flavorId, qty: 1, ifNotFormed: 'CONTACT' as const }], pickupDate: date, fulfillment: 'PICKUP' as const, wechatId: 'admin' };
    await expect(createAdminOrder(db, input, now)).rejects.toMatchObject({ code: 'OVER_LIMIT' });
    await createAdminOrder(db, { ...input, override: true, reason: 'special' }, now);
  });
  it('NORMAL -> GROUP grandfathers old null choices, reports over-limit but does not reject migration', async () => {
    await updateProduct(db, productId, { saleMode: 'NORMAL', dailyLimit: 100 }, now);
    const o = await buy(7);
    const result = await updateProduct(db, productId, { saleMode: 'GROUP', dailyLimit: 1 }, now);
    expect(result.overLimitDates).toContainEqual({ date, kinds: ['PRODUCT'] });
    expect(await progress()).toMatchObject({ pieces: 7, cakes: 2, status: 'CONFIRMED' });
    expect(await db.groupPool.findFirst()).toMatchObject({ note: '改为拼单前已有订单' });
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).ifNotFormed).toBeNull();
    const old = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    await adminEditOrder(db, { orderId: o.id, expectedUpdatedAt: old.updatedAt.toISOString(), note: 'unchanged capacity' }, now);
    await expect(buy()).rejects.toMatchObject({ code: 'FULL' });
  });
  it('same-day stock availability and per-cart public progress contain no customer data', async () => {
    await buy(3);
    const lot = await createStock(db, { ...key(), qty: 2 }, now);
    const input = await loadAvailabilityInput(db, { cart: [{ productId, qty: 1, stockLotId: lot.id }], fulfillment: 'PICKUP', now: new Date('2026-11-13T17:00:00Z') });
    expect(listAvailability(input).dates.find(d => d.date === date)?.state).toBe('AVAILABLE');
    const group = await loadAvailabilityInput(db, { cart: [{ productId, qty: 1 }], fulfillment: 'PICKUP', now });
    expect(listAvailability(group).dates[0].groupPools?.[0]).toMatchObject({ pieces: 3, needMore: 1 });
    expect(listAvailability(group).dates[0].groupPools?.[0]).not.toHaveProperty('orderCount');
    expect((await db.order.findMany()).every(o => o.pickupDate.getTime() === toDbDate(date).getTime())).toBe(true);
  });
});

it('minimum clears to product default and null-flavour identity is unique', async () => {
  await buy(3);
  await decidePool(db, { ...key(), action: 'minimum', minOverride: 3 }, now);
  expect((await decidePool(db, { ...key(), action: 'minimum', minOverride: null }, now)).status).toBe('OPEN');
  await expect(db.groupPool.create({ data: { date: toDbDate(date), productId } })).rejects.toMatchObject({ code: 'P2002' });
  await expect(decidePool(db, { ...key(), action: 'minimum', minOverride: 7 }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
});
it('sold out stock shows FULL in availability, and admin cannot override its hard bound', async () => {
  const lot = await createStock(db, { ...key(), qty: 1 }, now);
  await buy(1, { stockLotId: lot.id });
  const input = await loadAvailabilityInput(db, { cart: [{ productId, qty: 1, stockLotId: lot.id }], fulfillment: 'PICKUP', now });
  expect(listAvailability(input).dates[0].state).toBe('FULL');
  await expect(createAdminOrder(db, { items: [{ productId, qty: 1, stockLotId: lot.id }], pickupDate: date, fulfillment: 'PICKUP', wechatId: 'override', override: true, reason: 'cannot mint stock' }, now)).rejects.toMatchObject({ code: 'FULL' });
});
it('preserves per-flavour promises when switching with existing orders', async () => {
  await updateProduct(db, productId, { saleMode: 'NORMAL', dailyLimit: 100 }, now);
  const a = await createFlavor(db, productId, { name: 'Plain', priceCents: 500 }, now);
  const b = await createFlavor(db, productId, { name: 'Matcha', priceCents: 500 }, now);
  const first = a.flavors[0].id, second = b.flavors.find(f => f.name === 'Matcha')!.id;
  await buy(1, { flavorId: first }); await buy(1, { flavorId: second });
  await updateProduct(db, productId, { saleMode: 'GROUP', dailyLimit: 1 }, now);
  expect(await db.groupPool.count({ where: { decision: 'CONFIRMED' } })).toBe(2);
});
it('stock lots keep identities and constraints after cancelled-order edits', async () => {
  const lot = await createStock(db, { ...key(), qty: 1 }, now);
  const o = await buy(1, { stockLotId: lot.id });
  await customerCancel(db, { viewToken: o.viewToken }, now);
  await createOpenDate('2026-11-14');
  const old = await db.order.findUniqueOrThrow({ where: { id: o.id } });
  await expect(adminEditOrder(db, { orderId: o.id, expectedUpdatedAt: old.updatedAt.toISOString(), pickupDate: '2026-11-14' }, now)).rejects.toMatchObject({ code: 'VALIDATION' });
});
it('editing expired stock down is allowed and closed-spare reservations recompute after', async () => {
  await buy(4);
  const lot = await createStock(db, key(), now, true);
  const o = await buy(2, { stockLotId: lot.id });
  await updateStock(db, lot.id, { closed: true }, now);
  const old = await db.order.findUniqueOrThrow({ where: { id: o.id } });
  await adminEditOrder(db, { orderId: o.id, expectedUpdatedAt: old.updatedAt.toISOString(), items: [{ productId, qty: 1, stockLotId: lot.id }, { productId, qty: 1, ifNotFormed: 'CONTACT' }] }, new Date('2026-11-14T00:00:00Z'));
  expect((await progress()).pieces).toBe(5);
  expect((await listStock(db, { from: date, to: date }, now, true))[0]).toMatchObject({ sold: 1, closed: true });
});
it('mixed preorder cutoff takes priority over sold-out stock', async () => {
  const lot = await createStock(db, { ...key(), qty: 0 }, now);
  await expect(createCustomerOrder(db, { items: [{ productId, qty: 1, stockLotId: lot.id }, { productId, qty: 1, ifNotFormed: 'CONTACT' }], pickupDate: date, fulfillment: 'PICKUP', wechatId: 'cutoff-first' }, new Date('2026-11-13T17:00:00Z'))).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
});
