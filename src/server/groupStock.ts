import { z } from 'zod';
import { groupPool } from '@/domain/groupPool';
import { cutoffAt } from '@/domain/cutoff';
import { isLocalDate } from '@/domain/dates';
import { OCCUPYING_STATUSES, type CartLine } from '@/domain/types';
import type { DbClient, Tx } from './db';
import { fromDbDate, toDbDate } from './dbDates';
import { loadPoolReservations, lockOpenDate, type ProductInfoMap } from './day';
import { lockCartProducts } from './flavorPricing';
import { writeAudit } from './audit';
import { AppError } from './errors';
import { parseOrThrow } from './orderSchemas';

const dateSchema = z.string().refine(isLocalDate);
const keySchema = z.object({ date: dateSchema, productId: z.uuid(), flavorId: z.uuid().nullable().default(null) });
const options = { isolationLevel: 'ReadCommitted' as const, maxWait: 20_000, timeout: 20_000 };
const holding = { in: [...OCCUPYING_STATUSES] };
type Key = z.output<typeof keySchema>;

export async function poolProgress(db: DbClient | Tx, key: Key, now: Date) {
  const date = toDbDate(key.date);
  const product = await db.product.findUnique({ where: { id: key.productId } });
  if (!product || product.saleMode !== 'GROUP') throw new AppError('NOT_FOUND');
  const pool = await db.groupPool.findFirst({ where: { date, productId: key.productId, flavorId: key.flavorId } });
  const items = await db.orderItem.findMany({ where: { productId: key.productId, flavorId: key.flavorId, stockLotId: null, order: { pickupDate: date, status: holding } }, select: { qty: true, orderId: true } });
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 1 } });
  const reserved = (await loadPoolReservations(db, key.date)).filter(l => l.productId === key.productId && (l.flavorId ?? null) === key.flavorId).reduce((n,l) => n + l.qty, 0);
  return {
    ...key, id: pool?.id ?? null, decision: pool?.decision ?? 'OPEN', minOverride: pool?.minOverride ?? null,
    ...groupPool({ pieces: reserved + items.reduce((n, i) => n + i.qty, 0), batchYield: product.batchYield!, min: pool?.minOverride ?? product.groupMin!, decision: pool?.decision, cutoffAt: cutoffAt(key.date, product.leadDays, settings.cutoffTime), now }),
    pieces: items.reduce((n,i) => n + i.qty, 0),
    orderCount: new Set(items.map(i => i.orderId)).size
  };
}

export async function listPools(db: DbClient | Tx, input: unknown, now: Date) {
  const { from, to, productId } = parseOrThrow(z.object({ from: dateSchema, to: dateSchema, productId: z.uuid().optional() }).refine(v => v.from <= v.to && (toDbDate(v.to).getTime() - toDbDate(v.from).getTime()) / 86400000 <= 366), input);
  const dates = await db.openDate.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: { date: 'asc' } });
  const products = await db.product.findMany({ where: { saleMode: 'GROUP', ...(productId ? { id: productId } : {}) }, include: { flavors: true } });
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const ids = products.map(p => p.id);
  const decisions = await db.groupPool.findMany({ where: { date: range, productId: { in: ids } } });
  const items = await db.orderItem.findMany({ where: { productId: { in: ids }, stockLotId: null, order: { pickupDate: range, status: holding } }, select: { qty: true, productId: true, flavorId: true, orderId: true, order: { select: { pickupDate: true } } } });
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 1 } });
  const identity = (date: string, productId: string, flavorId: string | null) => `${date}:${productId}:${flavorId ?? ''}`;
  const byKey = new Map(decisions.map(p => [identity(fromDbDate(p.date), p.productId, p.flavorId), p]));
  const totals = new Map<string, { pieces: number; orders: Set<string> }>();
  for (const i of items) {
    const key = identity(fromDbDate(i.order.pickupDate), i.productId, i.flavorId);
    const total = totals.get(key) ?? { pieces: 0, orders: new Set<string>() };
    total.pieces += i.qty; total.orders.add(i.orderId); totals.set(key, total);
  }
  const reservations = new Map<string, number>();
  for (const d of dates) for (const l of await loadPoolReservations(db, fromDbDate(d.date))) {
    const key = identity(fromDbDate(d.date), l.productId, l.flavorId ?? null);
    reservations.set(key, (reservations.get(key) ?? 0) + l.qty);
  }
  const result = [];
  for (const d of dates) for (const p of products) for (const flavorId of [null, ...p.flavors.map(f => f.id)]) {
    const date = fromDbDate(d.date), key = identity(date, p.id, flavorId);
    const pool = byKey.get(key), total = totals.get(key);
    if (!total && !pool && flavorId === null && p.flavors.length) continue;
    result.push({
      date, productId: p.id, flavorId, id: pool?.id ?? null, decision: pool?.decision ?? 'OPEN', minOverride: pool?.minOverride ?? null,
      ...groupPool({ pieces: (total?.pieces ?? 0) + (reservations.get(key) ?? 0), batchYield: p.batchYield!, min: pool?.minOverride ?? p.groupMin!, decision: pool?.decision, cutoffAt: cutoffAt(date, p.leadDays, settings.cutoffTime), now }), pieces: total?.pieces ?? 0, orderCount: total?.orders.size ?? 0
    });
  }
  return result;
}

