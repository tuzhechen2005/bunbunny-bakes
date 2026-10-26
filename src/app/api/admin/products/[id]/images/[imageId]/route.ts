import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { deleteProductImageById } from "@/server/productImage";

export const DELETE = adminHandler<{ id: string; imageId: string }>(async ({ params, now }) => {
  const product = await deleteProductImageById(prisma, getImageStore(), params.id, params.imageId, now);
  return Response.json({ product });
});
