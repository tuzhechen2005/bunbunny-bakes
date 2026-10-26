import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { reorderProductImages } from "@/server/productImage";

/** `{ ids }` lists every photo of the product once, cover first. */
export const PUT = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body: unknown = await request.json().catch(() => null);
  const product = await reorderProductImages(prisma, params.id, body, now);
  return Response.json({ product });
});
