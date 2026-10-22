import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { updateProduct } from "@/server/products";

export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body: unknown = await request.json().catch(() => null);
  return Response.json(await updateProduct(prisma, params.id, body, now));
});