export async function decidePool(db: DbClient, input: unknown, now: Date) {
  const data = parseOrThrow(keySchema.extend({ action: z.enum(['confirm', 'fail', 'reopen', 'minimum']), minOverride: z.number().int().positive().nullable().optional(), note: z.string().max(500).nullable().optional() }), input);
  return db.$transaction(async tx => {
    if (!await lockOpenDate(tx, data.date)) throw new AppError('DATE_CLOSED');
    await lockCartProducts(tx, [{ productId: data.productId, qty: 1 }]);
    const before = await poolProgress(tx, data, now);
    const product = await tx.product.findUniqueOrThrow({ where: { id: data.productId } });
    if (data.flavorId && !await tx.productFlavor.findFirst({ where: { id: data.flavorId, productId: data.productId } })) throw new AppError('VALIDATION');
    if (data.action === 'minimum' && (data.minOverride === undefined || (data.minOverride !== null && data.minOverride > product.batchYield!))) throw new AppError('VALIDATION');
    if (before.id && ['fail', 'reopen'].includes(data.action)) {
      const sold = await tx.orderItem.count({ where: { stockLot: { groupPoolId: before.id }, order: { status: holding } } });
      if (sold) throw new AppError('VALIDATION');
    }
    const change = {
      decision: data.action === 'confirm' ? 'CONFIRMED' as const : data.action === 'fail' ? 'FAILED' as const : data.action === 'reopen' ? 'OPEN' as const : before.decision,
      ...(data.action === 'minimum' ? { minOverride: data.minOverride } : {}), decidedAt: data.action === 'minimum' ? undefined : data.action === 'reopen' ? null : now, note: data.note
    };
    const after = before.id ? await tx.groupPool.update({ where: { id: before.id }, data: change }) : await tx.groupPool.create({ data: { date: toDbDate(data.date), productId: data.productId, flavorId: data.flavorId, ...change } });
    await writeAudit(tx, { actor: 'ADMIN', action: `groupPool.${data.action}`, entityType: 'GroupPool', entityId: after.id, before, after, at: now });
    return poolProgress(tx, data, now);
  }, options);
}

export async function soldForLot(db: DbClient | Tx, id: string, excludeOrderId?: string) {
  const sum = await db.orderItem.aggregate({ where: { stockLotId: id, ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {}), order: { status: holding } }, _sum: { qty: true } });
  return sum._sum.qty ?? 0;
}

