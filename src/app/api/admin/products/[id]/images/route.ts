import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { appendProductImage } from "@/server/productImage";

/** Appends one photo (multipart `file`); the first photo is the cover. At most 6 per product. */
export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const product = await appendProductImage(prisma, getImageStore(), params.id, request, now);
  return Response.json({ product }, { status: 201 });
});
