import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { reorderFlavors } from "@/server/productFlavors";

export const PUT = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body: unknown = await request.json().catch(() => null);
  const product = await reorderFlavors(prisma, params.id, body, now);
  return Response.json({ product });
});
