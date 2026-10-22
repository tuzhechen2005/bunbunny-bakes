import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { reorderProducts } from "@/server/products";

export const POST = adminHandler(async ({ request, now }) => {
  const body: unknown = await request.json().catch(() => null);
  return Response.json({ products: await reorderProducts(prisma, body, now) });
});
