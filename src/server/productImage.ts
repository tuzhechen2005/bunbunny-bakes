// Product photos (T5.2, D98): up to MAX_PRODUCT_IMAGES per product, cover first. A blob is written
// first, then the rows and the AuditLog entry in one transaction; removed blobs are deleted
// afterwards, best effort. `Product.imageUrl` always mirrors the cover (images[0]) so every
// existing reader keeps working.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { AppError } from "./errors";
import { imageUrlForKey, keyFromImageUrl, MAX_IMAGE_BYTES, sniffImage } from "./imageFormat";
import type { ImageStore } from "./imageStore";
import { parseOrThrow } from "./orderSchemas";
import { PRODUCT_INCLUDE, type ProductWithImages } from "./products";

const t = copy.admin.products;

export const MAX_PRODUCT_IMAGES = 6;

const notFound = () => new AppError("NOT_FOUND", { message: t.productNotFound });
const photoNotFound = () => new AppError("NOT_FOUND", { message: t.photoNotFound });
const invalid = (message: string) =>
  new AppError("VALIDATION", { message, extra: { fields: { file: message } } });
const limitReached = () => invalid(t.photoLimit);

/** Reads the multipart `file` field and checks size and real type. */
export async function readUploadedImage(request: Request) {
  const length = Number(request.headers.get("content-length"));
  // Cheap early reject; the multipart envelope adds a little to the file itself.
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES + 64 * 1024) throw invalid(t.photoTooLarge);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw invalid(t.photoNoFile);
  if (file.size > MAX_IMAGE_BYTES) throw invalid(t.photoTooLarge);
  if (file.size === 0) throw invalid(t.photoNoFile);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw invalid(t.photoBadType);
  return { bytes, kind };
}

async function bestEffortDelete(store: ImageStore, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await store.delete(key);
  } catch {
    // An orphaned blob is harmless; the row is already correct.
  }
}

const imagesOf = (tx: Tx, productId: string) =>
  tx.productImage.findMany({ where: { productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

interface Snapshot {
  imageUrl: string | null;
  images: string[];
}

async function snapshot(tx: Tx, productId: string): Promise<Snapshot> {
  const rows = await imagesOf(tx, productId);
  return { imageUrl: rows[0]?.url ?? null, images: rows.map((r) => r.url) };
}

/** Locks the product row; the caller's whole change then runs serialised per product. */
async function lockProduct(tx: Tx, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}

/** Renumbers 0..n-1 in the current order, mirrors the cover into Product.imageUrl, audits, returns the product. */
async function finish(
  tx: Tx,
  id: string,
  before: Snapshot,
  action: string,
  now: Date,
  order?: string[],
): Promise<ProductWithImages> {
  const rows = await imagesOf(tx, id);
  const ordered = order ? order.map((rid) => rows.find((r) => r.id === rid)!) : rows;
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].sortOrder !== i) {
      await tx.productImage.update({ where: { id: ordered[i].id }, data: { sortOrder: i } });
    }
  }
  const cover = ordered[0]?.url ?? null;
  await tx.product.update({ where: { id }, data: { imageUrl: cover } });
  const after: Snapshot = { imageUrl: cover, images: ordered.map((r) => r.url) };
  await writeAudit(tx, {
    actor: "ADMIN",
    action,
    entityType: "Product",
    entityId: id,
    before,
    after,
    at: now,
  });
  return tx.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE });
}

async function runWithBlobCleanup<T>(store: ImageStore, newKey: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // The new blob never became referenced.
    await bestEffortDelete(store, newKey);
    throw e;
  }
}

async function requireProduct(db: DbClient, id: string): Promise<number> {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const found = await db.product.findUnique({ where: { id }, select: { _count: { select: { images: true } } } });
  if (!found) throw notFound();
  return found._count.images;
}

async function storeUpload(store: ImageStore, id: string, request: Request): Promise<string> {
  const { bytes, kind } = await readUploadedImage(request);
  const key = `${id}/${randomBytes(16).toString("hex")}.${kind.ext}`;
  await store.put(key, bytes, kind.contentType);
  return key;
}

