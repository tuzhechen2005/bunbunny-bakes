// Product management (PAGES.md /admin/products, API_SPEC admin products, D28, D45).
// Validation mirrors the Product CHECK constraints so a bad mode/field combination is a
// 422 VALIDATION and never reaches the database as a 500. Every write is one transaction
// with its AuditLog row.

import { z } from "zod";
import { copy } from "@/copy";
import { newProductUntil } from "@/domain/newProducts";
import { usage } from "@/domain/capacity";
import { localDateOf } from "@/domain/dates";
import { OCCUPYING_STATUSES, type CapacityMode, type LocalDate } from "@/domain/types";
import { normalizeWeekdays } from "@/domain/weekdays";
import { isHexColor } from "@/lib/fieldColor";
import type { Prisma, Product } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import { loadDayContext, loadProductMap, loadSettings, type ProductInfoMap } from "./day";
import type { DbClient, Tx } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";
import { AppError } from "./errors";
import { parseOrThrow } from "./orderSchemas";

const codePoints = (s: string) => [...s].length;

export const NAME_MAX = 30;
export const DESCRIPTION_MAX = 200;
/** Upper bounds keep every value inside Postgres int4 and catch typos. */
export const MAX_CENTS = 1_000_000;

const intIn = (min: number, max: number) => z.number().int().min(min).max(max);

const name = z
  .string()
  .trim()
  .refine((s) => codePoints(s) >= 1, { message: "Required" })
  .refine((s) => codePoints(s) <= NAME_MAX, { message: `At most ${NAME_MAX} characters` });

const description = z
  .string()
  .trim()
  .refine((s) => codePoints(s) <= DESCRIPTION_MAX, { message: `At most ${DESCRIPTION_MAX} characters` });

const CAPACITY_MODES = ["DOUGH_PER_UNIT", "DOUGH_PER_ROUND", "INDEPENDENT"] as const;
const STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

const fieldColor = z
  .string()
  .refine(isHexColor, { message: "Use #RRGGBB" })
  .transform((s) => s.toUpperCase());

/** D115: distinct weekdays 0–6; stored sorted, all seven -> [] (= every day). */
const pickupWeekdays = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((days) => new Set(days).size === days.length, { message: "Duplicate weekdays" })
  .transform((days) => normalizeWeekdays(days));

/** Photos in display order (cover first) travel with every product the admin API returns. */
export const PRODUCT_INCLUDE = {
  flavors: { orderBy: [{ sort: "asc" }, { id: "asc" }] },
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.ProductInclude;
export type ProductWithImages = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

const shape = {
  name,
  unitLabel: z.string().trim().refine(
    (s) => codePoints(s) >= 1 && codePoints(s) <= 4,
    { message: "Use 1–4 characters" },
  ),
  description,
  unitPriceCents: intIn(0, MAX_CENTS),
  bundleSize: intIn(1, 1000),
  bundlePriceCents: intIn(0, MAX_CENTS).nullable(),
  saleMode: z.enum(["NORMAL", "GROUP"]),
  groupMin: intIn(1, 1000).nullable(),
  capacityMode: z.enum(CAPACITY_MODES),
  doughG: intIn(1, 100_000).nullable(),
  roundG: intIn(1, 100_000).nullable(),
  piecesPerRound: intIn(1, 1000).nullable(),
  dailyLimit: intIn(0, 100_000).nullable(),
  batchYield: intIn(1, 1000).nullable(),
  leadDays: intIn(0, 7),
  status: z.enum(STATUSES),
  sortOrder: intIn(-1_000_000, 1_000_000),
  /** Home background `#RRGGBB`; null = default 奶白 (D95). */
  fieldColor: fieldColor.nullable(),
  pickupWeekdays,
};

type Fields = { [K in keyof typeof shape]: z.output<(typeof shape)[K]> };

/** Fields each mode needs; every other capacity field is stored as null. */
const MODE_FIELDS: Record<CapacityMode, readonly ("doughG" | "roundG" | "piecesPerRound" | "dailyLimit")[]> = {
  DOUGH_PER_UNIT: ["doughG"],
  DOUGH_PER_ROUND: ["roundG", "piecesPerRound"],
  INDEPENDENT: ["dailyLimit"],
};
const CAPACITY_FIELDS = ["doughG", "roundG", "piecesPerRound", "dailyLimit"] as const;

/** The complete product (what is stored): per-field rules, then mode <-> fields, unused -> null. */
const fullSchema = z
  .object(shape)
  .superRefine((v, ctx) => {
    if (v.saleMode === "GROUP" && (v.capacityMode !== "INDEPENDENT" || !v.batchYield || !v.groupMin || v.groupMin > v.batchYield)) ctx.addIssue({ code: "custom", path: ["groupMin"], message: "GROUP requires independent capacity and 1 <= groupMin <= batchYield" });
    for (const field of MODE_FIELDS[v.capacityMode]) {
      if (v[field] === null) ctx.addIssue({ code: "custom", path: [field], message: "Required for this mode" });
    }
  })
  .transform((v): Fields => {
    const out: Fields = { ...v };
    for (const field of CAPACITY_FIELDS) {
      if (!MODE_FIELDS[v.capacityMode].includes(field)) out[field] = null;
    }
    return out;
  });

const createSchema = z
  .object({ ...shape, isNew: z.boolean().optional() })
  .partial({
    saleMode: true,
    groupMin: true,
    unitLabel: true,
    description: true,
    bundleSize: true,
    bundlePriceCents: true,
    doughG: true,
    roundG: true,
    piecesPerRound: true,
    dailyLimit: true,
    batchYield: true,
    leadDays: true,
    status: true,
    sortOrder: true,
    fieldColor: true,
    pickupWeekdays: true,
  })
  .strict();

const patchSchema = z.object({ ...shape, isNew: z.boolean() }).partial().strict();

export type ProductCreateInput = z.input<typeof createSchema>;
export type ProductPatchInput = z.input<typeof patchSchema>;

export const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).strict();

