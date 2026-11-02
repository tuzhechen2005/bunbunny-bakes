import { z } from "zod";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { AppError } from "./errors";
import { parseOrThrow } from "./orderSchemas";
import { MAX_CENTS, PRODUCT_INCLUDE } from "./products";

const fields = {
  name: z.string().trim().refine(s => [...s].length >= 1 && [...s].length <= 12),
  priceCents: z.number().int().min(0).max(MAX_CENTS),
  active: z.boolean(),
  sort: z.number().int().min(-1_000_000).max(1_000_000),
};
const createSchema = z.object(fields).partial({ active: true, sort: true }).strict();
const updateSchema = z.object(fields).partial().strict();
const orderSchema = z.object({ ids: z.array(z.uuid()).max(500) }).strict();

async function lockProduct(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new AppError("NOT_FOUND");
}

export async function createFlavor(db: DbClient, productId: string, input: unknown, now: Date) {
  const data = parseOrThrow(createSchema, input);
  return db.$transaction(async tx => {
    await lockProduct(tx, productId);
    const max = await tx.productFlavor.aggregate({ where: { productId }, _max: { sort: true } });
    const flavor = await tx.productFlavor.create({ data: { ...data, productId, sort: data.sort ?? (max._max.sort ?? -1) + 1, createdAt: now, updatedAt: now } });
    await writeAudit(tx, { actor: "ADMIN", action: "product.flavor.create", entityType: "Product", entityId: productId, after: flavor, at: now });
    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
  });
}

export async function updateFlavor(db: DbClient, productId: string, flavorId: string, input: unknown, now: Date) {
  const data = parseOrThrow(updateSchema, input);
  if (!z.uuid().safeParse(flavorId).success) throw new AppError("NOT_FOUND");
  return db.$transaction(async tx => {
    await lockProduct(tx, productId);
    const before = await tx.productFlavor.findFirst({ where: { id: flavorId, productId } });
    if (!before) throw new AppError("NOT_FOUND");
    const changed = Object.entries(data).some(([k, v]) => before[k as keyof typeof data] !== v);
    if (changed) {
      const after = await tx.productFlavor.update({ where: { id: flavorId }, data: { ...data, updatedAt: now } });
      await writeAudit(tx, { actor: "ADMIN", action: "product.flavor.update", entityType: "Product", entityId: productId, before, after, at: now });
    }
    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
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
