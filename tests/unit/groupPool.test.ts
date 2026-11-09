import { describe, expect, it } from 'vitest';
import { groupPool, stockLeft } from '@/domain/groupPool';
const now = new Date('2026-11-01T00:00:00Z');
const cutoffAt = new Date('2026-11-10T00:00:00Z');
const progress = (pieces: number, extra = {}) => groupPool({ pieces, batchYield: 6, min: 4, now, cutoffAt, ...extra });
describe('D192 pool arithmetic', () => {
  it.each([[4, 1, 2, 'FORMED', 0], [6, 1, 0, 'FORMED', 0], [7, 2, 5, 'OPEN', 3], [10, 2, 2, 'FORMED', 0], [12, 2, 0, 'FORMED', 0]] as const)('n=%i', (n, cakes, spare, status, needMore) => expect(progress(n)).toMatchObject({ cakes, spare, status, needMore }));
  it('independent Friday plain 3, matcha 1, Saturday plain 2', () => expect([3, 1, 2].map(n => progress(n).needMore)).toEqual([1, 3, 2]));
  it('min override forms immediately', () => expect(progress(3, { min: 3 }).status).toBe('FORMED'));
  it('cancel lowers progress', () => expect([progress(4).status, progress(3).status]).toEqual(['FORMED', 'OPEN']));
  it('confirmation never reverts, even empty', () => expect(progress(0, { decision: 'CONFIRMED' }).status).toBe('CONFIRMED'));
  it('cutoff and explicit failure', () => { expect(progress(3, { now: cutoffAt }).status).toBe('FAILED'); expect(progress(6, { decision: 'FAILED' }).status).toBe('FAILED'); });
  it('stock sold out and exact sellUntil', () => { expect(stockLeft(2, 2, false, cutoffAt, now)).toBe(0); expect(stockLeft(2, 0, false, cutoffAt, cutoffAt)).toBe(0); expect(stockLeft(2, 1, false, cutoffAt, now)).toBe(1); });
});

import { checkDay } from '@/domain/capacity';
import { poolPieces } from '@/domain/groupPool';
import { weekdayViolations } from '@/domain/weekdays';
import type { CapacityProduct, DayOrder } from '@/domain/types';
const product: CapacityProduct = { id: 'cake', saleMode: 'GROUP', groupMin: 4, batchYield: 6, capacityMode: 'INDEPENDENT', dailyLimit: 2, doughG: null, roundG: null, piecesPerRound: null, leadDays: 1, flavors: [{ id: 'plain' }, { id: 'matcha' }, { id: 'third' }] };
const order = (id: string, flavorId: string, qty: number): DayOrder => ({ id, status: 'NEW', fulfillment: 'PICKUP', items: [{ productId: 'cake', flavorId, qty }] });
it('G1 actual pool/date keys are independent', () => {
  const friday = [order('a', 'plain', 3), order('b', 'matcha', 1)], saturday = [order('c', 'plain', 2)];
  expect([poolPieces(friday, 'cake', 'plain'), poolPieces(friday, 'cake', 'matcha'), poolPieces(saturday, 'cake', 'plain')]).toEqual([3, 1, 2]);
});
it('G7 dailyLimit 2 cakes blocks third flavour but allows existing pools to grow', () => {
  const existing = [order('a', 'plain', 3), order('b', 'matcha', 1)];
  const check = (flavorId: string, qty: number) => checkDay({ date: '2026-11-13', existing, candidate: { fulfillment: 'PICKUP', items: [{ productId: 'cake', flavorId, qty }] }, products: { cake: product }, limits: { doughLimitG: 0, deliveryEnabled: true, deliveryLimit: 8, productLimits: { cake: 2 } } });
  expect(check('third', 1).ok).toBe(false); expect(check('plain', 3).ok).toBe(true); expect(check('matcha', 5).ok).toBe(true); expect(check('plain', 4).ok).toBe(false);
});
it('G8 per-flavour override remains pieces and product override remains cakes', () => {
  const result = checkDay({ date: '2026-11-13', existing: [order('a', 'plain', 3)], candidate: { fulfillment: 'PICKUP', items: [{ productId: 'cake', flavorId: 'plain', qty: 2 }] }, products: { cake: product }, limits: { doughLimitG: 0, deliveryEnabled: true, deliveryLimit: 8, productLimits: { cake: 1 }, flavorLimits: { plain: 4 } } });
  expect(result.violations).toEqual([{ kind: 'PRODUCT', date: '2026-11-13', productId: 'cake', flavorId: 'plain', limit: 4, after: 5, over: 1 }]);
});
it('G9 stock consumes no dough/cakes or flavour capacity', () => {
  const result = checkDay({ date: '2026-11-13', existing: [], candidate: { fulfillment: 'PICKUP', items: [{ productId: 'cake', flavorId: 'plain', stockLotId: 'stock', qty: 100 }] }, products: { cake: product }, limits: { doughLimitG: 0, deliveryEnabled: true, deliveryLimit: 8, productLimits: { cake: 0 }, flavorLimits: { plain: 0 } } });
  expect(result.ok).toBe(true); expect(result.after.products.cake).toBe(0);
});
it('G10 rotation checks each flavour, stock bypasses rotation', () => {
  const products = { cake: { ...product, pickupWeekdays: [5, 6], flavors: [{ id: 'plain', pickupWeekdays: [5] }, { id: 'matcha', pickupWeekdays: [6] }] } };
  expect(weekdayViolations('2026-11-13', [{ productId: 'cake', flavorId: 'plain', qty: 1 }, { productId: 'cake', flavorId: 'matcha', qty: 1 }], products)).toHaveLength(1);
  expect(weekdayViolations('2026-11-13', [{ productId: 'cake', flavorId: 'matcha', stockLotId: 's', qty: 1 }], products)).toHaveLength(0);
});
it('G11 clear override restores default min', () => {
  expect(progress(3, { min: 3 }).status).toBe('FORMED');
  expect(progress(3, { min: 4 }).status).toBe('OPEN');
});
import { cutoffAt as stockDeadline } from '@/domain/cutoff';
it('stock default noon observes Chicago DST', () => {
  expect(stockDeadline('2026-10-30', 0, '12:00').toISOString()).toBe('2026-10-30T17:00:00.000Z');
  expect(stockDeadline('2026-11-13', 0, '12:00').toISOString()).toBe('2026-11-13T18:00:00.000Z');
});