export async function listStock(db: DbClient | Tx, input: unknown, now: Date, admin = false, includeSoldOut = false) {
  const { from, to } = parseOrThrow(z.object({ from: dateSchema, to: dateSchema }).refine(v => v.from <= v.to && (toDbDate(v.to).getTime() - toDbDate(v.from).getTime()) / 86400000 <= 366), input);
  const lots = await db.stockLot.findMany({ where: { date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(admin ? {} : { closed: false, sellUntil: { gt: now }, openDate: { isOpen: true }, product: { status: 'ACTIVE' } }) }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
  const result = [];
  for (const lot of lots) {
    const sold = await soldForLot(db, lot.id);
    const publicLot = { lotId: lot.id, date: fromDbDate(lot.date), productId: lot.productId, flavorId: lot.flavorId, left: Math.max(0, lot.qty - sold), sellUntil: lot.sellUntil.toISOString() };
    if (admin) result.push({ ...lot, ...publicLot, sold });
    else if (includeSoldOut || publicLot.left > 0) result.push(publicLot);
  }
  return result;
}

const lotFields = { qty: z.number().int().min(0).max(100000), madeAt: z.iso.datetime().nullable().optional(), sellUntil: z.iso.datetime().optional(), note: z.string().max(500).nullable().optional() };
export async function createStock(db: DbClient, input: unknown, now: Date, convert = false) {
  const data = parseOrThrow(keySchema.extend({ ...lotFields, qty: lotFields.qty.optional() }), input);
  return db.$transaction(async tx => {
    if (!await lockOpenDate(tx, data.date)) throw new AppError('DATE_CLOSED');
    await lockCartProducts(tx, [{ productId: data.productId, qty: 1 }]);
    const product = await tx.product.findUnique({ where: { id: data.productId } });
    if (!product || (data.flavorId && !await tx.productFlavor.findFirst({ where: { id: data.flavorId, productId: data.productId } }))) throw new AppError('VALIDATION');
    let qty = data.qty;
    let groupPoolId: string | null = null;
    if (convert) {
      const p = await poolProgress(tx, data, now);
      if (!['FORMED', 'CONFIRMED'].includes(p.status)) throw new AppError('VALIDATION');
      const pool = p.id ? await tx.groupPool.findUniqueOrThrow({ where: { id: p.id } }) : await tx.groupPool.create({ data: { date: toDbDate(data.date), productId: data.productId, flavorId: data.flavorId } });
      groupPoolId = pool.id;
      const previous = await tx.stockLot.findMany({ where: { groupPoolId } });
      if (previous.some(l => !l.closed)) throw new AppError('VALIDATION');
      qty = p.spare;
      const confirmed = await tx.groupPool.update({ where: { id: pool.id }, data: { decision: 'CONFIRMED', decidedAt: now } });
      await writeAudit(tx, { actor: 'ADMIN', action: 'groupPool.confirm', entityType: 'GroupPool', entityId: pool.id, before: pool, after: confirmed, at: now });
      if (qty <= 0) throw new AppError('FULL');
    }
    if (qty === undefined) throw new AppError('VALIDATION');
    const lot = await tx.stockLot.create({ data: { date: toDbDate(data.date), productId: data.productId, flavorId: data.flavorId, qty, groupPoolId, madeAt: data.madeAt ? new Date(data.madeAt) : null, sellUntil: data.sellUntil ? new Date(data.sellUntil) : cutoffAt(data.date, 0, '12:00'), note: data.note, createdAt: now } });
    await writeAudit(tx, { actor: 'ADMIN', action: convert ? 'stock.convert' : 'stock.create', entityType: 'StockLot', entityId: lot.id, after: lot, at: now });
    return lot;
  }, options);
}

export async function updateStock(db: DbClient, id: string, input: unknown, now: Date) {
  if (!z.uuid().safeParse(id).success) throw new AppError('NOT_FOUND');
  const data = parseOrThrow(z.object({ ...lotFields, closed: z.boolean().optional() }).partial().strict(), input);
  return db.$transaction(async tx => {
    const head = await tx.stockLot.findUnique({ where: { id } });
    if (!head) throw new AppError('NOT_FOUND');
    await lockOpenDate(tx, fromDbDate(head.date));
    const before = await tx.stockLot.findUniqueOrThrow({ where: { id } });
    const sold = await soldForLot(tx, id);
    if (data.qty !== undefined && data.qty < sold) throw new AppError('VALIDATION');
    // Converted lots reserve physical spare; expanding/reopening would mint inventory.
    if (before.groupPoolId && ((data.qty !== undefined && data.qty > before.qty) || (before.closed && data.closed === false))) throw new AppError('VALIDATION');
    const after = await tx.stockLot.update({ where: { id }, data: { ...data, madeAt: data.madeAt === undefined ? undefined : data.madeAt === null ? null : new Date(data.madeAt), sellUntil: data.sellUntil ? new Date(data.sellUntil) : undefined } });
    await writeAudit(tx, { actor: 'ADMIN', action: 'stock.update', entityType: 'StockLot', entityId: id, before, after, at: now });
    return after;
  }, options);
}

/** Must run under the date lock; stock is a hard bound even for admin overrides. */
export async function validateStock(tx: Tx, date: string, lines: CartLine[], now: Date, excludeOrderId?: string, enforceWindow = true, holdsCapacity = true, previousLines: CartLine[] = []) {
  const totals = new Map<string, number>();
  const lots = new Map<string, Awaited<ReturnType<typeof tx.stockLot.findUniqueOrThrow>>>();
  for (const line of lines) if (line.stockLotId) {
    const lot = await tx.stockLot.findUnique({ where: { id: line.stockLotId } });
    if (!lot || fromDbDate(lot.date) !== date || lot.productId !== line.productId || lot.flavorId !== (line.flavorId ?? null)) throw new AppError('VALIDATION');
    const previousQty = previousLines.filter(i => i.stockLotId === lot.id).reduce((n, i) => n + i.qty, 0);
    const nextQty = lines.filter(i => i.stockLotId === lot.id).reduce((n, i) => n + i.qty, 0);
    if (enforceWindow && nextQty > previousQty && (lot.closed || now >= lot.sellUntil)) throw new AppError('CUTOFF_PASSED');
    lots.set(lot.id, lot);
    totals.set(lot.id, (totals.get(lot.id) ?? 0) + line.qty);
  }
  for (const [id, qty] of totals) if (holdsCapacity && qty + await soldForLot(tx, id, excludeOrderId) > lots.get(id)!.qty) throw new AppError('FULL');
  return [...lots.values()].reduce<Date | null>((min, l) => !min || l.sellUntil < min ? l.sellUntil : min, null);
}

export function validateGroupChoices(lines: CartLine[], products: ProductInfoMap, legacy = new Set<string>()) {
  for (const line of lines) {
    if (!line.stockLotId && products[line.productId]?.saleMode === 'GROUP') {
      if (!line.ifNotFormed && !legacy.has(`${line.productId}:${line.flavorId ?? ''}`)) line.ifNotFormed = 'CONTACT';
    } else line.ifNotFormed = null;
  }
}