/** POST /images: appends one photo at the end (the first photo is the cover). 6 at most. */
export async function appendProductImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  request: Request,
  now: Date,
): Promise<ProductWithImages> {
  if ((await requireProduct(db, id)) >= MAX_PRODUCT_IMAGES) throw limitReached();
  const key = await storeUpload(store, id, request);
  return runWithBlobCleanup(store, key, () =>
    db.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const before = await snapshot(tx, id);
      if (before.images.length >= MAX_PRODUCT_IMAGES) throw limitReached();
      await tx.productImage.create({
        data: { productId: id, url: imageUrlForKey(key), sortOrder: before.images.length },
      });
      return finish(tx, id, before, "product.update", now);
    }),
  );
}

/**
 * Legacy POST /image: replaces the cover (images[0]) in place; a product without photos gets
 * its first one. The other photos are untouched.
 */
export async function uploadProductImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  request: Request,
  now: Date,
): Promise<ProductWithImages> {
  await requireProduct(db, id);
  const key = await storeUpload(store, id, request);
  let oldUrl: string | null = null;
  const product = await runWithBlobCleanup(store, key, () =>
    db.$transaction(async (tx) => {
      await lockProduct(tx, id);
      const before = await snapshot(tx, id);
      const cover = (await imagesOf(tx, id))[0];
      if (cover) {
        oldUrl = cover.url;
        await tx.productImage.update({ where: { id: cover.id }, data: { url: imageUrlForKey(key) } });
      } else {
        await tx.productImage.create({ data: { productId: id, url: imageUrlForKey(key), sortOrder: 0 } });
      }
      return finish(tx, id, before, "product.update", now);
    }),
  );
  await bestEffortDelete(store, keyFromImageUrl(oldUrl));
  return product;
}

async function removeImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  pick: (rows: Prisma.ProductImageGetPayload<object>[]) => Prisma.ProductImageGetPayload<object> | undefined,
  now: Date,
): Promise<ProductWithImages> {
  let removedUrl: string | null = null;
  const product = await db.$transaction(async (tx) => {
    await lockProduct(tx, id);
    const rows = await imagesOf(tx, id);
    const target = pick(rows);
    const before = await snapshot(tx, id);
    if (!target) return tx.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE }); // nothing to remove: no write, no audit row
    removedUrl = target.url;
    await tx.productImage.delete({ where: { id: target.id } });
    return finish(tx, id, before, "product.update", now);
  });
  await bestEffortDelete(store, keyFromImageUrl(removedUrl));
  return product;
}

/** DELETE /images/{imageId}: removes one photo; the rest move up (deleting the cover promotes the next). */
export async function deleteProductImageById(
  db: DbClient,
  store: ImageStore,
  id: string,
  imageId: string,
  now: Date,
): Promise<ProductWithImages> {
  await requireProduct(db, id);
  if (!z.uuid().safeParse(imageId).success) throw photoNotFound();
  const exists = await db.productImage.findFirst({ where: { id: imageId, productId: id }, select: { id: true } });
  if (!exists) throw photoNotFound();
  return removeImage(db, store, id, (rows) => rows.find((r) => r.id === imageId), now);
}

/** Legacy DELETE /image: removes the cover photo (no-op without photos). */
export async function deleteProductImage(db: DbClient, store: ImageStore, id: string, now: Date): Promise<ProductWithImages> {
  await requireProduct(db, id);
  return removeImage(db, store, id, (rows) => rows[0], now);
}

export const imageOrderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_PRODUCT_IMAGES) }).strict();

/** PUT /images/order: `ids` lists every photo of the product exactly once, cover first. */
export async function reorderProductImages(
  db: DbClient,
  id: string,
  input: unknown,
  now: Date,
): Promise<ProductWithImages> {
  const { ids } = parseOrThrow(imageOrderSchema, input);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("VALIDATION", { extra: { fields: { ids: "Duplicate ids" } } });
  }
  await requireProduct(db, id);
  return db.$transaction(async (tx) => {
    await lockProduct(tx, id);
    const rows = await imagesOf(tx, id);
    const known = new Set(rows.map((r) => r.id));
    if (rows.length !== ids.length || ids.some((x) => !known.has(x))) {
      throw new AppError("STALE", { message: t.photoOrderStale });
    }
    const before = await snapshot(tx, id);
    if (rows.every((r, i) => r.id === ids[i])) {
      return tx.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE }); // same order: no write
    }
    return finish(tx, id, before, "product.update", now, ids);
  });
}
