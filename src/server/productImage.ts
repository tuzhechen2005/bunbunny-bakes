// Product photo upload / removal (T5.2). The blob is written first, then the row and its
// AuditLog entry in one transaction; the previous blob is deleted afterwards, best effort.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import type { Product } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import { imageUrlForKey, keyFromImageUrl, MAX_IMAGE_BYTES, sniffImage } from "./imageFormat";
import type { ImageStore } from "./imageStore";

const t = copy.admin.products;

const notFound = () => new AppError("NOT_FOUND", { message: t.productNotFound });
const invalid = (message: string) =>
  new AppError("VALIDATION", { message, extra: { fields: { file: message } } });

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

async function changeImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  newKey: string | null,
  now: Date,
): Promise<Product> {
  let oldUrl: string | null = null;
  let product: Product;
  try {
    product = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.product.findUnique({ where: { id } });
      if (!current) throw notFound();
      oldUrl = current.imageUrl;
      const after = await tx.product.update({
        where: { id },
        data: { imageUrl: newKey ? imageUrlForKey(newKey) : null },
      });
      await writeAudit(tx, {
        actor: "ADMIN",
        action: "product.update",
        entityType: "Product",
        entityId: id,
        before: { imageUrl: current.imageUrl },
        after: { imageUrl: after.imageUrl },
        at: now,
      });
      return after;
    });
  } catch (e) {
    // The new blob never became referenced.
    await bestEffortDelete(store, newKey);
    throw e;
  }
  await bestEffortDelete(store, keyFromImageUrl(oldUrl));
  return product;
}

export async function uploadProductImage(
  db: DbClient,
  store: ImageStore,
  id: string,
  request: Request,
  now: Date,
): Promise<Product> {
  if (!z.uuid().safeParse(id).success) throw notFound();
  if (!(await db.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const { bytes, kind } = await readUploadedImage(request);
  const key = `${id}/${randomBytes(16).toString("hex")}.${kind.ext}`;
  await store.put(key, bytes, kind.contentType);
  return changeImage(db, store, id, key, now);
}

export async function deleteProductImage(db: DbClient, store: ImageStore, id: string, now: Date): Promise<Product> {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const current = await db.product.findUnique({ where: { id } });
  if (!current) throw notFound();
  if (current.imageUrl === null) return current; // nothing to remove: no write, no audit row
  return changeImage(db, store, id, null, now);
}
