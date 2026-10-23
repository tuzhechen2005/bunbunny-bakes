import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { deleteProductImage, uploadProductImage } from "@/server/productImage";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const product = await uploadProductImage(prisma, getImageStore(), params.id, request, now);
  return Response.json({ product });
});

export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => {
  const product = await deleteProductImage(prisma, getImageStore(), params.id, now);
  return Response.json({ product });
});
