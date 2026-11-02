import { z } from "zod";
import { localDateOf } from "@/domain/dates";
import { OCCUPYING_STATUSES } from "@/domain/types";
import { fromDbDate, toDbDate } from "./dbDates";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { AppError } from "./errors";
import { parseOrThrow } from "./orderSchemas";
import { MAX_CENTS, PRODUCT_INCLUDE, type OverLimitDate, type UpdateProductResult } from "./products";

const fields = {
  name: z.string().trim().refine(s => [...s].length >= 1 && [...s].length <= 12),
  priceCents: z.number().int().min(0).max(MAX_CENTS),
  dailyLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  bundlePriceCents: z.number().int().positive().max(MAX_CENTS).nullable().optional(),
  active: z.boolean(),
  sort: z.number().int().min(-1_000_000).max(1_000_000),
};
const createSchema = z.object(fields).partial({ active: true, sort: true }).strict();
const updateSchema = z.object(fields).partial().strict();
const orderSchema = z.object({ ids: z.array(z.uuid()).max(500) }).strict();

async function lockProduct(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const rows = await tx.$queryRaw<{ id: string; bundleSize: number }[]>`SELECT "id", "bundleSize" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("NOT_FOUND");
  return rows[0];
}

function validateBundle(bundleSize: number, bundlePriceCents: number | null | undefined) {
  if (bundlePriceCents != null && bundleSize < 2) {
    throw new AppError("VALIDATION", { extra: { fields: { bundlePriceCents: "Bundle size must be at least 2" } } });
  }
}

export async function createFlavor(db: DbClient, productId: string, input: unknown, now: Date) {
  const data = parseOrThrow(createSchema, input);
  return db.$transaction(async tx => {
    const product = await lockProduct(tx, productId);
    validateBundle(product.bundleSize, data.bundlePriceCents);
    const max = await tx.productFlavor.aggregate({ where: { productId }, _max: { sort: true } });
    const flavor = await tx.productFlavor.create({ data: { ...data, productId, sort: data.sort ?? (max._max.sort ?? -1) + 1, createdAt: now, updatedAt: now } });
    await writeAudit(tx, { actor: "ADMIN", action: "product.flavor.create", entityType: "Product", entityId: productId, after: flavor, at: now });
    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
  });
}

export async function updateFlavor(db: DbClient, productId: string, flavorId: string, input: unknown, now: Date): Promise<UpdateProductResult> {
  const data = parseOrThrow(updateSchema, input);
  if (!z.uuid().safeParse(flavorId).success) throw new AppError("NOT_FOUND");
  return db.$transaction(async tx => {
    const locked = await lockProduct(tx, productId);
    const before = await tx.productFlavor.findFirst({ where: { id: flavorId, productId } });
    if (!before) throw new AppError("NOT_FOUND");
    validateBundle(locked.bundleSize, data.bundlePriceCents);
    const changed = Object.entries(data).some(([k, v]) => before[k as keyof typeof data] !== v);
    if (changed) {
      const after = await tx.productFlavor.update({ where: { id: flavorId }, data: { ...data, updatedAt: now } });
      await writeAudit(tx, { actor: "ADMIN", action: "product.flavor.update", entityType: "Product", entityId: productId, before, after, at: now });
    }
    const overLimitDates: OverLimitDate[] = [];
    if (data.dailyLimit != null && (before.dailyLimit === null || data.dailyLimit < before.dailyLimit)) {
      const dates = await tx.openDate.findMany({
        where: {
          isOpen: true,
          date: { gte: toDbDate(localDateOf(now)) },
          flavorLimits: { none: { flavorId } },
        },
        select: { date: true },
        orderBy: { date: "asc" },
      });
      for (const { date } of dates) {
        const used = await tx.orderItem.aggregate({
          where: { flavorId, order: { pickupDate: date, status: { in: [...OCCUPYING_STATUSES] } } },
          _sum: { qty: true },
        });
        if ((used._sum.qty ?? 0) > data.dailyLimit) {
          overLimitDates.push({ date: fromDbDate(date), kinds: ["FLAVOR"] });
        }
      }
    }
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
    return { product, overLimitDates };
  });
}

/** Includes inactive flavours: ids must be the complete current set, exactly once. */
export async function reorderFlavors(db: DbClient, productId: string, input: unknown, now: Date) {
  const { ids } = parseOrThrow(orderSchema, input);
  return db.$transaction(async tx => {
    await lockProduct(tx, productId);
    const before = await tx.productFlavor.findMany({ where: { productId }, orderBy: [{ sort: "asc" }, { id: "asc" }] });
    const known = new Set(before.map(f => f.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) throw new AppError("STALE");
    if (ids.some((id, i) => before[i].id !== id)) {
      for (const [sort, id] of ids.entries()) await tx.productFlavor.update({ where: { id }, data: { sort, updatedAt: now } });
      const after = await tx.productFlavor.findMany({ where: { productId }, orderBy: [{ sort: "asc" }, { id: "asc" }] });
      await writeAudit(tx, { actor: "ADMIN", action: "product.flavor.reorder", entityType: "Product", entityId: productId, before, after, at: now });
    }
    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
  });
}