const CAPACITY_KEYS = ["saleMode", "batchYield", "capacityMode", "doughG", "roundG", "piecesPerRound", "dailyLimit"] as const;

export type OverLimitKind = "DOUGH" | "PRODUCT" | "DELIVERY" | "FLAVOR";
export interface OverLimitDate {
  date: LocalDate;
  kinds: OverLimitKind[];
}

function pickFields(p: Product): Fields {
  return {
    saleMode: p.saleMode,
    groupMin: p.groupMin,
    name: p.name,
    unitLabel: p.unitLabel,
    description: p.description,
    unitPriceCents: p.unitPriceCents,
    bundleSize: p.bundleSize,
    bundlePriceCents: p.bundlePriceCents,
    capacityMode: p.capacityMode,
    doughG: p.doughG,
    roundG: p.roundG,
    piecesPerRound: p.piecesPerRound,
    dailyLimit: p.dailyLimit,
    batchYield: p.batchYield,
    leadDays: p.leadDays,
    status: p.status,
    sortOrder: p.sortOrder,
    fieldColor: p.fieldColor,
    pickupWeekdays: p.pickupWeekdays,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/** The product row without its photos (what the audit log keeps). */
function bare(product: ProductWithImages): Product {
  const { images, ...rest } = product;
  void images;
  return rest;
}

function productNotFound(): AppError {
  return new AppError("NOT_FOUND", { message: copy.admin.products.productNotFound });
}

export async function listProducts(db: DbClient): Promise<ProductWithImages[]> {
  return db.product.findMany({ include: PRODUCT_INCLUDE, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createProduct(db: DbClient, input: unknown, now: Date): Promise<ProductWithImages> {
  const data = parseOrThrow(createSchema, input);
  // Validate before opening a transaction; sortOrder is filled in inside it.
  const fields = parseOrThrow(fullSchema, {
    ...data,
    saleMode: data.saleMode ?? "NORMAL",
    groupMin: data.groupMin ?? null,
    unitLabel: data.unitLabel ?? "个",
    description: data.description ?? "",
    bundleSize: data.bundleSize ?? 4,
    bundlePriceCents: data.bundlePriceCents ?? null,
    doughG: data.doughG ?? null,
    roundG: data.roundG ?? null,
    piecesPerRound: data.piecesPerRound ?? null,
    dailyLimit: data.dailyLimit ?? null,
    batchYield: data.batchYield ?? null,
    leadDays: data.leadDays ?? 1,
    status: data.status ?? "ACTIVE",
    sortOrder: data.sortOrder ?? 0,
    fieldColor: data.fieldColor ?? null,
    pickupWeekdays: data.pickupWeekdays ?? [],
  });
  return db.$transaction(async (tx) => {
    let sortOrder = data.sortOrder;
    if (sortOrder === undefined) {
      const max = await tx.product.aggregate({ _max: { sortOrder: true } });
      sortOrder = (max._max.sortOrder ?? 0) + 1;
    }
    const product = await tx.product.create({
      data: { ...fields, sortOrder, newUntil: data.isNew ? newProductUntil(now) : null },
      include: PRODUCT_INCLUDE,
    });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "product.create",
      entityType: "Product",
      entityId: product.id,
      after: bare(product),
      at: now,
    });
    return product;
  });
}

export interface UpdateProductResult {
  product: ProductWithImages;
  overLimitDates: OverLimitDate[];
}

export async function updateProduct(
  db: DbClient,
  id: string,
  input: unknown,
  now: Date,
): Promise<UpdateProductResult> {
  const patch = parseOrThrow(patchSchema, input);
  if (!z.uuid().safeParse(id).success) throw productNotFound();

  return db.$transaction(async (tx) => {
    // Match order lock ordering: today/future dates first when capacity changes, then the product.
    // A concurrently added date with no orders needs no grandfathering.
    const head = await tx.product.findUnique({ where: { id } });
    if (!head) throw productNotFound();
    const preview = parseOrThrow(fullSchema, { ...pickFields(head), ...patch });
    const locksDates = CAPACITY_KEYS.some(k => !sameValue(preview[k], head[k]));
    const dates = locksDates ? await tx.openDate.findMany({ where: { date: { gte: toDbDate(localDateOf(now)) } }, orderBy: { date: "asc" }, select: { date: true } }) : [];
    for (const d of dates) await tx.$queryRaw`SELECT "date" FROM "OpenDate" WHERE "date" = ${d.date}::date FOR UPDATE`;
    // Serialise concurrent edits of the same product.
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const before = await tx.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!before) throw productNotFound();

    // Validation applies to the merged result (a mode switch needs its new fields).
    const merged = parseOrThrow(fullSchema, { ...pickFields(before), ...patch });
    if (patch.bundleSize !== undefined && merged.bundleSize < 2 && before.flavors.some(f => f.bundlePriceCents !== null)) {
      throw new AppError("VALIDATION", { extra: { fields: { bundleSize: "Flavour bundles require a bundle size of at least 2" } } });
    }
    for (const f of before.flavors) if (merged.pickupWeekdays.length && f.pickupWeekdays.some(d => !merged.pickupWeekdays.includes(d))) throw new AppError("VALIDATION");
    if (merged.saleMode === "GROUP") {
      const invalid = await tx.groupPool.findFirst({where:{productId:id,minOverride:{gt:merged.batchYield!}}});
      if (invalid) throw new AppError("VALIDATION");
    }
    const changed = (Object.keys(merged) as (keyof Fields)[]).filter((k) => !sameValue(merged[k], before[k]));
    const newUntil = patch.isNew === undefined ? before.newUntil : patch.isNew ? newProductUntil(now) : null;
    const newUntilChanged = newUntil?.getTime() !== before.newUntil?.getTime();
    if (changed.length === 0 && !newUntilChanged) return { product: before, overLimitDates: [] };

    const capacityChanged = CAPACITY_KEYS.some((k) => changed.includes(k));
    // A concurrent product edit can turn a previously equal patch into a capacity change.
    // Retry with the proper date-before-product lock order instead of locking backwards.
    if (capacityChanged && !locksDates) throw new AppError("STALE");
    const oldProducts = capacityChanged ? await loadProductMap(tx) : null;

    const product = await tx.product.update({ where: { id }, data: { ...merged, newUntil }, include: PRODUCT_INCLUDE });
    if (before.saleMode === "NORMAL" && product.saleMode === "GROUP") {
      const items = await tx.orderItem.findMany({ where: { productId: id, stockLotId: null, order: { pickupDate: { gte: toDbDate(localDateOf(now)) }, status: { in: [...OCCUPYING_STATUSES] } } }, include: { order: { select: { pickupDate: true } } } });
      const seen = new Set<string>();
      for (const i of items) {
        if (!dates.some(d => d.date.getTime() === i.order.pickupDate.getTime())) throw new AppError("STALE");
        const key = `${fromDbDate(i.order.pickupDate)}:${i.flavorId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const where = {date:i.order.pickupDate,productId:id,flavorId:i.flavorId};
        const old = await tx.groupPool.findFirst({where});
        if (old && old.decision !== "OPEN") continue;
        const data = {decision:'CONFIRMED' as const,decidedAt:now,note:'改为拼单前已有订单'};
        const pool = old
          ? await tx.groupPool.update({where:{id:old.id},data})
          : await tx.groupPool.create({data:{...where,...data}});
        await writeAudit(tx,{actor:'ADMIN',action:'groupPool.grandfather',entityType:'GroupPool',entityId:pool.id,after:pool,at:now});
      }
    }
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "product.update",
      entityType: "Product",
      entityId: id,
      before: bare(before),
      after: bare(product),
      at: now,
    });

    const overLimitDates = oldProducts ? await newlyOverLimitDates(tx, oldProducts, now) : [];
    return { product, overLimitDates };
  });
}

/**
 * Open dates from today (Chicago) on whose occupying orders exceed a limit under the
 * CURRENT product settings but did not under `oldProducts` (D45). Delivery limits do not
 * depend on product settings, so "DELIVERY" is never reported here.
 */
async function newlyOverLimitDates(
  tx: Tx,
  oldProducts: ProductInfoMap,
  now: Date,
): Promise<OverLimitDate[]> {
  const today = localDateOf(now);
  const newProducts = await loadProductMap(tx);
  const settings = await loadSettings(tx);
  const rows = await tx.openDate.findMany({
    where: {
      isOpen: true,
      date: { gte: toDbDate(today) },
      orders: { some: { status: { in: [...OCCUPYING_STATUSES] } } },
    },
    select: { date: true },
    orderBy: { date: "asc" },
  });

  const overKinds = (
    ctx: Awaited<ReturnType<typeof loadDayContext>>,
    products: ProductInfoMap,
  ): Set<OverLimitKind> => {
    const u = usage(ctx.orders, products);
    const kinds = new Set<OverLimitKind>();
    if (u.doughG > ctx.limits.doughLimitG) kinds.add("DOUGH");
    for (const [productId, limit] of Object.entries(ctx.limits.productLimits)) {
      if ((u.products[productId] ?? 0) > limit) kinds.add("PRODUCT");
    }
    return kinds;
  };

  const result: OverLimitDate[] = [];
  for (const row of rows) {
    const date = fromDbDate(row.date);
    // Sequential on purpose: one transaction = one connection.
    const oldCtx = await loadDayContext(tx, date, settings, oldProducts);
    const newCtx = await loadDayContext(tx, date, settings, newProducts);
    const wasOver = overKinds(oldCtx, oldProducts);
    const kinds = [...overKinds(newCtx, newProducts)].filter((k) => !wasOver.has(k));
    if (kinds.length > 0) result.push({ date, kinds });
  }
  return result;
}

/** Rewrites sortOrder to 1..n following `ids` (which must list every product exactly once). */
export async function reorderProducts(db: DbClient, input: unknown, now: Date): Promise<ProductWithImages[]> {
  const { ids } = parseOrThrow(reorderSchema, input);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("VALIDATION", { extra: { fields: { ids: "Duplicate ids" } } });
  }
  return db.$transaction(async (tx) => {
    const all = await tx.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const known = new Set(all.map((p) => p.id));
    if (all.length !== ids.length || ids.some((id) => !known.has(id))) {
      throw new AppError("STALE", { message: copy.admin.products.reorderStale });
    }
    const beforeOrder = all.map((p) => ({ id: p.id, sortOrder: p.sortOrder }));
    const afterOrder = ids.map((id, i) => ({ id, sortOrder: i + 1 }));
    for (const { id, sortOrder } of afterOrder) {
      const current = all.find((p) => p.id === id)!;
      if (current.sortOrder !== sortOrder) await tx.product.update({ where: { id }, data: { sortOrder } });
    }
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "product.reorder",
      entityType: "Product",
      entityId: "all",
      before: beforeOrder,
      after: afterOrder,
      at: now,
    });
    return tx.product.findMany({ include: PRODUCT_INCLUDE, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  });
}
